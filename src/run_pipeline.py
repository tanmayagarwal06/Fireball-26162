"""End-to-end orchestration: FIRMS CSVs -> enriched SQLite + GeoJSON + console JSON.

Usage (from the repository root)::

    python src/run_pipeline.py                       # full archive in data/raw
    python src/run_pipeline.py --reuse-model         # refresh outputs without retraining
    python src/run_pipeline.py --years 2024          # one year
    python src/run_pipeline.py --quick               # ~5 % sample, fast smoke run
    python src/run_pipeline.py --backend lightgbm    # CPU LightGBM instead of XGBoost
    python src/run_pipeline.py --device cpu          # force CPU XGBoost

Stages
    1. clean            src.pipeline.cleaner
    2. features         src.pipeline.feature_engineer (+ spatial_reference)
    3. classify         src.ml.classifier (0.60 confidence gate -> class 5)
    4. cluster          src.ml.anomaly_detector (Haversine DBSCAN)
    5. export           SQLite (data/hotspots.db), GeoJSON (data/latest_hotspots.geojson,
                        data/latest_clusters.geojson) and the operator-console export
                        data/hotspots.json (src.export.console_export) read by backend/app.py
"""
from __future__ import annotations

import argparse
import json
import logging
import platform
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# allow "python src/run_pipeline.py" from anywhere
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.config import (  # noqa: E402
    CLASS_LABELS,
    CLUSTERS_GEOJSON_OUT,
    CONFIDENCE_THRESHOLD,
    CONSOLE_JSON_OUT,
    CONSOLE_MAX_RECORDS,
    CONSOLE_MIN_PER_CLASS,
    DBSCAN_EPS_KM,
    DBSCAN_MIN_SAMPLES,
    GEOJSON_OUT,
    LAND_COVER_NAMES,
    MODEL_PATH,
    RAW_DIR,
    SQLITE_DB,
    SUMMARY_JSON,
    UNKNOWN_CLASS,
    WORLDCOVER_DIR,
)
from src.export import json_safe  # noqa: E402
from src.export.console_export import build_console_records, write_console_json  # noqa: E402
from src.ml.anomaly_detector import run_anomaly_detection  # noqa: E402
from src.ml.classifier import (  # noqa: E402
    FireClassifier,
    assign_rule_labels,
    firms_type_agreement,
    flare_catalog_validation,
)
from src.pipeline.cleaner import clean  # noqa: E402
from src.pipeline.feature_engineer import engineer_features  # noqa: E402
from src.pipeline.spatial_reference import SpatialReference  # noqa: E402

log = logging.getLogger("run_pipeline")

# Columns persisted to SQLite (order matters for readability of the table)
SQLITE_COLUMNS: list[str] = [
    # identity & raw FIRMS schema
    "hotspot_id", "latitude", "longitude", "acq_date", "acq_time", "datetime_utc",
    "brightness", "scan", "track", "satellite", "instrument", "confidence", "confidence_numeric",
    "bright_t31", "frp", "daynight", "firms_type", "source_file",
    # engineered features
    "persistence_1d", "persistence_3d", "persistence_7d", "persistence_30d",
    "prior_detections_7d", "same_day_detections", "hotspot_density",
    "distance_to_industry_km", "inside_industrial_polygon", "nearest_facility_type",
    "nearest_facility_name", "nearest_facility_id", "land_cover_class", "land_cover_name",
    "brightness_contrast", "frp_density", "is_night", "local_hour", "month",
    "distance_to_flare_site_km", "near_flare_site", "flare_site_id",
    # classification
    "predicted_class", "predicted_label", "confidence_score", "rule_prior_class", "evidence_scores",
    "prob_class_0", "prob_class_1", "prob_class_2", "prob_class_3", "prob_class_4",
    # clustering
    "cluster_id", "cluster_fire_count", "total_cluster_frp", "cluster_convex_hull_area_km2",
    "is_outbreak_front", "is_persistent_cluster",
]

