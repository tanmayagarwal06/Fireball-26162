"""NASA FIRMS CSV loader, schema harmoniser and spatio-temporal de-duplicator.

Handles both VIIRS (375 m; ``bright_ti4`` / ``bright_ti5`` / l-n-h confidence)
and MODIS (1 km; ``brightness`` / ``bright_t31`` / 0-100 confidence) exports and
produces one tidy table with the target schema::

    hotspot_id, latitude, longitude, acq_date, acq_time, datetime_utc,
    brightness, scan, track, satellite, instrument, confidence,
    confidence_numeric, bright_t31, frp, daynight

plus ``firms_type`` (FIRMS "type" attribute: 0 vegetation fire, 1 volcano,
2 other static land source, 3 offshore; -1 when the product does not carry it)
and ``source_file``.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable, Optional, Sequence

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from src.config import DEDUP_RADIUS_M, DEDUP_WINDOW_MIN, LEGACY_RAW_DIRS, RAW_DIR, VIIRS_CONFIDENCE_MAP
from src.pipeline.geo_utils import to_unit_sphere_xyz

log = logging.getLogger(__name__)

TARGET_COLUMNS: list[str] = [
    "hotspot_id", "latitude", "longitude", "acq_date", "acq_time", "datetime_utc",
    "brightness", "scan", "track", "satellite", "instrument", "confidence",
    "confidence_numeric", "bright_t31", "frp", "daynight",
]
EXTRA_COLUMNS: list[str] = ["firms_type", "source_file"]

_SATELLITE_NAMES = {"N": "Suomi-NPP", "N20": "NOAA-20", "N21": "NOAA-21", "T": "Terra", "A": "Aqua",
                    "Terra": "Terra", "Aqua": "Aqua"}


# --------------------------------------------------------------------------- #
# Discovery
# --------------------------------------------------------------------------- #
def discover_raw_files(raw_dir: Path = RAW_DIR, years: Optional[Sequence[int]] = None) -> list[Path]:
    """Return every FIRMS CSV under ``raw_dir`` (recursively), falling back to the
    legacy download folders when ``data/raw`` is empty. Never raises for a
    missing directory; an empty list is returned instead.
    """
    raw_dir = Path(raw_dir)
    files = sorted(raw_dir.rglob("*.csv")) if raw_dir.exists() else []
    if not files:
        for legacy in LEGACY_RAW_DIRS:
            if legacy.exists():
                files.extend(sorted(legacy.glob("*.csv")))
        if files:
            log.warning("No CSV in %s - using %d legacy CSV(s) from %s", raw_dir, len(files),
                        ", ".join(str(p) for p in LEGACY_RAW_DIRS if p.exists()))
    if years:
        wanted = {str(y) for y in years}
        files = [f for f in files if any(y in f.name for y in wanted)]
    return files


# --------------------------------------------------------------------------- #
# Loading & harmonisation
# --------------------------------------------------------------------------- #
def _read_csv(path: Path) -> pd.DataFrame:
    try:
        df = pd.read_csv(path, engine="pyarrow")
    except Exception:  # pyarrow engine unavailable / malformed quoting -> C engine
        df = pd.read_csv(path, low_memory=False)
    df.columns = [c.strip().lower() for c in df.columns]
    df["source_file"] = path.name
    return df


def harmonize(df: pd.DataFrame) -> pd.DataFrame:
    """Map a raw FIRMS frame (VIIRS or MODIS) onto the target schema."""
    out = pd.DataFrame(index=df.index)
    out["latitude"] = pd.to_numeric(df.get("latitude"), errors="coerce").astype(np.float64)
    out["longitude"] = pd.to_numeric(df.get("longitude"), errors="coerce").astype(np.float64)

    # --- time ---------------------------------------------------------------
    acq_date = pd.to_datetime(df.get("acq_date"), errors="coerce").dt.normalize()
    acq_time_raw = pd.to_numeric(df.get("acq_time"), errors="coerce")   # "0607" / 607 / "7:31" -> numeric
    if acq_time_raw.isna().all() and "acq_time" in df.columns:
        # "HH:MM" style strings
        parts = df["acq_time"].astype(str).str.extract(r"(\d{1,2}):?(\d{2})")
        acq_time_raw = pd.to_numeric(parts[0], errors="coerce") * 100 + pd.to_numeric(parts[1], errors="coerce")
    acq_time_int = acq_time_raw.fillna(0).astype(np.int64).clip(0, 2359)
    hours = acq_time_int // 100
    minutes = acq_time_int % 100
    out["acq_date"] = acq_date.dt.strftime("%Y-%m-%d")
    out["acq_time"] = acq_time_int.map("{:04d}".format)
    out["datetime_utc"] = acq_date + pd.to_timedelta(hours * 3600 + minutes * 60, unit="s")

    # --- radiometry ---------------------------------------------------------
    if "bright_ti4" in df.columns:                       # VIIRS
        out["brightness"] = pd.to_numeric(df["bright_ti4"], errors="coerce")
        out["bright_t31"] = pd.to_numeric(df.get("bright_ti5"), errors="coerce")
    else:                                                # MODIS
        out["brightness"] = pd.to_numeric(df.get("brightness"), errors="coerce")
        out["bright_t31"] = pd.to_numeric(df.get("bright_t31"), errors="coerce")
    out["scan"] = pd.to_numeric(df.get("scan"), errors="coerce")
    out["track"] = pd.to_numeric(df.get("track"), errors="coerce")
    out["frp"] = pd.to_numeric(df.get("frp"), errors="coerce")

    # --- platform -----------------------------------------------------------
    sat = df.get("satellite", pd.Series("unknown", index=df.index)).astype(str).str.strip()
    out["satellite"] = sat.map(lambda s: _SATELLITE_NAMES.get(s, s))
    instr = df.get("instrument", pd.Series("unknown", index=df.index)).astype(str).str.strip().str.upper()
    out["instrument"] = instr
    dn = df.get("daynight", pd.Series("U", index=df.index)).astype(str).str.strip().str.upper().str[:1]
    out["daynight"] = dn.where(dn.isin(["D", "N"]), "U")

    # --- confidence ---------------------------------------------------------
    conf_raw = df.get("confidence", pd.Series(np.nan, index=df.index))
    conf_str = conf_raw.astype(str).str.strip().str.lower()
    numeric = pd.to_numeric(conf_raw, errors="coerce")
    mapped = conf_str.map(VIIRS_CONFIDENCE_MAP)
    conf_numeric = numeric.where(numeric.notna(), mapped)
    out["confidence"] = conf_str.where(numeric.isna(), numeric.round().astype("Int64").astype(str))
    out["confidence_numeric"] = conf_numeric.astype(np.float64).clip(0, 100)

    # --- extras -------------------------------------------------------------
    out["firms_type"] = pd.to_numeric(df["type"], errors="coerce").fillna(-1).astype(np.int8) \
        if "type" in df.columns else np.int8(-1)
    out["source_file"] = df["source_file"].values if "source_file" in df.columns else ""
    return out


def load_and_harmonize(files: Iterable[Path]) -> pd.DataFrame:
    frames = []
    for path in files:
        raw = _read_csv(Path(path))
        frame = harmonize(raw)
        log.info("Loaded %-32s rows=%9d instrument=%s", Path(path).name, len(frame),
                 ",".join(sorted(frame["instrument"].unique())))
        frames.append(frame)
    if not frames:
        return pd.DataFrame(columns=TARGET_COLUMNS + EXTRA_COLUMNS)
    df = pd.concat(frames, ignore_index=True)
    return df


# --------------------------------------------------------------------------- #
# Filtering & de-duplication
# --------------------------------------------------------------------------- #
def basic_filters(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Drop rows with invalid coordinates, unparseable time or non-positive FRP."""
    stats = {"input_rows": int(len(df))}
    valid_coord = df["latitude"].between(-90, 90) & df["longitude"].between(-180, 180)
    valid_time = df["datetime_utc"].notna()
    valid_frp = df["frp"].notna() & (df["frp"] > 0)
    stats["dropped_null_coordinates"] = int((~valid_coord).sum())
    stats["dropped_bad_timestamp"] = int((valid_coord & ~valid_time).sum())
    stats["dropped_nonpositive_frp"] = int((valid_coord & valid_time & ~valid_frp).sum())
    df = df[valid_coord & valid_time & valid_frp].copy()
    df["brightness"] = df["brightness"].fillna(df["brightness"].median())
    df["bright_t31"] = df["bright_t31"].fillna(df["bright_t31"].median())
    df["scan"] = df["scan"].fillna(df["scan"].median())
    df["track"] = df["track"].fillna(df["track"].median())
    df["confidence_numeric"] = df["confidence_numeric"].fillna(50.0)
    stats["rows_after_filters"] = int(len(df))
    return df, stats


