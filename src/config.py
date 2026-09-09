"""Central configuration: filesystem layout and physical/algorithmic constants.

Every path is resolved relative to the repository root so the pipeline can be
launched from any working directory (``python src/run_pipeline.py`` or
``python -m src.run_pipeline``).
"""
from __future__ import annotations

from pathlib import Path

# --------------------------------------------------------------------------- #
# Filesystem layout
# --------------------------------------------------------------------------- #
PROJECT_ROOT: Path = Path(__file__).resolve().parents[1]
DATA_DIR: Path = PROJECT_ROOT / "data"
RAW_DIR: Path = DATA_DIR / "raw"
CACHE_DIR: Path = DATA_DIR / "cache"
WORLDCOVER_DIR: Path = CACHE_DIR / "worldcover"
MODELS_DIR: Path = DATA_DIR / "models"

INDUSTRIAL_GPKG: Path = CACHE_DIR / "osm_industrial.gpkg"
FLARE_GPKG: Path = CACHE_DIR / "flare_catalog.gpkg"
SQLITE_DB: Path = DATA_DIR / "hotspots.db"
GEOJSON_OUT: Path = DATA_DIR / "latest_hotspots.geojson"
CLUSTERS_GEOJSON_OUT: Path = DATA_DIR / "latest_clusters.geojson"
CONSOLE_JSON_OUT: Path = DATA_DIR / "hotspots.json"      # operator-console schema, read by backend/app.py
SUMMARY_JSON: Path = DATA_DIR / "pipeline_summary.json"
MODEL_PATH: Path = MODELS_DIR / "fire_classifier.pkl"

# Legacy folders where the raw FIRMS downloads were originally dropped. They are
# only consulted if ``data/raw`` contains no CSV at all.
LEGACY_RAW_DIRS: tuple[Path, ...] = (
    PROJECT_ROOT / "viirs jpss data",
    PROJECT_ROOT / "viirs snpp data",
)

# --------------------------------------------------------------------------- #
# Geodesy
# --------------------------------------------------------------------------- #
EARTH_RADIUS_KM: float = 6371.0088          # IUGG mean Earth radius
EARTH_RADIUS_M: float = EARTH_RADIUS_KM * 1000.0
METRIC_CRS: str = "EPSG:7755"               # WGS 84 / India NSF LCC (metres)
GEOGRAPHIC_CRS: str = "EPSG:4326"

# --------------------------------------------------------------------------- #
# Cleaning
# --------------------------------------------------------------------------- #
DEDUP_RADIUS_M: float = 100.0
DEDUP_WINDOW_MIN: float = 5.0
VIIRS_CONFIDENCE_MAP: dict[str, float] = {"l": 30.0, "n": 60.0, "h": 90.0}

# --------------------------------------------------------------------------- #
# Feature engineering
# --------------------------------------------------------------------------- #
PERSISTENCE_RADIUS_KM: float = 1.0
PERSISTENCE_WINDOWS_DAYS: tuple[int, ...] = (1, 3, 7)
PERSISTENCE_LONG_WINDOW_DAYS: int = 30
DENSITY_RADIUS_KM: float = 5.0
DENSITY_HALF_WINDOW_HOURS: float = 3.0      # +/- 3 h == 6 h rolling window
BUILT_UP_HALO_KM: float = 1.5               # distance from an industrial polygon still treated as built-up

# --------------------------------------------------------------------------- #
# Classifier
# --------------------------------------------------------------------------- #
CONFIDENCE_THRESHOLD: float = 0.60
UNKNOWN_CLASS: int = 5
CLASS_LABELS: dict[int, str] = {
    0: "Wildfire",
    1: "Agricultural burning",
    2: "Industrial fire",
    3: "Gas flare",
    4: "Persistent thermal source",
    5: "Unknown",
}
RANDOM_STATE: int = 42

# --------------------------------------------------------------------------- #
# Clustering
# --------------------------------------------------------------------------- #
DBSCAN_EPS_KM: float = 3.0
DBSCAN_MIN_SAMPLES: int = 3
OUTBREAK_MIN_COUNT: int = 5
OUTBREAK_MAX_MEAN_PERSISTENCE_DAYS: float = 1.0
PERSISTENT_CLUSTER_MIN_MEAN_PERSISTENCE_DAYS: float = 3.0

# --------------------------------------------------------------------------- #
# Console export (data/hotspots.json)
# --------------------------------------------------------------------------- #
CONSOLE_MAX_RECORDS: int = 3000            # cap so the Leaflet console renders every record as a marker
CONSOLE_MIN_PER_CLASS: int = 40            # floor per class before filling by priority
CONSOLE_FACILITY_CONTEXT_KM: float = 25.0  # nearest_facility_type is null beyond this distance

# ESA WorldCover class codes (subset used by the offline estimator)
LAND_COVER_NAMES: dict[int, str] = {
    10: "Tree cover",
    20: "Shrubland",
    30: "Grassland",
    40: "Cropland",
    50: "Built-up",
    60: "Bare / sparse vegetation",
    70: "Snow and ice",
    80: "Permanent water bodies",
    90: "Herbaceous wetland",
    95: "Mangroves",
    100: "Moss and lichen",
}