GEOJSON_PROPERTIES: list[str] = [
    "hotspot_id", "datetime_utc", "satellite", "daynight",
    "brightness", "frp", "confidence_numeric",
    "predicted_class", "predicted_label", "confidence_score", "evidence_scores",
    "persistence_7d", "persistence_30d", "hotspot_density",
    "land_cover_class", "land_cover_name", "distance_to_industry_km", "inside_industrial_polygon",
    "nearest_facility_type", "nearest_facility_name",
    "cluster_id", "cluster_fire_count", "total_cluster_frp", "cluster_convex_hull_area_km2",
    "is_outbreak_front", "is_persistent_cluster",
]


# --------------------------------------------------------------------------- #
# Export helpers
# --------------------------------------------------------------------------- #
def _sqlite_ready(df: pd.DataFrame) -> pd.DataFrame:
    """Coerce dtypes to what sqlite3 can bind (str/int/float), preserving NULLs."""
    out = pd.DataFrame(index=df.index)
    for col in SQLITE_COLUMNS:
        if col not in df.columns:
            continue
        s = df[col]
        if isinstance(s.dtype, pd.CategoricalDtype):
            out[col] = s.astype(str)
        elif pd.api.types.is_datetime64_any_dtype(s.dtype):
            out[col] = s.dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        elif pd.api.types.is_bool_dtype(s.dtype):
            out[col] = s.astype(np.int8)
        elif pd.api.types.is_float_dtype(s.dtype):
            out[col] = s.astype(np.float64)
        elif pd.api.types.is_integer_dtype(s.dtype):
            out[col] = s.astype(np.int64)
        else:
            out[col] = s.astype(str)
    return out


def _sql_type(dtype) -> str:
    if pd.api.types.is_float_dtype(dtype):
        return "REAL"
    if pd.api.types.is_integer_dtype(dtype) or pd.api.types.is_bool_dtype(dtype):
        return "INTEGER"
    return "TEXT"


def write_sqlite(df: pd.DataFrame, clusters: pd.DataFrame, run_meta: dict, db_path: Path, chunk_rows: int = 200_000) -> dict:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = db_path.with_suffix(".db.tmp")
    if tmp_path.exists():
        tmp_path.unlink()
    t0 = time.time()
    table = _sqlite_ready(df)
    con = sqlite3.connect(tmp_path)
    try:
        con.execute("PRAGMA page_size=8192")
        con.execute("PRAGMA journal_mode=OFF")
        con.execute("PRAGMA synchronous=OFF")
        con.execute("PRAGMA temp_store=MEMORY")
        con.execute("PRAGMA cache_size=-1000000")      # 1 GB page cache: fewer random writes on slow media
        cols = list(table.columns)
        col_defs = [f'"{c}" {_sql_type(table[c].dtype)}' for c in cols]
        con.execute("DROP TABLE IF EXISTS hotspots_enriched")
        con.execute(f"CREATE TABLE hotspots_enriched ({', '.join(col_defs)})")
        placeholders = ",".join("?" * len(cols))
        insert = f"INSERT INTO hotspots_enriched ({', '.join(chr(34) + c + chr(34) for c in cols)}) VALUES ({placeholders})"
        def to_pylist(s: pd.Series) -> list:
            if pd.api.types.is_float_dtype(s.dtype):
                a = s.values
                nan = np.isnan(a)
                return np.where(nan, None, a.astype(object)).tolist() if nan.any() else a.tolist()
            return s.tolist()

        for start in range(0, len(table), chunk_rows):
            chunk = table.iloc[start:start + chunk_rows]
            con.executemany(insert, list(zip(*[to_pylist(chunk[c]) for c in cols])))
        for idx_cols in (["acq_date"], ["predicted_class"], ["cluster_id"], ["latitude", "longitude"]):
            name = "idx_hotspots_" + "_".join(idx_cols)
            con.execute(f"CREATE INDEX IF NOT EXISTS {name} ON hotspots_enriched ({', '.join(idx_cols)})")
        # clusters table
        con.execute("DROP TABLE IF EXISTS clusters")
        if len(clusters):
            ctab = clusters.copy()
            for c in ctab.columns:
                if ctab[c].dtype == bool:
                    ctab[c] = ctab[c].astype(np.int8)
            ctab.to_sql("clusters", con, index=False, if_exists="replace", chunksize=50_000)
            con.execute("CREATE INDEX IF NOT EXISTS idx_clusters_date ON clusters (cluster_date)")
        else:
            con.execute("CREATE TABLE clusters (cluster_id INTEGER)")
        # class lookup + run metadata
        con.execute("DROP TABLE IF EXISTS class_labels")
        con.execute("CREATE TABLE class_labels (class_id INTEGER PRIMARY KEY, label TEXT)")
        con.executemany("INSERT INTO class_labels VALUES (?, ?)", list(CLASS_LABELS.items()))
        con.execute("DROP TABLE IF EXISTS pipeline_runs")
        con.execute("CREATE TABLE pipeline_runs (run_id TEXT PRIMARY KEY, run_utc TEXT, summary_json TEXT)")
        con.execute("INSERT INTO pipeline_runs VALUES (?, ?, ?)",
                    (run_meta["run_id"], run_meta["run_utc"], json.dumps(run_meta, default=str)))
        con.commit()
    finally:
        con.close()
    if db_path.exists():
        db_path.unlink()
    tmp_path.rename(db_path)
    info = {"path": str(db_path), "rows": int(len(table)), "clusters": int(len(clusters)),
            "size_mb": round(db_path.stat().st_size / 1e6, 1), "seconds": round(time.time() - t0, 1)}
    log.info("SQLite written: %s (%d rows, %.1f MB) in %.1fs", db_path, info["rows"], info["size_mb"], info["seconds"])
    return info


