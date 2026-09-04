"""Vectorised spatio-temporal feature engineering for FIRMS hotspots.

Features produced (all computed without any network access):

Temporal persistence (VIIRS-Nightfire rationale, 1 km buffer)
    persistence_1d / 3d / 7d / 30d : number of *distinct prior UTC days* in the
                                     trailing window with >=1 detection within
                                     1 km (units: days; 0..N).
    prior_detections_7d            : raw count of detections within 1 km in the
                                     trailing 7 x 24 h (strictly earlier).
    same_day_detections            : other detections within 1 km on the same
                                     UTC day (multi-overpass / multi-satellite
                                     agreement).
Industrial proximity (SpatialReference)
    distance_to_industry_km, inside_industrial_polygon, nearest_facility_type,
    nearest_facility_name, nearest_facility_id
Land cover
    land_cover_class (ESA WorldCover codes; raster if available else heuristic)
Local density
    hotspot_density : detections within 5 km inside a 6 h window centred on the
                      detection (+/- 3 h), excluding self.
Radiometric / temporal helpers
    brightness_contrast, frp_density, is_night, local_hour, month,
    doy_sin, doy_cos
Validation helpers (not model inputs)
    distance_to_flare_site_km, near_flare_site, flare_site_id

The heavy neighbour searches are performed with ``scipy.spatial.cKDTree`` on
3-D unit-sphere coordinates in *temporal blocks*, so memory stays bounded even
for multi-year national archives (6 M+ rows).
"""
from __future__ import annotations

import logging
import time
from typing import Optional, Sequence

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from src.config import (
    DENSITY_HALF_WINDOW_HOURS,
    DENSITY_RADIUS_KM,
    PERSISTENCE_LONG_WINDOW_DAYS,
    PERSISTENCE_RADIUS_KM,
    PERSISTENCE_WINDOWS_DAYS,
)
from src.pipeline.geo_utils import to_unit_sphere_xyz
from src.pipeline.spatial_reference import SpatialReference

log = logging.getLogger(__name__)

SECONDS_PER_DAY = 86_400


