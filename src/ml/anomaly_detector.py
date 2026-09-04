"""Spatial anomaly / outbreak detection with Haversine DBSCAN.

Detections are clustered **per acquisition day** (UTC) so that a cluster
represents one day's spatial footprint of an event: a moving fire front
(large hull, low persistence, vegetated land) versus a stationary flare field
or smelter complex (compact hull, high persistence, industrial zone).

Parameters follow the brief: ``eps = 3.0 km / 6371 km`` in radians on
(lat, lon) in radians with ``metric="haversine"`` and ``min_samples = 3``.

Outputs per hotspot
    cluster_id (int, -1 for noise / singletons; globally unique across days)
    cluster_fire_count, total_cluster_frp, cluster_convex_hull_area_km2,
    is_outbreak_front, is_persistent_cluster
Outputs per cluster (``summarize_clusters``)
    one row per cluster with the aggregates above plus centroid, date,
    dominant land cover / class and the two anomaly flags.
"""
from __future__ import annotations

import logging
import time

import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer
from sklearn.cluster import DBSCAN

from src.config import (
    CLASS_LABELS,
    DBSCAN_EPS_KM,
    DBSCAN_MIN_SAMPLES,
    EARTH_RADIUS_KM,
    GEOGRAPHIC_CRS,
    METRIC_CRS,
    OUTBREAK_MAX_MEAN_PERSISTENCE_DAYS,
    OUTBREAK_MIN_COUNT,
    PERSISTENT_CLUSTER_MIN_MEAN_PERSISTENCE_DAYS,
)

log = logging.getLogger(__name__)

FOREST_SHRUB_CLASSES = (10, 20, 30, 95)


def _dbscan_day(lat: np.ndarray, lon: np.ndarray, eps_km: float, min_samples: int) -> np.ndarray:
    if len(lat) < min_samples:
        return np.full(len(lat), -1, dtype=np.int64)
    coords = np.radians(np.column_stack([lat, lon]))
    model = DBSCAN(eps=eps_km / EARTH_RADIUS_KM, min_samples=min_samples, metric="haversine",
                   algorithm="ball_tree", n_jobs=1)
    return model.fit_predict(coords)


def detect_clusters(
    df: pd.DataFrame,
    eps_km: float = DBSCAN_EPS_KM,
    min_samples: int = DBSCAN_MIN_SAMPLES,
    group_col: str = "acq_date",
) -> pd.DataFrame:
    """Assign a globally unique ``cluster_id`` (or -1) to every hotspot."""
    n = len(df)
    cluster_id = np.full(n, -1, dtype=np.int64)
    if n == 0:
        return pd.DataFrame({"cluster_id": cluster_id})
    lat = df["latitude"].values.astype(np.float64)
    lon = df["longitude"].values.astype(np.float64)
    groups = df[group_col].astype(str).values
    order = np.argsort(groups, kind="stable")
    sorted_groups = groups[order]
    boundaries = np.flatnonzero(np.r_[True, sorted_groups[1:] != sorted_groups[:-1], True])
    next_id = 0
    t0 = time.time()
    for s, e in zip(boundaries[:-1], boundaries[1:]):
        idx = order[s:e]
        labels = _dbscan_day(lat[idx], lon[idx], eps_km, min_samples)
        mask = labels >= 0
        if mask.any():
            cluster_id[idx[mask]] = labels[mask] + next_id
            next_id += int(labels.max()) + 1
    log.info("DBSCAN: %d rows, %d daily groups, %d clusters, %.1fs", n, len(boundaries) - 1, next_id, time.time() - t0)
    return pd.DataFrame({"cluster_id": cluster_id}, index=df.index)


def _hull_areas_km2(x: np.ndarray, y: np.ndarray, cluster_id: np.ndarray) -> pd.Series:
    """Convex-hull area per cluster (projected metres -> km^2), indexed by cluster id.

    Fully vectorised: Shapely builds one MultiPoint per cluster in C
    (``indices`` argument), hulls and areas follow as array operations.
    Degenerate (collinear) clusters yield 0.
    """
    valid = cluster_id >= 0
    if not valid.any():
        return pd.Series(dtype=np.float64)
    order = np.argsort(cluster_id[valid], kind="stable")
    ids = cluster_id[valid][order]
    uniq, inv = np.unique(ids, return_inverse=True)
    coords = np.column_stack([x[valid][order], y[valid][order]])
    multipoints = shapely.multipoints(coords, indices=inv)
    areas = shapely.area(shapely.convex_hull(multipoints)) / 1e6
    return pd.Series(areas, index=uniq)


def _dominant_value(sub: pd.DataFrame, col: str) -> pd.Series:
    """Most frequent value of ``col`` per cluster (vectorised mode)."""
    counts = sub.groupby(["cluster_id", col], sort=False).size().reset_index(name="n")
    counts = counts.sort_values(["cluster_id", "n", col], ascending=[True, False, True])
    return counts.drop_duplicates("cluster_id").set_index("cluster_id")[col]