_json_safe = json_safe   # backwards-compatible alias (implementation lives in src.export)


def select_latest(df: pd.DataFrame, days: int, max_features: int, min_per_class: int = 0,
                  stratify: bool = False) -> pd.DataFrame:
    """Most recent ``days`` of detections, capped to ``max_features``.

    Priority: anomaly-flagged clusters first (outbreak fronts, then persistent
    industrial clusters), then non-Unknown classes, then FRP.

    ``min_per_class > 0`` reserves up to that many highest-priority rows per
    predicted class so rare classes (Industrial fire, Unknown) survive the cap.
    ``stratify=True`` additionally allocates the cap across classes in
    proportion to their share of the window (never below the floor), so the
    selection mirrors the window's class mix instead of being dominated by
    whichever class carries the most flagged clusters; within a class the
    priority order still decides which rows are kept.
    """
    if len(df) == 0:
        return df
    t_max = df["datetime_utc"].max()
    latest = df[df["datetime_utc"] >= t_max - pd.Timedelta(days=days)]
    if len(latest) > max_features:
        priority = (
            latest["is_outbreak_front"].astype(int) * 4
            + latest["is_persistent_cluster"].astype(int) * 3
            + (latest["predicted_class"] != UNKNOWN_CLASS).astype(int) * 2
            + latest["frp"].rank(pct=True)
        )
        ordered = priority.sort_values(ascending=False).index
        classes = latest["predicted_class"].reindex(ordered)
        counts = classes.value_counts()
        quotas: dict = {}
        if stratify:
            share = counts / counts.sum()
            quotas = {int(c): int(min(counts[c], max(min_per_class, round(share[c] * max_features)))) for c in counts.index}
            # trim the largest quotas until the allocation fits the cap
            while sum(quotas.values()) > max_features:
                biggest = max(quotas, key=quotas.get)
                quotas[biggest] -= 1
        elif min_per_class > 0:
            quotas = {int(c): int(min(counts[c], min_per_class)) for c in counts.index}
        chosen: list = []
        for cls, quota in quotas.items():
            chosen.extend(list(classes.index[classes == cls][:quota]))
        chosen = chosen[:max_features]
        taken = set(chosen)
        remaining = max_features - len(chosen)
        if remaining > 0:
            chosen.extend([i for i in ordered if i not in taken][:remaining])
        latest = latest.loc[chosen]
    return latest.sort_values("datetime_utc")


