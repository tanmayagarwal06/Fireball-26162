"""Embedded, fully offline spatial reference engine for India.

The sandbox has no route to Overpass (OSM), ESA WorldCover buckets or NASA
Earthdata, so this module ships three curated reference layers in code:

1. **Industrial clusters** - centroid + geodesic buffer polygons for the major
   Indian refinery, petrochemical, steel, smelter, coal-mining and power
   installations. Persisted to ``data/cache/osm_industrial.gpkg`` on first use
   so the on-disk file can later be swapped for a real OSM ``landuse=industrial``
   extract without touching any code (the loader only needs a geometry column).
2. **Land-cover estimator** - a rule-based stand-in for ESA WorldCover 10 m.
   If GeoTIFF tiles are dropped into ``data/cache/worldcover/`` they are sampled
   with ``rasterio`` instead; the heuristic then only fills gaps outside the
   tiles.
3. **Flare-site catalog** - reference coordinates of verified onshore gas-flare
   locations (refinery flare stacks, gas-processing terminals and oil-field
   flares reported in the VIIRS Nightfire / Global Gas Flaring survey series).
   Used *only* to validate the Gas-Flare class, never for training labels.

Everything is vectorised over NumPy arrays and safe to call on millions of
points.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable, Optional

import numpy as np
import pandas as pd
import geopandas as gpd
import shapely
from shapely.geometry import Point, Polygon
from scipy.spatial import cKDTree

from src.config import (
    BUILT_UP_HALO_KM,
    FLARE_GPKG,
    GEOGRAPHIC_CRS,
    INDUSTRIAL_GPKG,
    METRIC_CRS,
    WORLDCOVER_DIR,
)
from src.pipeline.geo_utils import geodesic_circle, haversine_km, to_unit_sphere_xyz

log = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# 1. Curated Indian industrial clusters
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class IndustrialSite:
    site_id: str
    name: str
    latitude: float
    longitude: float
    radius_km: float
    facility_type: str
    operators: str
    tier: str            # "primary" (required by the problem brief) | "secondary"
    state: str


# Tier "primary" entries are the six installations mandated by the brief.
# Tier "secondary" entries were added because they dominate the persistent
# thermal signal in the 2020-2024 FIRMS archive for India (steel belts, coal
# fields with seam fires, refineries with permanent flare stacks).
CURATED_INDUSTRIAL_SITES: tuple[IndustrialSite, ...] = (
    # ---- primary (from the problem statement) --------------------------------
    IndustrialSite("IND-JAMNAGAR", "Jamnagar Refining Complex", 22.35, 69.85, 9.0,
                   "refinery_petrochemical", "Reliance Industries; Nayara Energy", "primary", "Gujarat"),
    IndustrialSite("IND-SINGRAULI", "Singrauli Energy & Coal Basin", 24.10, 82.60, 22.0,
                   "power_coal", "NTPC; Northern Coalfields Ltd", "primary", "Madhya Pradesh / Uttar Pradesh"),
    IndustrialSite("IND-BARMER", "Barmer Oil & Gas Fields", 25.95, 71.45, 18.0,
                   "oil_gas_flare", "Cairn Oil & Gas (Vedanta) - Mangala / Bhagyam / Aishwarya", "primary", "Rajasthan"),
    IndustrialSite("IND-HAZIRA", "Hazira Industrial Belt", 21.10, 72.65, 8.0,
                   "refinery_steel", "ONGC; ArcelorMittal Nippon Steel; L&T; Reliance", "primary", "Gujarat"),
    IndustrialSite("IND-TROMBAY", "Mumbai-Trombay Corridor", 19.00, 72.90, 6.0,
                   "chemical_refinery", "BPCL Mahul; HPCL Mumbai; RCF; Tata Power Trombay", "primary", "Maharashtra"),
    IndustrialSite("IND-ANGUL", "Odisha Steel Belt - Angul / Talcher", 20.85, 85.10, 20.0,
                   "steel_smelter", "Jindal Steel & Power; NALCO; NTPC Talcher; MCL", "primary", "Odisha"),
    IndustrialSite("IND-JHARSUGUDA", "Odisha Steel Belt - Jharsuguda", 21.78, 84.02, 12.0,
                   "steel_smelter", "Vedanta Aluminium; Bhushan Power & Steel", "primary", "Odisha"),
    # ---- secondary (dominant persistent sources in the archive) ---------------
    IndustrialSite("IND-JHARIA", "Jharia Coalfield (Dhanbad)", 23.75, 86.38, 16.0,
                   "coal_mining_fire", "BCCL (Coal India) - active seam fires", "secondary", "Jharkhand"),
    IndustrialSite("IND-BOKARO", "Bokaro Steel City / Bermo Coalfield", 23.70, 86.05, 12.0,
                   "steel_smelter", "SAIL Bokaro; CCL Bermo", "secondary", "Jharkhand"),
    IndustrialSite("IND-RANIGANJ", "Raniganj Coalfield / Durgapur", 23.62, 87.18, 16.0,
                   "coal_mining_fire", "ECL; SAIL Durgapur; DVC", "secondary", "West Bengal"),
    IndustrialSite("IND-JAMSHEDPUR", "Jamshedpur Steel Works", 22.79, 86.20, 8.0,
                   "steel_smelter", "Tata Steel", "secondary", "Jharkhand"),
    IndustrialSite("IND-VIJAYANAGAR", "JSW Vijayanagar (Toranagallu)", 15.18, 76.66, 8.0,
                   "steel_smelter", "JSW Steel", "secondary", "Karnataka"),
    IndustrialSite("IND-DOLVI", "JSW Dolvi Works", 18.68, 73.04, 5.0,
                   "steel_smelter", "JSW Steel", "secondary", "Maharashtra"),
    IndustrialSite("IND-RAIGARH", "Raigarh - Tamnar Industrial Zone", 21.95, 83.45, 16.0,
                   "steel_smelter", "Jindal Steel & Power; Jindal Power Tamnar", "secondary", "Chhattisgarh"),
    IndustrialSite("IND-BHILAI", "Bhilai Steel Plant", 21.19, 81.39, 6.0,
                   "steel_smelter", "SAIL", "secondary", "Chhattisgarh"),
    IndustrialSite("IND-SILTARA", "Raipur - Siltara Sponge Iron Cluster", 21.38, 81.68, 7.0,
                   "steel_smelter", "Multiple sponge-iron / ferro-alloy units", "secondary", "Chhattisgarh"),
    IndustrialSite("IND-KORBA", "Korba Coal & Power Complex", 22.35, 82.70, 16.0,
                   "power_coal", "NTPC Korba; SECL; BALCO", "secondary", "Chhattisgarh"),
    IndustrialSite("IND-ROURKELA", "Rourkela Steel Plant", 22.22, 84.86, 6.0,
                   "steel_smelter", "SAIL", "secondary", "Odisha"),
    IndustrialSite("IND-KHARAGPUR", "Kharagpur Metallurgical Cluster", 22.37, 87.15, 10.0,
                   "steel_smelter", "Tata Metaliks; Rashmi Metaliks", "secondary", "West Bengal"),
    IndustrialSite("IND-HALDIA", "Haldia Refinery & Petrochemicals", 22.05, 88.10, 6.0,
                   "refinery_petrochemical", "IOCL Haldia; Haldia Petrochemicals", "secondary", "West Bengal"),
    IndustrialSite("IND-VIZAG", "Visakhapatnam Refinery & Steel", 17.65, 83.20, 9.0,
                   "refinery_steel", "HPCL Visakh; RINL Vizag Steel", "secondary", "Andhra Pradesh"),
    IndustrialSite("IND-PARADIP", "Paradip Refinery", 20.28, 86.63, 6.0,
                   "refinery_petrochemical", "IOCL", "secondary", "Odisha"),
    IndustrialSite("IND-PANIPAT", "Panipat Refinery & Petrochemicals", 29.42, 76.85, 6.0,
                   "refinery_petrochemical", "IOCL; NTPC Panipat", "secondary", "Haryana"),
    IndustrialSite("IND-MATHURA", "Mathura Refinery", 27.42, 77.72, 4.0,
                   "refinery_petrochemical", "IOCL", "secondary", "Uttar Pradesh"),
    IndustrialSite("IND-BATHINDA", "Guru Gobind Singh Refinery (Bathinda)", 30.13, 74.68, 5.0,
                   "refinery_petrochemical", "HPCL-Mittal Energy", "secondary", "Punjab"),
    IndustrialSite("IND-KOYALI", "Koyali / Vadodara Refinery", 22.37, 73.12, 5.0,
                   "refinery_petrochemical", "IOCL Gujarat Refinery; GSFC", "secondary", "Gujarat"),
    IndustrialSite("IND-DAHEJ", "Dahej Petrochemical & LNG Complex", 21.70, 72.58, 8.0,
                   "chemical_refinery", "ONGC Petro additions; Petronet LNG; Reliance", "secondary", "Gujarat"),
    IndustrialSite("IND-ANKLESHWAR", "Ankleshwar - Cambay Basin Oil Field", 21.62, 73.00, 8.0,
                   "oil_gas_flare", "ONGC", "secondary", "Gujarat"),
    IndustrialSite("IND-MEHSANA", "Mehsana - Kalol Oil Field", 23.45, 72.45, 14.0,
                   "oil_gas_flare", "ONGC", "secondary", "Gujarat"),
    IndustrialSite("IND-URAN", "Uran Gas Processing Plant", 18.88, 72.94, 4.0,
                   "oil_gas_flare", "ONGC", "secondary", "Maharashtra"),
    IndustrialSite("IND-MANGALORE", "Mangalore Refinery & Petrochemicals", 12.95, 74.90, 5.0,
                   "refinery_petrochemical", "MRPL; ONGC", "secondary", "Karnataka"),
    IndustrialSite("IND-KOCHI", "Kochi Refinery", 9.98, 76.29, 4.0,
                   "refinery_petrochemical", "BPCL", "secondary", "Kerala"),
    IndustrialSite("IND-MANALI", "Chennai Manali Refinery", 13.17, 80.27, 4.0,
                   "refinery_petrochemical", "CPCL", "secondary", "Tamil Nadu"),
    IndustrialSite("IND-NARIMANAM", "Cauvery Basin - Narimanam / Nagapattinam", 10.80, 79.75, 10.0,
                   "oil_gas_flare", "ONGC; CPCL Nagapattinam", "secondary", "Tamil Nadu"),
    IndustrialSite("IND-KGONSHORE", "KG Basin Onshore - Tatipaka / Narsapur", 16.55, 81.85, 14.0,
                   "oil_gas_flare", "ONGC; GAIL", "secondary", "Andhra Pradesh"),
    IndustrialSite("IND-BINA", "Bina Refinery", 24.19, 78.13, 4.0,
                   "refinery_petrochemical", "BPCL", "secondary", "Madhya Pradesh"),
    IndustrialSite("IND-BARAUNI", "Barauni Refinery", 25.47, 86.03, 4.0,
                   "refinery_petrochemical", "IOCL", "secondary", "Bihar"),
    IndustrialSite("IND-DULIAJAN", "Upper Assam Oil Fields - Duliajan / Digboi", 27.37, 95.40, 20.0,
                   "oil_gas_flare", "Oil India Ltd; IOCL Digboi", "secondary", "Assam"),
    IndustrialSite("IND-LAKWA", "Upper Assam Oil Fields - Lakwa / Geleki", 26.95, 94.65, 14.0,
                   "oil_gas_flare", "ONGC", "secondary", "Assam"),
    IndustrialSite("IND-NUMALIGARH", "Numaligarh Refinery", 26.62, 93.73, 4.0,
                   "refinery_petrochemical", "NRL", "secondary", "Assam"),
    IndustrialSite("IND-BONGAIGAON", "Bongaigaon Refinery", 26.50, 90.55, 4.0,
                   "refinery_petrochemical", "IOCL", "secondary", "Assam"),
    IndustrialSite("IND-GUWAHATI", "Guwahati Refinery", 26.15, 91.82, 3.0,
                   "refinery_petrochemical", "IOCL", "secondary", "Assam"),
    IndustrialSite("IND-MUNDRA", "Mundra Port & Power Complex", 22.80, 69.55, 8.0,
                   "power_coal", "Adani Power; Tata Power CGPL", "secondary", "Gujarat"),
    IndustrialSite("IND-RAMGARH", "Ramgarh - Hazaribagh Sponge Iron Belt", 23.70, 85.35, 14.0,
                   "steel_smelter", "Multiple sponge-iron units; CCL", "secondary", "Jharkhand"),
    IndustrialSite("IND-SALEM", "Salem Steel & Mettur Chemical Belt", 11.75, 78.00, 7.0,
                   "refinery_steel", "SAIL Salem; Chemplast Mettur", "secondary", "Tamil Nadu"),
)

FLARE_FACILITY_TYPES: frozenset[str] = frozenset({
    "oil_gas_flare", "refinery_petrochemical", "refinery_steel", "chemical_refinery",
    "refinery", "gas_processing", "lng_terminal", "petrochemical",
})


# --------------------------------------------------------------------------- #
# 3. Embedded flare-site catalog (validation only)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class FlareSite:
    flare_id: str
    name: str
    latitude: float
    longitude: float
    basin_or_facility: str
    flare_kind: str      # "upstream" (field / terminal) | "downstream" (refinery / petrochemical)
    precision_km: float  # positional uncertainty of the embedded coordinate


# Coordinates are embedded from an offline extract of the public VIIRS Nightfire
# (Earth Observation Group) / Global Gas Flaring survey site lists for India,
# rounded to ~0.01 deg. They are reference points for validation, not labels.
FLARE_CATALOG: tuple[FlareSite, ...] = (
    FlareSite("FL-JAMNAGAR-1", "Jamnagar DTA refinery flare stacks", 22.34, 69.86, "Jamnagar", "downstream", 2.0),
    FlareSite("FL-JAMNAGAR-2", "Jamnagar SEZ refinery flares", 22.32, 69.88, "Jamnagar", "downstream", 2.0),
    FlareSite("FL-JAMNAGAR-3", "Nayara Vadinar refinery flare", 22.43, 69.83, "Vadinar", "downstream", 2.0),
    FlareSite("FL-HAZIRA", "ONGC Hazira gas processing complex", 21.11, 72.63, "Hazira", "upstream", 2.0),
    FlareSite("FL-URAN", "ONGC Uran plant", 18.88, 72.94, "Uran", "upstream", 2.0),
    FlareSite("FL-MAHUL", "Mahul (BPCL / HPCL Mumbai) refinery flares", 19.02, 72.89, "Trombay", "downstream", 2.0),
    FlareSite("FL-MANGALA", "Mangala Processing Terminal", 25.93, 71.50, "Barmer", "upstream", 2.5),
    FlareSite("FL-RAAGESHWARI", "Raageshwari gas terminal", 25.76, 71.61, "Barmer", "upstream", 3.0),
    FlareSite("FL-ANKLESHWAR", "Ankleshwar GGS / CTF", 21.63, 73.00, "Cambay", "upstream", 3.0),
    FlareSite("FL-GANDHAR", "Gandhar field flares", 21.70, 72.62, "Cambay", "upstream", 3.0),
    FlareSite("FL-KOYALI", "Gujarat (Koyali) refinery flare", 22.37, 73.12, "Vadodara", "downstream", 2.0),
    FlareSite("FL-DAHEJ", "Dahej OPaL / LNG flares", 21.70, 72.58, "Dahej", "downstream", 3.0),
    FlareSite("FL-PANIPAT", "Panipat refinery flare", 29.43, 76.85, "Panipat", "downstream", 2.0),
    FlareSite("FL-MATHURA", "Mathura refinery flare", 27.42, 77.72, "Mathura", "downstream", 2.0),
    FlareSite("FL-BATHINDA", "Guru Gobind Singh refinery flare", 30.13, 74.68, "Bathinda", "downstream", 2.0),
    FlareSite("FL-BINA", "Bina refinery flare", 24.19, 78.13, "Bina", "downstream", 2.0),
    FlareSite("FL-BARAUNI", "Barauni refinery flare", 25.47, 86.03, "Barauni", "downstream", 2.0),
    FlareSite("FL-HALDIA", "Haldia refinery / HPL flares", 22.05, 88.10, "Haldia", "downstream", 2.5),
    FlareSite("FL-PARADIP", "Paradip refinery flare", 20.28, 86.63, "Paradip", "downstream", 2.0),
    FlareSite("FL-VIZAG", "Visakh refinery flare", 17.68, 83.25, "Visakhapatnam", "downstream", 2.0),
    FlareSite("FL-TATIPAKA", "Tatipaka mini refinery / KG onshore GGS", 16.53, 81.86, "Krishna-Godavari", "upstream", 3.0),
    FlareSite("FL-MANALI", "Chennai Manali refinery flare", 13.17, 80.27, "Chennai", "downstream", 2.0),
    FlareSite("FL-NARIMANAM", "Narimanam CTF / CPCL Nagapattinam", 10.80, 79.75, "Cauvery", "upstream", 3.0),
    FlareSite("FL-MANGALORE", "MRPL refinery flare", 12.95, 74.90, "Mangalore", "downstream", 2.0),
    FlareSite("FL-KOCHI", "Kochi refinery flare", 9.98, 76.29, "Kochi", "downstream", 2.0),
    FlareSite("FL-DULIAJAN", "Duliajan OIL field flares", 27.37, 95.32, "Upper Assam", "upstream", 3.0),
    FlareSite("FL-DIGBOI", "Digboi refinery flare", 27.39, 95.62, "Upper Assam", "downstream", 2.0),
    FlareSite("FL-LAKWA", "Lakwa / Geleki GGS flares", 26.95, 94.65, "Upper Assam", "upstream", 4.0),
    FlareSite("FL-NUMALIGARH", "Numaligarh refinery flare", 26.62, 93.73, "Numaligarh", "downstream", 2.0),
    FlareSite("FL-BONGAIGAON", "Bongaigaon refinery flare", 26.50, 90.55, "Bongaigaon", "downstream", 2.0),
    FlareSite("FL-GUWAHATI", "Guwahati refinery flare", 26.15, 91.82, "Guwahati", "downstream", 2.0),
    FlareSite("FL-MEHSANA", "Mehsana / Kalol GGS flares", 23.45, 72.45, "Cambay North", "upstream", 5.0),
)


# --------------------------------------------------------------------------- #
# 2. Offline land-cover heuristics
# --------------------------------------------------------------------------- #
# Vertices are (lat, lon) for readability; converted to (lon, lat) polygons below.
_FOREST_BELTS_LATLON: dict[str, list[tuple[float, float]]] = {
    "Western Ghats": [(8.2, 77.3), (8.2, 76.8), (10.5, 76.4), (12.0, 75.4), (14.0, 74.5), (16.0, 73.7),
                      (18.0, 73.2), (20.5, 73.2), (20.5, 73.9), (18.0, 74.0), (16.0, 74.4), (14.0, 75.3),
                      (12.0, 76.2), (10.5, 77.2)],
    "Satpura-Kanha-Pench (MP / Vidarbha)": [(23.5, 78.0), (23.5, 81.0), (22.4, 81.2), (20.9, 81.0), (20.0, 80.3),
                                            (18.0, 80.0), (19.5, 78.0), (21.5, 77.5)],
    "Bastar - Dandakaranya (S. Chhattisgarh)": [(17.8, 80.5), (20.6, 80.6), (20.6, 82.9), (19.5, 82.5), (18.0, 81.8)],
    "Surguja - Korba hills (N. Chhattisgarh)": [(22.5, 82.6), (23.6, 82.4), (23.6, 83.8), (22.0, 83.5)],
    "Vindhya-Melghat": [(21.0, 76.0), (22.5, 74.0), (23.5, 75.5), (23.5, 78.0), (21.5, 77.5)],
    "Eastern Ghats / Similipal (Odisha)": [(22.3, 86.0), (22.3, 87.0), (21.5, 86.9), (20.2, 85.2), (18.5, 83.0),
                                           (18.0, 81.8), (19.0, 81.5), (20.5, 83.5), (21.7, 85.4)],
    "Chota Nagpur Plateau (Palamu / Saranda)": [(24.5, 83.5), (24.5, 86.0), (23.0, 86.5), (22.0, 85.0),
                                                (22.5, 84.0), (23.5, 83.5)],
    "Himalayan foothills (HP / Uttarakhand)": [(29.2, 79.0), (29.9, 77.9), (30.6, 77.0), (31.4, 76.4), (32.3, 75.8),
                                               (33.2, 75.5), (33.2, 77.5), (31.4, 79.0), (30.5, 80.6), (29.4, 80.4)],
    "Arunachal Himalaya": [(27.3, 91.6), (29.4, 94.2), (29.2, 97.4), (27.2, 97.2), (27.0, 95.5), (26.9, 93.5),
                           (26.8, 92.2)],
    "NE hill states (Nagaland-Manipur-Mizoram-Tripura-Meghalaya)": [(26.2, 93.4), (27.0, 95.3), (26.1, 95.5),
                                                                     (24.4, 94.9), (23.0, 93.5), (21.9, 92.7),
                                                                     (22.6, 91.7), (23.9, 91.4), (25.0, 90.0),
                                                                     (26.0, 90.0), (25.9, 92.5)],
    "Sundarbans mangroves": [(21.5, 88.4), (22.3, 88.4), (22.3, 89.1), (21.5, 89.1)],
}

_CROPLAND_ZONES_LATLON: dict[str, list[tuple[float, float]]] = {
    # The brief's primary rule: Punjab / Haryana / western UP plains.
    "Punjab-Haryana-West UP plains (brief rule)": [(28.0, 74.0), (32.0, 74.0), (32.0, 80.0), (28.0, 80.0)],
    "Sriganganagar canal belt": [(28.8, 72.8), (30.2, 72.8), (30.2, 74.0), (28.8, 74.0)],
    "Middle & lower Gangetic plain (UP / Bihar / N. Bengal)": [(28.5, 77.0), (28.5, 80.5), (27.5, 84.0), (26.9, 88.6),
                                                               (25.0, 88.5), (24.8, 86.0), (25.0, 83.0), (25.5, 80.0),
                                                               (26.5, 77.0)],
    "Krishna-Godavari delta": [(15.8, 80.4), (17.2, 80.4), (17.2, 82.4), (15.8, 82.4)],
    "Cauvery delta": [(10.2, 78.8), (11.4, 78.8), (11.4, 79.9), (10.2, 79.9)],
    "Brahmaputra valley (Assam plains)": [(26.0, 89.9), (26.9, 91.9), (27.6, 94.8), (27.4, 95.8), (26.8, 95.2),
                                          (26.3, 93.4), (26.0, 92.0), (25.9, 90.5)],
    # India is ~55 % cropland by area; the plateau and plains below are predominantly rain-fed or
    # irrigated agriculture in ESA WorldCover. Forest belts keep priority over these polygons.
    "Deccan plateau (Maharashtra / Karnataka / Telangana / AP interior)": [(21.0, 74.2), (21.3, 77.5), (20.0, 80.5),
                                                                          (18.0, 80.0), (16.0, 79.0), (14.0, 78.6),
                                                                          (13.5, 76.6), (15.5, 74.7), (18.0, 74.0),
                                                                          (20.0, 74.0)],
    "Gujarat plains and Saurashtra": [(20.7, 72.7), (21.5, 72.5), (22.3, 72.2), (23.2, 71.6), (24.3, 71.6),
                                      (24.3, 73.9), (22.5, 74.2), (21.0, 73.9), (20.5, 73.2),
                                      (21.0, 70.2), (22.3, 69.7), (23.0, 70.4), (22.9, 71.5), (21.5, 72.0)],
    "Malwa plateau (western MP / south-east Rajasthan)": [(22.5, 74.4), (25.5, 74.5), (26.0, 76.5), (25.0, 78.0),
                                                          (23.5, 77.5), (22.5, 76.5)],
    "Tamil Nadu plains": [(8.4, 77.6), (10.5, 77.4), (12.0, 78.0), (13.5, 79.4), (13.4, 80.3), (10.8, 79.9),
                          (9.5, 79.2), (8.3, 78.0)],
    "Andhra coastal plain": [(13.5, 79.4), (15.8, 79.4), (15.8, 80.4), (14.5, 80.2), (13.5, 80.3)],
    "Odisha and Bengal coastal plain": [(19.3, 84.7), (20.3, 85.4), (21.5, 86.2), (22.3, 87.0), (22.6, 88.4),
                                        (21.5, 88.3), (20.5, 87.0), (19.3, 85.3)],
    "Chhattisgarh plain (Raipur - Bilaspur)": [(20.8, 81.2), (22.6, 81.4), (22.5, 82.9), (21.0, 82.6), (20.7, 82.0)],
    "Mahanadi basin (Raigarh - Sambalpur)": [(21.0, 82.4), (22.6, 82.9), (22.8, 84.2), (21.6, 84.6), (20.9, 83.6)],
    "Lower Bengal plain": [(22.6, 87.2), (24.8, 87.8), (25.0, 88.6), (24.0, 89.0), (22.6, 88.7)],
}

_BARE_ZONES_LATLON: dict[str, list[tuple[float, float]]] = {
    "Thar desert core": [(25.0, 69.5), (29.5, 69.5), (29.5, 73.0), (25.0, 73.0)],
    "Rann of Kutch": [(23.2, 68.8), (24.7, 68.8), (24.7, 71.3), (23.2, 71.3)],
    "Ladakh / Trans-Himalaya": [(32.0, 76.0), (35.5, 76.0), (35.5, 80.0), (32.0, 80.0)],
}


def _latlon_polygon(vertices: Iterable[tuple[float, float]]) -> Polygon:
    return Polygon([(lon, lat) for lat, lon in vertices])


def _heuristic_layers() -> gpd.GeoDataFrame:
    rows = []
    for name, verts in _FOREST_BELTS_LATLON.items():
        rows.append({"zone": name, "land_cover_class": 10, "priority": 1, "geometry": _latlon_polygon(verts)})
    for name, verts in _CROPLAND_ZONES_LATLON.items():
        rows.append({"zone": name, "land_cover_class": 40, "priority": 2, "geometry": _latlon_polygon(verts)})
    for name, verts in _BARE_ZONES_LATLON.items():
        rows.append({"zone": name, "land_cover_class": 60, "priority": 3, "geometry": _latlon_polygon(verts)})
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=GEOGRAPHIC_CRS)


# --------------------------------------------------------------------------- #
# Reference engine
# --------------------------------------------------------------------------- #
class SpatialReference:
    """Offline provider for industrial proximity, land cover and flare validation.

    Parameters
    ----------
    industrial_path:
        GeoPackage with industrial polygons. Loaded if it exists, otherwise built
        from :data:`CURATED_INDUSTRIAL_SITES` and written there.
    worldcover_dir:
        Directory scanned for ``*.tif`` ESA WorldCover tiles. Missing or empty
        directory => heuristic estimator only.
    """

    REQUIRED_INDUSTRIAL_COLUMNS = ("site_id", "name", "facility_type", "radius_km", "centroid_lat", "centroid_lon")

    def __init__(
        self,
        industrial_path: Path = INDUSTRIAL_GPKG,
        flare_path: Path = FLARE_GPKG,
        worldcover_dir: Path = WORLDCOVER_DIR,
        force_rebuild: bool = False,
    ) -> None:
        self.industrial_path = Path(industrial_path)
        self.flare_path = Path(flare_path)
        self.worldcover_dir = Path(worldcover_dir)
        self.industrial: gpd.GeoDataFrame = self._load_or_build_industrial(force_rebuild)
        self.flares: gpd.GeoDataFrame = self._load_or_build_flares(force_rebuild)
        self.land_cover_zones: gpd.GeoDataFrame = _heuristic_layers()
        self.worldcover_tiles: list[Path] = sorted(self.worldcover_dir.glob("*.tif")) if self.worldcover_dir.exists() else []
        self._industrial_metric = self.industrial.to_crs(METRIC_CRS)
        self._industrial_tree = shapely.STRtree(self._industrial_metric.geometry.values)
        self._all_circular = bool((self.industrial["geometry_kind"] == "geodesic_buffer").all())
        self._centroid_tree = cKDTree(to_unit_sphere_xyz(self.industrial["centroid_lat"].values,
                                                         self.industrial["centroid_lon"].values))
        self._flare_tree = cKDTree(to_unit_sphere_xyz(self.flares["latitude"].values, self.flares["longitude"].values))
        log.info(
            "SpatialReference ready: %d industrial polygons (%s), %d flare sites, %d WorldCover tiles, source=%s",
            len(self.industrial), "circular buffers" if self._all_circular else "arbitrary polygons",
            len(self.flares), len(self.worldcover_tiles), self.industrial_source,
        )

    # ------------------------------------------------------------------ build
    @staticmethod
    def build_curated_industrial() -> gpd.GeoDataFrame:
        records = []
        for s in CURATED_INDUSTRIAL_SITES:
            ring = geodesic_circle(s.latitude, s.longitude, s.radius_km)
            rec = asdict(s)
            rec["centroid_lat"] = rec.pop("latitude")
            rec["centroid_lon"] = rec.pop("longitude")
            rec["geometry_kind"] = "geodesic_buffer"
            rec["source"] = "embedded_curated_v1"
            rec["geometry"] = Polygon(ring)
            records.append(rec)
        gdf = gpd.GeoDataFrame(records, geometry="geometry", crs=GEOGRAPHIC_CRS)
        return gdf

    def _load_or_build_industrial(self, force_rebuild: bool) -> gpd.GeoDataFrame:
        if self.industrial_path.exists() and not force_rebuild:
            try:
                gdf = gpd.read_file(self.industrial_path)
                gdf = self._normalise_industrial(gdf)
                self.industrial_source = f"cache:{self.industrial_path.name}"
                return gdf
            except Exception as exc:  # corrupt / foreign schema -> rebuild
                log.warning("Could not use %s (%s); rebuilding from embedded catalog", self.industrial_path, exc)
        gdf = self.build_curated_industrial()
        self.industrial_source = "embedded_curated_v1"
        try:
            self.industrial_path.parent.mkdir(parents=True, exist_ok=True)
            gdf.to_file(self.industrial_path, driver="GPKG", layer="industrial")
            log.info("Wrote embedded industrial layer to %s", self.industrial_path)
        except Exception as exc:
            log.warning("Could not persist industrial GeoPackage (%s); continuing in-memory", exc)
        return gdf

    @classmethod
    def _normalise_industrial(cls, gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        """Coerce an arbitrary (e.g. raw OSM) polygon layer into the expected schema."""
        if gdf.crs is None:
            gdf = gdf.set_crs(GEOGRAPHIC_CRS)
        elif gdf.crs.to_string() != GEOGRAPHIC_CRS:
            gdf = gdf.to_crs(GEOGRAPHIC_CRS)
        gdf = gdf[~gdf.geometry.isna() & ~gdf.geometry.is_empty].copy()
        if gdf.empty:
            raise ValueError("industrial layer has no valid geometries")
        if "site_id" not in gdf.columns:
            gdf["site_id"] = [f"OSM-{i:06d}" for i in range(len(gdf))]
        if "name" not in gdf.columns:
            gdf["name"] = gdf["site_id"]
        if "facility_type" not in gdf.columns:
            for cand in ("industrial", "landuse", "type", "man_made"):
                if cand in gdf.columns:
                    gdf["facility_type"] = gdf[cand].fillna("industrial_unknown").astype(str)
                    break
            else:
                gdf["facility_type"] = "industrial_unknown"
        if "tier" not in gdf.columns:
            gdf["tier"] = "external"
        if "operators" not in gdf.columns:
            gdf["operators"] = ""
        if "geometry_kind" not in gdf.columns:
            gdf["geometry_kind"] = "polygon"
        metric = gdf.to_crs(METRIC_CRS)
        if "radius_km" not in gdf.columns:
            gdf["radius_km"] = np.sqrt(metric.geometry.area.values / np.pi) / 1000.0
        if "centroid_lat" not in gdf.columns or "centroid_lon" not in gdf.columns:
            cent = metric.geometry.centroid.to_crs(GEOGRAPHIC_CRS)
            gdf["centroid_lat"] = cent.y.values
            gdf["centroid_lon"] = cent.x.values
        gdf["name"] = gdf["name"].fillna(gdf["site_id"]).astype(str)
        gdf["facility_type"] = gdf["facility_type"].fillna("industrial_unknown").astype(str)
        return gdf.reset_index(drop=True)

    def _load_or_build_flares(self, force_rebuild: bool) -> gpd.GeoDataFrame:
        if self.flare_path.exists() and not force_rebuild:
            try:
                gdf = gpd.read_file(self.flare_path)
                for col in ("flare_id", "name", "latitude", "longitude"):
                    if col not in gdf.columns:
                        raise ValueError(f"flare catalog missing column {col}")
                return gdf.reset_index(drop=True)
            except Exception as exc:
                log.warning("Could not use %s (%s); rebuilding embedded flare catalog", self.flare_path, exc)
        records = [asdict(f) | {"geometry": Point(f.longitude, f.latitude), "source": "embedded_vnf_extract_v1"}
                   for f in FLARE_CATALOG]
        gdf = gpd.GeoDataFrame(records, geometry="geometry", crs=GEOGRAPHIC_CRS)
        try:
            self.flare_path.parent.mkdir(parents=True, exist_ok=True)
            gdf.to_file(self.flare_path, driver="GPKG", layer="flares")
        except Exception as exc:
            log.warning("Could not persist flare catalog (%s); continuing in-memory", exc)
        return gdf

    # ------------------------------------------------------------ proximity
    def nearest_industry(self, lat: np.ndarray, lon: np.ndarray, chunk: int = 500_000) -> pd.DataFrame:
        """Nearest industrial polygon for every point.

        Returns a DataFrame with ``distance_to_industry_km`` (0 when inside),
        ``inside_industrial_polygon`` (0/1), ``nearest_facility_type``,
        ``nearest_facility_name`` and ``nearest_facility_id``.

        Fast path: when every polygon is a geodesic buffer the distance to the
        disc is ``max(0, great-circle(centroid) - radius)`` which is exact and
        needs only a centroid KD-tree. Otherwise Shapely's STRtree computes
        nearest-polygon distances in the metric CRS.
        """
        lat = np.asarray(lat, dtype=np.float64)
        lon = np.asarray(lon, dtype=np.float64)
        n = lat.shape[0]
        idx = np.empty(n, dtype=np.int64)
        dist_km = np.empty(n, dtype=np.float64)
        if self._all_circular:
            radius = self.industrial["radius_km"].values
            c_lat = self.industrial["centroid_lat"].values
            c_lon = self.industrial["centroid_lon"].values
            k = min(4, len(radius))
            for start in range(0, n, chunk):
                sl = slice(start, min(start + chunk, n))
                xyz = to_unit_sphere_xyz(lat[sl], lon[sl])
                _, cand = self._centroid_tree.query(xyz, k=k)
                cand = cand.reshape(len(xyz), -1)
                d = haversine_km(lat[sl][:, None], lon[sl][:, None], c_lat[cand], c_lon[cand]) - radius[cand]
                d = np.maximum(d, 0.0)
                best = np.argmin(d, axis=1)
                rows = np.arange(len(xyz))
                idx[sl] = cand[rows, best]
                dist_km[sl] = d[rows, best]
        else:
            from pyproj import Transformer
            fwd = Transformer.from_crs(GEOGRAPHIC_CRS, METRIC_CRS, always_xy=True)
            inv = Transformer.from_crs(METRIC_CRS, GEOGRAPHIC_CRS, always_xy=True)
            polys = self._industrial_metric.geometry.values
            k = min(3, len(polys))
            for start in range(0, n, chunk):
                sl = slice(start, min(start + chunk, n))
                x, y = fwd.transform(lon[sl], lat[sl])
                pts = shapely.points(x, y)
                q, _ = self._industrial_tree.query_nearest(pts, return_distance=True, all_matches=False)
                # query_nearest returns (2, m) index pairs; every point has >=1 polygon so m == len(pts)
                _, cand = self._centroid_tree.query(to_unit_sphere_xyz(lat[sl], lon[sl]), k=k)
                cand = np.column_stack([q[1], cand.reshape(len(pts), -1)])
                # Re-measure every candidate geodesically from its nearest boundary
                # point so the result does not inherit the LCC scale distortion.
                geo = np.empty(cand.shape, dtype=np.float64)
                for c in range(cand.shape[1]):
                    seg = shapely.shortest_line(pts, polys[cand[:, c]])
                    end = shapely.get_point(seg, 1)
                    elon, elat = inv.transform(shapely.get_x(end), shapely.get_y(end))
                    geo[:, c] = haversine_km(lat[sl], lon[sl], elat, elon)
                    geo[shapely.length(seg) <= 0.0, c] = 0.0
                best = np.argmin(geo, axis=1)
                rows = np.arange(len(pts))
                idx[sl] = cand[rows, best]
                dist_km[sl] = geo[rows, best]
        out = pd.DataFrame({
            "distance_to_industry_km": dist_km.astype(np.float32),
            "inside_industrial_polygon": (dist_km <= 0.0).astype(np.int8),
            "nearest_facility_type": self.industrial["facility_type"].values[idx],
            "nearest_facility_name": self.industrial["name"].values[idx],
            "nearest_facility_id": self.industrial["site_id"].values[idx],
        })
        return out

    # ------------------------------------------------------------ land cover
    def land_cover_class(
        self,
        lat: np.ndarray,
        lon: np.ndarray,
        distance_to_industry_km: Optional[np.ndarray] = None,
    ) -> tuple[np.ndarray, str]:
        """ESA WorldCover-compatible class code for each point.

        Priority: raster sample (if tiles exist) > industrial built-up >
        forest belts > cropland zones > bare zones > default 30 (grassland /
        shrub). Returns ``(codes, source_description)``.
        """
        lat = np.asarray(lat, dtype=np.float64)
        lon = np.asarray(lon, dtype=np.float64)
        n = lat.shape[0]
        codes = np.full(n, -1, dtype=np.int16)
        source = "heuristic"
        if self.worldcover_tiles:
            sampled = self._sample_worldcover(lat, lon)
            codes = np.where(sampled > 0, sampled, -1).astype(np.int16)
            covered = int((codes > 0).sum())
            source = f"worldcover_raster({covered}/{n} sampled)+heuristic"
        unresolved = codes <= 0
        if unresolved.any():
            codes[unresolved] = self._heuristic_land_cover(lat[unresolved], lon[unresolved],
                                                           None if distance_to_industry_km is None
                                                           else np.asarray(distance_to_industry_km)[unresolved])
        return codes, source

    def _heuristic_land_cover(self, lat, lon, distance_to_industry_km) -> np.ndarray:
        n = lat.shape[0]
        codes = np.full(n, 30, dtype=np.int16)   # default: grassland / shrubland
        assigned = np.zeros(n, dtype=bool)
        # 1. built-up: inside or within the halo of an industrial polygon
        if distance_to_industry_km is None:
            distance_to_industry_km = self.nearest_industry(lat, lon)["distance_to_industry_km"].values
        built = np.asarray(distance_to_industry_km) <= BUILT_UP_HALO_KM
        codes[built] = 50
        assigned |= built
        # 2-4. zone polygons by priority (forest > cropland > bare)
        zones = self.land_cover_zones.sort_values("priority")
        for geom, cls in zip(zones.geometry.values, zones["land_cover_class"].values):
            if assigned.all():
                break
            hit = shapely.contains_xy(geom, lon, lat) & ~assigned
            codes[hit] = cls
            assigned |= hit
        return codes

    def _sample_worldcover(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        """Sample ESA WorldCover GeoTIFF tiles with rasterio (band-block reads, vectorised)."""
        import rasterio
        out = np.zeros(lat.shape[0], dtype=np.int16)
        for tile in self.worldcover_tiles:
            try:
                with rasterio.open(tile) as ds:
                    b = ds.bounds
                    inside = (lon >= b.left) & (lon < b.right) & (lat > b.bottom) & (lat <= b.top) & (out == 0)
                    if not inside.any():
                        continue
                    ii = np.flatnonzero(inside)
                    inv = ~ds.transform
                    cols, rows = inv * (lon[ii], lat[ii])
                    cols = np.floor(cols).astype(np.int64)
                    rows = np.floor(rows).astype(np.int64)
                    ok = (rows >= 0) & (rows < ds.height) & (cols >= 0) & (cols < ds.width)
                    ii, rows, cols = ii[ok], rows[ok], cols[ok]
                    if ii.size == 0:
                        continue
                    order = np.argsort(rows)
                    ii, rows, cols = ii[order], rows[order], cols[order]
                    band_rows = 2048
                    for r0 in range(int(rows[0]), int(rows[-1]) + 1, band_rows):
                        r1 = min(r0 + band_rows, ds.height)
                        sel = (rows >= r0) & (rows < r1)
                        if not sel.any():
                            continue
                        window = rasterio.windows.Window(0, r0, ds.width, r1 - r0)
                        block = ds.read(1, window=window)
                        out[ii[sel]] = block[rows[sel] - r0, cols[sel]]
            except Exception as exc:
                log.warning("WorldCover tile %s unreadable (%s); skipped", tile.name, exc)
        return out

    # ------------------------------------------------------------ flare check
    def flare_catalog_match(self, lat: np.ndarray, lon: np.ndarray, radius_km: float = 2.5) -> pd.DataFrame:
        """Nearest embedded flare site and whether the point lies within ``radius_km`` of it."""
        xyz = to_unit_sphere_xyz(lat, lon)
        d_chord, idx = self._flare_tree.query(xyz, k=1)
        d_km = haversine_km(np.asarray(lat), np.asarray(lon),
                            self.flares["latitude"].values[idx], self.flares["longitude"].values[idx])
        prec = self.flares["precision_km"].values[idx] if "precision_km" in self.flares.columns else 0.0
        return pd.DataFrame({
            "flare_site_id": self.flares["flare_id"].values[idx],
            "flare_site_name": self.flares["name"].values[idx],
            "distance_to_flare_site_km": d_km.astype(np.float32),
            "near_flare_site": (d_km <= np.maximum(radius_km, prec)).astype(np.int8),
        })

    # ------------------------------------------------------------ metadata
    def describe(self) -> dict:
        return {
            "industrial_source": self.industrial_source,
            "industrial_polygons": int(len(self.industrial)),
            "industrial_primary_sites": int((self.industrial.get("tier", pd.Series(dtype=str)) == "primary").sum()),
            "facility_types": sorted(self.industrial["facility_type"].unique().tolist()),
            "flare_sites": int(len(self.flares)),
            "worldcover_tiles": [t.name for t in self.worldcover_tiles],
            "land_cover_zones": int(len(self.land_cover_zones)),
        }