def summarize_clusters(df: pd.DataFrame, cluster_id: np.ndarray) -> pd.DataFrame:
    """One row per cluster with aggregate statistics and outbreak flags."""
    cols = ["cluster_id", "cluster_date", "cluster_fire_count", "total_cluster_frp", "max_frp",
            "cluster_convex_hull_area_km2", "centroid_lat", "centroid_lon", "mean_persistence_7d",
            "share_forest_shrub", "share_industrial", "dominant_land_cover", "dominant_class",
            "dominant_label", "is_outbreak_front", "is_persistent_cluster"]
    valid = cluster_id >= 0
    if not valid.any():
        return pd.DataFrame(columns=cols)
    sub = pd.DataFrame({
        "cluster_id": cluster_id[valid],
        "cluster_date": df["acq_date"].astype(str).values[valid],
        "latitude": df["latitude"].values[valid],
        "longitude": df["longitude"].values[valid],
        "frp": df["frp"].values[valid].astype(np.float64),
        "persistence_7d": df["persistence_7d"].values[valid].astype(np.float64),
        "forest_shrub": np.isin(df["land_cover_class"].values[valid], FOREST_SHRUB_CLASSES).astype(np.float64),
        "industrial": (df["distance_to_industry_km"].values[valid] <= 2.0).astype(np.float64),
        "land_cover_class": df["land_cover_class"].values[valid],
        "predicted_class": df["predicted_class"].values[valid] if "predicted_class" in df.columns else np.full(int(valid.sum()), -1),
    })
    g = sub.groupby("cluster_id", sort=True)
    agg = g.agg(
        cluster_date=("cluster_date", "first"),
        cluster_fire_count=("frp", "size"),
        total_cluster_frp=("frp", "sum"),
        max_frp=("frp", "max"),
        centroid_lat=("latitude", "mean"),
        centroid_lon=("longitude", "mean"),
        mean_persistence_7d=("persistence_7d", "mean"),
        share_forest_shrub=("forest_shrub", "mean"),
        share_industrial=("industrial", "mean"),
    )
    agg["dominant_land_cover"] = _dominant_value(sub, "land_cover_class").reindex(agg.index).astype(np.int16)
    agg["dominant_class"] = _dominant_value(sub, "predicted_class").reindex(agg.index).astype(np.int8)
    agg["dominant_label"] = agg["dominant_class"].map(lambda c: CLASS_LABELS.get(int(c), "n/a"))
    # convex hull areas in the metric CRS
    tr = Transformer.from_crs(GEOGRAPHIC_CRS, METRIC_CRS, always_xy=True)
    x, y = tr.transform(df["longitude"].values, df["latitude"].values)
    areas = _hull_areas_km2(np.asarray(x), np.asarray(y), cluster_id)
    agg["cluster_convex_hull_area_km2"] = areas.reindex(agg.index).fillna(0.0).astype(np.float64)
    # outbreak rules
    agg["is_outbreak_front"] = (
        (agg["cluster_fire_count"] >= OUTBREAK_MIN_COUNT)
        & (agg["mean_persistence_7d"] <= OUTBREAK_MAX_MEAN_PERSISTENCE_DAYS)
        & (agg["share_forest_shrub"] >= 0.5)
    )
    agg["is_persistent_cluster"] = (
        (agg["mean_persistence_7d"] >= PERSISTENT_CLUSTER_MIN_MEAN_PERSISTENCE_DAYS)
        & (agg["share_industrial"] >= 0.5)
    )
    agg = agg.reset_index()
    return agg[cols]


def run_anomaly_detection(
    df: pd.DataFrame,
    eps_km: float = DBSCAN_EPS_KM,
    min_samples: int = DBSCAN_MIN_SAMPLES,
) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Cluster the hotspot frame and attach cluster-level columns to each row.

    Returns ``(hotspots_with_cluster_columns, clusters_table, stats)``.
    """
    t0 = time.time()
    cid = detect_clusters(df, eps_km=eps_km, min_samples=min_samples)["cluster_id"].values
    clusters = summarize_clusters(df, cid)
    out = df.copy()
    out["cluster_id"] = cid
    if len(clusters):
        lookup = clusters.set_index("cluster_id")
        pos = lookup.index.get_indexer(cid)
        found = pos >= 0
        def take(col, default, dtype):
            arr = np.full(len(out), default, dtype=dtype)
            arr[found] = lookup[col].values[pos[found]].astype(dtype)
            return arr
        out["cluster_fire_count"] = take("cluster_fire_count", 1, np.int32)
        out["total_cluster_frp"] = np.where(found, take("total_cluster_frp", 0.0, np.float32), out["frp"].values.astype(np.float32))
        out["cluster_convex_hull_area_km2"] = take("cluster_convex_hull_area_km2", 0.0, np.float32)
        out["is_outbreak_front"] = take("is_outbreak_front", False, bool)
        out["is_persistent_cluster"] = take("is_persistent_cluster", False, bool)
    else:
        out["cluster_fire_count"] = np.int32(1)
        out["total_cluster_frp"] = out["frp"].astype(np.float32)
        out["cluster_convex_hull_area_km2"] = np.float32(0.0)
        out["is_outbreak_front"] = False
        out["is_persistent_cluster"] = False
    stats = {
        "eps_km": eps_km,
        "min_samples": min_samples,
        "clusters_total": int(len(clusters)),
        "clustered_hotspots": int((cid >= 0).sum()),
        "singletons": int((cid < 0).sum()),
        "outbreak_fronts": int(clusters["is_outbreak_front"].sum()) if len(clusters) else 0,
        "persistent_clusters": int(clusters["is_persistent_cluster"].sum()) if len(clusters) else 0,
        "seconds": round(time.time() - t0, 1),
    }
    log.info("Anomaly detection: %d clusters (%d outbreak fronts, %d persistent industrial clusters) in %.1fs",
             stats["clusters_total"], stats["outbreak_fronts"], stats["persistent_clusters"], stats["seconds"])
    return out, clusters, stats