def deduplicate(df: pd.DataFrame, radius_m: float = DEDUP_RADIUS_M, window_min: float = DEDUP_WINDOW_MIN) -> tuple[pd.DataFrame, dict]:
    """Merge pings closer than ``radius_m`` *and* ``window_min`` minutes apart.

    Near-duplicates are linked into connected components (transitive closure of
    the pairwise relation); the member with the highest FRP survives. Fully
    vectorised: cKDTree pair query + sparse connected components.
    """
    n = len(df)
    if n < 2:
        return df.reset_index(drop=True), {"duplicate_pairs": 0, "rows_merged": 0}
    xyz = to_unit_sphere_xyz(df["latitude"].values, df["longitude"].values)
    tree = cKDTree(xyz)
    pairs = tree.query_pairs(r=radius_m, output_type="ndarray")
    if len(pairs):
        t = df["datetime_utc"].values.astype("datetime64[s]").astype(np.int64)
        dt = np.abs(t[pairs[:, 0]] - t[pairs[:, 1]])
        pairs = pairs[dt <= window_min * 60.0]
    stats = {"duplicate_pairs": int(len(pairs))}
    if len(pairs) == 0:
        stats["rows_merged"] = 0
        return df.reset_index(drop=True), stats
    graph = coo_matrix((np.ones(len(pairs), dtype=np.int8), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
    _, comp = connected_components(graph, directed=False)
    # keep the max-FRP member of every component (ties -> earliest row):
    # sort by (-frp, row) and take the first occurrence of each component.
    order = np.lexsort((np.arange(n), -df["frp"].values))    # primary key: -frp
    _, first_idx = np.unique(comp[order], return_index=True)
    keep = np.zeros(n, dtype=bool)
    keep[order[first_idx]] = True
    stats["rows_merged"] = int(n - keep.sum())
    return df[keep].reset_index(drop=True), stats


def assign_hotspot_ids(df: pd.DataFrame) -> pd.DataFrame:
    """Deterministic 16-hex-char id from (satellite, datetime, lat, lon)."""
    key = pd.DataFrame({
        "s": df["satellite"].astype(str).values,
        "t": df["datetime_utc"].values.astype("datetime64[s]").astype(np.int64),
        "la": np.round(df["latitude"].values, 5),
        "lo": np.round(df["longitude"].values, 5),
    })
    h = pd.util.hash_pandas_object(key, index=False).values.astype(np.uint64)
    df = df.copy()
    df["hotspot_id"] = np.array([f"{v:016x}" for v in h.tolist()], dtype=object)
    return df


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def clean(
    raw_dir: Path = RAW_DIR,
    years: Optional[Sequence[int]] = None,
    max_rows: Optional[int] = None,
    sample_frac: Optional[float] = None,
    random_state: int = 42,
) -> tuple[pd.DataFrame, dict]:
    """Full cleaning stage: discover -> load -> harmonise -> filter -> dedup -> ids.

    Returns ``(clean_df, stats)``. ``clean_df`` is sorted by ``datetime_utc``.
    """
    files = discover_raw_files(raw_dir, years)
    stats: dict = {"files": [str(f) for f in files]}
    if not files:
        log.error("No FIRMS CSV files found in %s (or legacy folders); returning empty frame", raw_dir)
        empty = pd.DataFrame(columns=TARGET_COLUMNS + EXTRA_COLUMNS)
        stats.update({"input_rows": 0, "rows_after_filters": 0, "rows_final": 0})
        return empty, stats
    df = load_and_harmonize(files)
    if sample_frac is not None and 0 < sample_frac < 1:
        df = df.sample(frac=sample_frac, random_state=random_state)
    df = df.sort_values("datetime_utc", kind="stable").reset_index(drop=True)
    if max_rows is not None and len(df) > max_rows:
        df = df.tail(max_rows).reset_index(drop=True)      # keep the most recent rows
    df, fstats = basic_filters(df)
    stats.update(fstats)
    df, dstats = deduplicate(df)
    stats.update(dstats)
    df = assign_hotspot_ids(df)
    df = df[TARGET_COLUMNS + EXTRA_COLUMNS].sort_values("datetime_utc", kind="stable").reset_index(drop=True)
    # compact dtypes
    for col in ("brightness", "bright_t31", "scan", "track", "frp", "confidence_numeric"):
        df[col] = df[col].astype(np.float32)
    for col in ("satellite", "instrument", "confidence", "daynight", "source_file"):
        df[col] = df[col].astype("category")
    stats["rows_final"] = int(len(df))
    stats["date_min"] = str(df["acq_date"].min()) if len(df) else None
    stats["date_max"] = str(df["acq_date"].max()) if len(df) else None
    log.info("Clean stage: %d raw -> %d rows (%d filtered, %d merged as duplicates)",
             stats["input_rows"], stats["rows_final"],
             stats["input_rows"] - stats["rows_after_filters"], stats["rows_merged"])
    return df, stats