def write_geojson(df: pd.DataFrame, clusters: pd.DataFrame, path: Path, run_meta: dict) -> dict:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    props_cols = [c for c in GEOJSON_PROPERTIES if c in df.columns]
    table = df[props_cols].copy()
    for c in props_cols:
        if isinstance(table[c].dtype, pd.CategoricalDtype):
            table[c] = table[c].astype(str)
    records = table.to_dict(orient="records")
    lats = df["latitude"].values
    lons = df["longitude"].values
    features = []
    for i, rec in enumerate(records):
        props = {}
        for k, v in rec.items():
            if k == "evidence_scores":
                try:
                    props[k] = json.loads(v) if isinstance(v, str) else {}
                except Exception:
                    props[k] = {}
            else:
                props[k] = _json_safe(v)
        features.append({
            "type": "Feature",
            "id": props.get("hotspot_id"),
            "geometry": {"type": "Point", "coordinates": [round(float(lons[i]), 5), round(float(lats[i]), 5)]},
            "properties": props,
        })
    cluster_ids = set(int(c) for c in df["cluster_id"].unique() if c >= 0)
    cl = clusters[clusters["cluster_id"].isin(cluster_ids)] if len(clusters) else clusters
    cluster_summaries = [{k: _json_safe(v) for k, v in row.items()} for row in cl.to_dict(orient="records")]
    collection = {
        "type": "FeatureCollection",
        "name": "latest_hotspots",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "metadata": {
            "generated_utc": run_meta["run_utc"],
            "run_id": run_meta["run_id"],
            "feature_count": len(features),
            "window_start_utc": _json_safe(df["datetime_utc"].min()) if len(df) else None,
            "window_end_utc": _json_safe(df["datetime_utc"].max()) if len(df) else None,
            "class_labels": {str(k): v for k, v in CLASS_LABELS.items()},
            "confidence_threshold": run_meta.get("confidence_threshold", CONFIDENCE_THRESHOLD),
            "clusters": cluster_summaries,
        },
        "features": features,
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(collection, fh, separators=(",", ":"), allow_nan=False)
    info = {"path": str(path), "features": len(features), "clusters": len(cluster_summaries),
            "size_mb": round(path.stat().st_size / 1e6, 2), "seconds": round(time.time() - t0, 1)}
    log.info("GeoJSON written: %s (%d features, %.2f MB)", path, info["features"], info["size_mb"])
    return info


def write_cluster_geojson(latest: pd.DataFrame, clusters: pd.DataFrame, path: Path, run_meta: dict) -> dict:
    """Convex-hull polygons (lon/lat) of every cluster present in the latest window."""
    import shapely
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    features = []
    cid = latest["cluster_id"].values
    valid = cid >= 0
    if valid.any() and len(clusters):
        order = np.argsort(cid[valid], kind="stable")
        ids = cid[valid][order]
        uniq, inv = np.unique(ids, return_inverse=True)
        coords = np.column_stack([latest["longitude"].values[valid][order], latest["latitude"].values[valid][order]])
        hulls = shapely.convex_hull(shapely.multipoints(coords, indices=inv))
        # degenerate hulls (points / lines) are buffered slightly so they render as polygons
        hulls = np.where(shapely.get_type_id(hulls) == shapely.GeometryType.POLYGON, hulls, shapely.buffer(hulls, 0.002))
        lookup = clusters.set_index("cluster_id")
        for c, geom in zip(uniq, hulls):
            if int(c) not in lookup.index:
                continue
            row = lookup.loc[int(c)]
            props = {k: _json_safe(v) for k, v in row.items()}
            props["cluster_id"] = int(c)
            features.append({"type": "Feature", "id": int(c), "geometry": shapely.geometry.mapping(geom), "properties": props})
    collection = {
        "type": "FeatureCollection",
        "name": "latest_clusters",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "metadata": {"generated_utc": run_meta["run_utc"], "run_id": run_meta["run_id"], "feature_count": len(features)},
        "features": features,
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(collection, fh, separators=(",", ":"), allow_nan=False)
    info = {"path": str(path), "features": len(features), "size_mb": round(path.stat().st_size / 1e6, 2),
            "seconds": round(time.time() - t0, 1)}
    log.info("Cluster GeoJSON written: %s (%d polygons)", path, len(features))
    return info


# --------------------------------------------------------------------------- #
# Summary
# --------------------------------------------------------------------------- #
def print_summary(summary: dict) -> None:
    cls = summary["class_distribution"]
    total = summary["rows_processed"]
    lines = [
        "",
        "=" * 78,
        " SIH26162 - Industrial fire & persistent thermal source pipeline: run summary",
        "=" * 78,
        f" Run id            : {summary['run_id']}   ({summary['run_utc']})",
        f" Input files       : {summary['input']['file_count']}  raw rows: {summary['input']['raw_rows']:,}",
        f" Cleaned rows      : {total:,}  (filtered {summary['input']['filtered_rows']:,}, merged duplicates {summary['input']['duplicates_merged']:,})",
        f" Date range (UTC)  : {summary['input']['date_min']} -> {summary['input']['date_max']}",
        f" Spatial reference : {summary['spatial_reference']['industrial_source']} | {summary['spatial_reference']['industrial_polygons']} industrial polygons | "
        f"{summary['spatial_reference']['flare_sites']} flare sites | land cover = {summary['land_cover_source']}",
        f" Classifier        : {summary['classifier']['backend']} on {summary['classifier']['device']} | trained on {summary['classifier']['train_rows']:,} rule-labelled rows"
        f" | val acc {summary['classifier'].get('validation_accuracy', float('nan')):.3f} | macro-F1 {summary['classifier'].get('validation_macro_f1', float('nan')):.3f}",
        "",
        " Class distribution (after 0.60 confidence gate):",
    ]
    for cid in range(6):
        name = CLASS_LABELS[cid]
        n = cls.get(name, 0)
        pct = 100.0 * n / total if total else 0.0
        lines.append(f"   {cid}  {name:<28} {n:>10,}  {pct:6.2f}%")
    fv = summary["flare_catalog_validation"]
    tv = summary.get("firms_type_agreement", {})
    cp = summary.get("confidence_profile", {"max_prob_p50": float("nan"), "share_above_0_99": float("nan"),
                                            "share_between_0_60_and_0_90": float("nan"), "share_below_0_60": float("nan")})
    lines += [
        "",
        f" Unknown gate      : P_max < {summary['confidence_threshold']:.2f} -> class 5 | gated {summary['unknown_share']:.2%} of rows",
        f" Clusters (DBSCAN) : {summary['clusters']['clusters_total']:,} clusters | {summary['clusters']['clustered_hotspots']:,} clustered hotspots | "
        f"{summary['clusters']['singletons']:,} singletons",
        f" Anomaly flags     : {summary['clusters']['outbreak_fronts']:,} outbreak fronts | {summary['clusters']['persistent_clusters']:,} persistent industrial clusters",
        f" Flare validation  : {fv['reference_detections']:,} persistent detections at {fv['catalog_sites_detected']} catalog sites | "
        f"recall strict {fv['recall_strict_gas_flare'] if fv['recall_strict_gas_flare'] is None else round(fv['recall_strict_gas_flare'], 3)} | "
        f"lenient {fv['recall_lenient_flare_or_persistent'] if fv['recall_lenient_flare_or_persistent'] is None else round(fv['recall_lenient_flare_or_persistent'], 3)} | "
        f"precision proxy {fv['precision_proxy_in_flare_zone'] if fv['precision_proxy_in_flare_zone'] is None else round(fv['precision_proxy_in_flare_zone'], 3)}",
        (f" FIRMS type check  : static sources -> flare/persistent {tv.get('static_as_flare_or_persistent', float('nan')):.3f} "
         f"(n={tv.get('static_sources', 0):,}) | vegetation fires -> wildfire/agri {tv.get('vegetation_as_wildfire_or_agri', float('nan')):.3f} "
         f"(n={tv.get('vegetation_fires', 0):,})") if tv.get("available") else " FIRMS type check  : n/a (no type attribute)",
        (f" Confidence profile: median max-prob {cp['max_prob_p50']:.3f} | >0.99 {cp['share_above_0_99']:.1%} | "
         f"0.60-0.90 {cp['share_between_0_60_and_0_90']:.1%} | gated {cp['share_below_0_60']:.1%}"),
        "",
        f" SQLite            : {summary['outputs']['sqlite']['path']}  ({summary['outputs']['sqlite']['rows']:,} rows, {summary['outputs']['sqlite']['size_mb']} MB)",
        f" GeoJSON           : {summary['outputs']['geojson']['path']}  ({summary['outputs']['geojson']['features']:,} features, last {summary['geojson_days']} days)",
        f" Cluster GeoJSON   : {summary['outputs']['clusters_geojson']['path']}  ({summary['outputs']['clusters_geojson']['features']:,} hull polygons)",
        (f" Console JSON      : {summary['outputs']['console_json']['path']}  ({summary['outputs']['console_json']['records']:,} records, "
         f"cap {summary.get('console', {}).get('max_records', '-')}, of {summary.get('console', {}).get('candidates_in_window', 0):,} in window)")
        if summary.get("outputs", {}).get("console_json") else " Console JSON      : skipped (--no-console-json)",
        f" Model             : {summary['outputs']['model']}",
        " Stage timings (s) : " + ", ".join(f"{k}={v}" for k, v in summary["timings"].items()),
        "=" * 78,
    ]
    print("\n".join(lines))


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="FIRMS -> industrial fire / persistent thermal source pipeline")
    p.add_argument("--raw-dir", type=Path, default=RAW_DIR, help="folder with FIRMS CSVs (default data/raw)")
    p.add_argument("--years", type=int, nargs="*", default=None, help="restrict to CSVs whose name contains these years")
    p.add_argument("--max-rows", type=int, default=None, help="keep only the most recent N raw rows")
    p.add_argument("--sample-frac", type=float, default=None, help="random fraction of raw rows to process")
    p.add_argument("--quick", action="store_true", help="smoke run: 5%% sample of the archive")
    p.add_argument("--backend", choices=["xgboost", "lightgbm"], default="xgboost")
    p.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto", help="XGBoost device")
    p.add_argument("--threshold", type=float, default=CONFIDENCE_THRESHOLD, help="confidence gate (default 0.60)")
    p.add_argument("--rule-prior-weight", type=float, default=0.25)
    p.add_argument("--max-per-class", type=int, default=250_000, help="training cap per class")
    p.add_argument("--augment-copies", type=int, default=2,
                   help="measurement-noise copies of the training rows (0 = plain fit, overconfident)")
    p.add_argument("--no-evidence", action="store_true", help="skip per-row SHAP evidence (faster)")
    p.add_argument("--reuse-model", action="store_true", help="load data/models/fire_classifier.pkl instead of training")
    p.add_argument("--eps-km", type=float, default=DBSCAN_EPS_KM)
    p.add_argument("--min-samples", type=int, default=DBSCAN_MIN_SAMPLES)
    p.add_argument("--geojson-days", type=int, default=7, help="window (days) exported to GeoJSON")
    p.add_argument("--geojson-max-features", type=int, default=50_000)
    p.add_argument("--db", type=Path, default=SQLITE_DB)
    p.add_argument("--geojson", type=Path, default=GEOJSON_OUT)
    p.add_argument("--clusters-geojson", type=Path, default=CLUSTERS_GEOJSON_OUT,
                   help="convex-hull polygons of the clusters in the GeoJSON window")
    p.add_argument("--console-json", type=Path, default=CONSOLE_JSON_OUT,
                   help="operator-console export (mock/hotspots.json schema) read by backend/app.py")
    p.add_argument("--console-max-records", type=int, default=CONSOLE_MAX_RECORDS,
                   help="cap on console records from the GeoJSON window")
    p.add_argument("--console-min-per-class", type=int, default=CONSOLE_MIN_PER_CLASS,
                   help="per-class floor applied before filling the console cap by priority (0 disables)")
    p.add_argument("--no-console-json", action="store_true", help="skip the console export")
    p.add_argument("--summary-json", type=Path, default=SUMMARY_JSON)
    p.add_argument("--model-path", type=Path, default=MODEL_PATH)
    p.add_argument("--worldcover-dir", type=Path, default=WORLDCOVER_DIR)
    p.add_argument("--rebuild-reference", action="store_true", help="ignore cached GeoPackages and rebuild embedded layers")
    p.add_argument("--log-level", default="INFO")
    return p.parse_args(argv)


def main(argv=None) -> dict:
    args = parse_args(argv)
    logging.basicConfig(level=getattr(logging, args.log_level.upper(), logging.INFO),
                        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s", datefmt="%H:%M:%S")
    run_utc = datetime.now(timezone.utc)
    run_meta = {"run_id": run_utc.strftime("run_%Y%m%dT%H%M%SZ"), "run_utc": run_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "confidence_threshold": args.threshold, "args": {k: str(v) for k, v in vars(args).items()},
                "python": platform.python_version(), "host": platform.node()}
    timings: dict[str, float] = {}
    sample_frac = 0.05 if args.quick and args.sample_frac is None else args.sample_frac

    # 1. clean -----------------------------------------------------------------
    t = time.time()
    df, clean_stats = clean(args.raw_dir, years=args.years, max_rows=args.max_rows, sample_frac=sample_frac)
    timings["clean"] = round(time.time() - t, 1)
    if len(df) == 0:
        log.error("Nothing to process - no valid FIRMS rows found. Place FIRMS CSV exports in %s", args.raw_dir)
        summary = {"run_id": run_meta["run_id"], "run_utc": run_meta["run_utc"], "rows_processed": 0,
                   "input": clean_stats, "error": "no input rows"}
        Path(args.summary_json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.summary_json).write_text(json.dumps(summary, indent=2, default=str))
        print(json.dumps(summary, indent=2, default=str))
        return summary

    # 2. features --------------------------------------------------------------
    t = time.time()
    spatial_ref = SpatialReference(worldcover_dir=args.worldcover_dir, force_rebuild=args.rebuild_reference)
    df, feat_info = engineer_features(df, spatial_ref)
    timings["features"] = round(time.time() - t, 1)

    # 3. classify --------------------------------------------------------------
    t = time.time()
    rule_labels = assign_rule_labels(df)
    if args.reuse_model and Path(args.model_path).exists():
        clf = FireClassifier.load(args.model_path)
        clf.threshold = args.threshold
        log.info("Reusing trained model from %s (%s/%s)", args.model_path, clf.backend, clf.device_)
    else:
        clf = FireClassifier(backend=args.backend, threshold=args.threshold, rule_prior_weight=args.rule_prior_weight,
                             device=args.device, augment_copies=args.augment_copies)
        clf.fit(df, rule_labels, max_per_class=args.max_per_class)
        clf.save(args.model_path)
    pred = clf.predict(df, rule_labels, return_evidence=not args.no_evidence)
    df = pd.concat([df, pred], axis=1)
    df["land_cover_name"] = df["land_cover_class"].map(LAND_COVER_NAMES).fillna("Unclassified").astype("category")
    timings["classify"] = round(time.time() - t, 1)
    flare_val = flare_catalog_validation(df, pred)
    type_val = firms_type_agreement(df, pred)
    probs = pred[[f"prob_class_{i}" for i in range(5)]].to_numpy()
    top = probs.max(axis=1)
    confidence_profile = {
        "max_prob_p10": float(np.percentile(top, 10)), "max_prob_p50": float(np.percentile(top, 50)),
        "share_above_0_99": float((top > 0.99).mean()), "share_below_0_60": float((top < 0.60).mean()),
        "share_between_0_60_and_0_90": float(((top >= 0.60) & (top < 0.90)).mean()),
    }

    # 4. cluster ---------------------------------------------------------------
    t = time.time()
    df, clusters, cluster_stats = run_anomaly_detection(df, eps_km=args.eps_km, min_samples=args.min_samples)
    timings["cluster"] = round(time.time() - t, 1)

    # 5. export ----------------------------------------------------------------
    t = time.time()
    class_counts = df["predicted_label"].astype(str).value_counts()
    class_distribution = {CLASS_LABELS[i]: int(class_counts.get(CLASS_LABELS[i], 0)) for i in range(6)}
    summary = {
        "run_id": run_meta["run_id"],
        "run_utc": run_meta["run_utc"],
        "rows_processed": int(len(df)),
        "input": {
            "file_count": len(clean_stats.get("files", [])),
            "files": clean_stats.get("files", []),
            "raw_rows": clean_stats.get("input_rows", 0),
            "filtered_rows": clean_stats.get("input_rows", 0) - clean_stats.get("rows_after_filters", 0),
            "duplicates_merged": clean_stats.get("rows_merged", 0),
            "date_min": clean_stats.get("date_min"),
            "date_max": clean_stats.get("date_max"),
        },
        "spatial_reference": feat_info["spatial_reference"],
        "land_cover_source": feat_info["land_cover_source"],
        "classifier": clf.training_report_ or {"backend": clf.backend, "device": clf.device_, "train_rows": 0},
        "confidence_threshold": args.threshold,
        "class_distribution": class_distribution,
        "unknown_share": float((df["predicted_class"] == UNKNOWN_CLASS).mean()),
        "rule_label_counts": {(CLASS_LABELS[int(k)] if k >= 0 else "unlabelled"): int(v)
                              for k, v in zip(*np.unique(rule_labels, return_counts=True))},
        "flare_catalog_validation": flare_val,
        "firms_type_agreement": type_val,
        "confidence_profile": confidence_profile,
        "clusters": cluster_stats,
        "geojson_days": args.geojson_days,
    }
    run_meta.update({k: summary[k] for k in ("rows_processed", "class_distribution", "unknown_share", "clusters")})
    sqlite_info = write_sqlite(df, clusters, run_meta, args.db)
    latest = select_latest(df, args.geojson_days, args.geojson_max_features)
    geojson_info = write_geojson(latest, clusters, args.geojson, run_meta)
    clusters_geojson_info = write_cluster_geojson(latest, clusters, args.clusters_geojson, run_meta)
    console_info = None
    if not args.no_console_json:
        window = df[df["datetime_utc"] >= df["datetime_utc"].max() - pd.Timedelta(days=args.geojson_days)]
        console_df = select_latest(df, args.geojson_days, args.console_max_records, args.console_min_per_class,
                                   stratify=True)
        records = build_console_records(console_df)
        console_info = write_console_json(records, args.console_json, {
            "generated_utc": run_meta["run_utc"],
            "run_id": run_meta["run_id"],
            "window_days": args.geojson_days,
            "window_start_utc": console_df["datetime_utc"].min() if len(console_df) else None,
            "window_end_utc": console_df["datetime_utc"].max() if len(console_df) else None,
            "candidates_in_window": int(len(window)),
            "cap": args.console_max_records,
            "min_per_class": args.console_min_per_class,
            "confidence_threshold": args.threshold,
            "source_db": str(args.db),
        })
        summary["console"] = {"max_records": args.console_max_records, "min_per_class": args.console_min_per_class,
                              "candidates_in_window": int(len(window)), "records": console_info["records"],
                              "class_distribution": console_info["class_distribution"]}
    timings["export"] = round(time.time() - t, 1)
    timings["total"] = round(sum(timings.values()), 1)
    summary["outputs"] = {"sqlite": sqlite_info, "geojson": geojson_info, "clusters_geojson": clusters_geojson_info,
                          "console_json": console_info, "model": str(args.model_path),
                          "summary_json": str(args.summary_json)}
    summary["timings"] = timings
    Path(args.summary_json).parent.mkdir(parents=True, exist_ok=True)
    Path(args.summary_json).write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    print_summary(summary)
    return summary


if __name__ == "__main__":
    main()