def _time_arrays(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    t = df["datetime_utc"].values.astype("datetime64[s]").astype(np.int64)
    day = t // SECONDS_PER_DAY
    return t, day


def _assert_sorted(t: np.ndarray) -> None:
    if len(t) > 1 and np.any(np.diff(t) < 0):
        raise ValueError("feature engineering requires the frame to be sorted by datetime_utc")


# --------------------------------------------------------------------------- #
# 1. Temporal persistence
# --------------------------------------------------------------------------- #
def compute_persistence(
    df: pd.DataFrame,
    radius_km: float = PERSISTENCE_RADIUS_KM,
    windows_days: Sequence[int] = PERSISTENCE_WINDOWS_DAYS,
    long_window_days: int = PERSISTENCE_LONG_WINDOW_DAYS,
    block_days: int = 10,
) -> pd.DataFrame:
    """Distinct-day persistence counts within ``radius_km`` for trailing windows.

    The archive is processed in blocks of ``block_days`` query days; the
    reference set for a block is everything from ``block_start - long_window``
    to ``block_end`` so each query sees its full look-back exactly once.
    """
    n = len(df)
    windows = sorted(set(int(w) for w in windows_days) | {int(long_window_days)})
    cols = {f"persistence_{w}d": np.zeros(n, dtype=np.int16) for w in windows}
    prior7 = np.zeros(n, dtype=np.int32)
    same_day = np.zeros(n, dtype=np.int32)
    if n == 0:
        out = pd.DataFrame(cols)
        out["prior_detections_7d"] = prior7
        out["same_day_detections"] = same_day
        return out

    t, day = _time_arrays(df)
    _assert_sorted(t)
    xyz = to_unit_sphere_xyz(df["latitude"].values, df["longitude"].values)
    r_m = radius_km * 1000.0
    long_w = int(long_window_days)
    day_min, day_max = int(day[0]), int(day[-1])
    t0 = time.time()
    n_pairs = 0
    for d0 in range(day_min, day_max + 1, block_days):
        d1 = d0 + block_days
        q_start = int(np.searchsorted(day, d0, side="left"))
        q_end = int(np.searchsorted(day, d1, side="left"))
        if q_end <= q_start:
            continue
        r_start = int(np.searchsorted(day, d0 - long_w, side="left"))
        r_end = q_end
        nq = q_end - q_start
        qtree = cKDTree(xyz[q_start:q_end])
        rtree = cKDTree(xyz[r_start:r_end])
        pairs = qtree.sparse_distance_matrix(rtree, r_m, output_type="ndarray")
        if len(pairs) == 0:
            continue
        n_pairs += len(pairs)
        qi = pairs["i"].astype(np.int64)            # local query index (0..nq-1)
        rj = pairs["j"].astype(np.int64) + r_start  # global reference index
        qg = qi + q_start
        ddays = day[qg] - day[rj]
        # ---- distinct prior days per query point ----
        m = (ddays >= 1) & (ddays <= long_w)
        if m.any():
            key = qi[m] * (long_w + 1) + ddays[m]
            uniq = np.unique(key)
            ui = uniq // (long_w + 1)
            ud = uniq % (long_w + 1)
            for w in windows:
                cols[f"persistence_{w}d"][q_start:q_end] += np.bincount(ui[ud <= w], minlength=nq).astype(np.int16)
        # ---- raw prior detections in trailing 7 x 24 h ----
        dts = t[qg] - t[rj]
        m7 = (dts > 0) & (dts <= 7 * SECONDS_PER_DAY)
        prior7[q_start:q_end] += np.bincount(qi[m7], minlength=nq).astype(np.int32)
        # ---- same UTC day, other detections ----
        ms = (ddays == 0) & (qg != rj)
        same_day[q_start:q_end] += np.bincount(qi[ms], minlength=nq).astype(np.int32)
    log.info("Persistence: %d rows, %d candidate pairs, %.1fs", n, n_pairs, time.time() - t0)
    out = pd.DataFrame(cols)
    out["prior_detections_7d"] = prior7
    out["same_day_detections"] = same_day
    return out


# --------------------------------------------------------------------------- #
# 2. Local hotspot density
# --------------------------------------------------------------------------- #
def compute_density(
    df: pd.DataFrame,
    radius_km: float = DENSITY_RADIUS_KM,
    half_window_hours: float = DENSITY_HALF_WINDOW_HOURS,
) -> np.ndarray:
    """Detections within ``radius_km`` and +/- ``half_window_hours`` (self excluded)."""
    n = len(df)
    density = np.zeros(n, dtype=np.int32)
    if n == 0:
        return density
    t, day = _time_arrays(df)
    _assert_sorted(t)
    xyz = to_unit_sphere_xyz(df["latitude"].values, df["longitude"].values)
    r_m = radius_km * 1000.0
    half_w = int(half_window_hours * 3600)
    t0 = time.time()
    n_pairs = 0
    for d in np.unique(day):
        q_start = int(np.searchsorted(day, d, side="left"))
        q_end = int(np.searchsorted(day, d + 1, side="left"))
        nq = q_end - q_start
        r_start = int(np.searchsorted(t, t[q_start] - half_w, side="left"))
        r_end = int(np.searchsorted(t, t[q_end - 1] + half_w, side="right"))
        qtree = cKDTree(xyz[q_start:q_end])
        rtree = cKDTree(xyz[r_start:r_end])
        pairs = qtree.sparse_distance_matrix(rtree, r_m, output_type="ndarray")
        if len(pairs) == 0:
            continue
        n_pairs += len(pairs)
        qi = pairs["i"].astype(np.int64)
        rj = pairs["j"].astype(np.int64) + r_start
        qg = qi + q_start
        m = (np.abs(t[qg] - t[rj]) <= half_w) & (qg != rj)
        density[q_start:q_end] += np.bincount(qi[m], minlength=nq).astype(np.int32)
    log.info("Density: %d rows, %d candidate pairs, %.1fs", n, n_pairs, time.time() - t0)
    return density


# --------------------------------------------------------------------------- #
# 3 + 4. Spatial context (industry, land cover, flare catalog)
# --------------------------------------------------------------------------- #
def compute_spatial_context(df: pd.DataFrame, spatial_ref: SpatialReference) -> tuple[pd.DataFrame, str]:
    lat = df["latitude"].values
    lon = df["longitude"].values
    t0 = time.time()
    near = spatial_ref.nearest_industry(lat, lon)
    lc, lc_source = spatial_ref.land_cover_class(lat, lon, near["distance_to_industry_km"].values)
    near["land_cover_class"] = lc
    flare = spatial_ref.flare_catalog_match(lat, lon)
    near["distance_to_flare_site_km"] = flare["distance_to_flare_site_km"].values
    near["near_flare_site"] = flare["near_flare_site"].values
    near["flare_site_id"] = flare["flare_site_id"].values
    near["nearest_facility_type"] = near["nearest_facility_type"].astype("category")
    near["nearest_facility_name"] = near["nearest_facility_name"].astype("category")
    near["nearest_facility_id"] = near["nearest_facility_id"].astype("category")
    near["flare_site_id"] = near["flare_site_id"].astype("category")
    log.info("Spatial context: %d rows, land cover source=%s, %.1fs", len(df), lc_source, time.time() - t0)
    return near, lc_source


# --------------------------------------------------------------------------- #
# 5. Radiometric / calendar helpers
# --------------------------------------------------------------------------- #
def compute_radiometric_features(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    out["brightness_contrast"] = (df["brightness"].astype(np.float32) - df["bright_t31"].astype(np.float32)).astype(np.float32)
    pixel_area = (df["scan"].astype(np.float32) * df["track"].astype(np.float32)).clip(lower=0.05)
    out["frp_density"] = (df["frp"].astype(np.float32) / pixel_area).astype(np.float32)
    out["is_night"] = (df["daynight"].astype(str) == "N").astype(np.int8)
    dt = pd.DatetimeIndex(df["datetime_utc"])
    local = dt + pd.Timedelta(hours=5, minutes=30)                      # IST
    out["local_hour"] = (local.hour + local.minute / 60.0).astype(np.float32)
    out["month"] = dt.month.astype(np.int8)
    doy = dt.dayofyear.values.astype(np.float32)
    out["doy_sin"] = np.sin(2 * np.pi * doy / 365.25).astype(np.float32)
    out["doy_cos"] = np.cos(2 * np.pi * doy / 365.25).astype(np.float32)
    return out


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def engineer_features(
    df: pd.DataFrame,
    spatial_ref: Optional[SpatialReference] = None,
    persistence_block_days: int = 10,
) -> tuple[pd.DataFrame, dict]:
    """Attach every engineered feature to a cleaned, time-sorted hotspot frame."""
    if spatial_ref is None:
        spatial_ref = SpatialReference()
    df = df.sort_values("datetime_utc", kind="stable").reset_index(drop=True)
    info: dict = {}
    t0 = time.time()

    pers = compute_persistence(df, block_days=persistence_block_days)
    df = pd.concat([df, pers], axis=1)

    df["hotspot_density"] = compute_density(df)

    ctx, lc_source = compute_spatial_context(df, spatial_ref)
    df = pd.concat([df, ctx], axis=1)
    info["land_cover_source"] = lc_source

    df = pd.concat([df, compute_radiometric_features(df)], axis=1)

    info["feature_seconds"] = round(time.time() - t0, 1)
    info["spatial_reference"] = spatial_ref.describe()
    log.info("Feature engineering complete: %d rows x %d columns in %.1fs", len(df), df.shape[1], info["feature_seconds"])
    return df, info
