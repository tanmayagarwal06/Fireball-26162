"""Console export: enriched hotspots -> ``data/hotspots.json`` in the operator-console schema.

The FastAPI backend (``backend/app.py``) and the React console were written
against ``mock/hotspots.json``. This module maps the pipeline's enriched frame
onto that exact record shape so neither the API routes nor the UI logic have
to change::

    id, lat, lon, acq_date, acq_time ("HH:MM"), satellite, brightness_temperature,
    frp, confidence (0-100), day_night, persistence_1d/3d/7d, distance_to_industry_km,
    inside_industrial_polygon (bool), nearest_facility_type, land_cover_class (label),
    hotspot_density, classification, classification_confidence (0-1), risk_score (0-100),
    evidence (list[str])

Two fields the pipeline does not natively produce are derived here and
documented in PIPELINE_AND_MODEL_DOCS.md section 2.7:

* ``risk_score`` - deterministic 0-100 formula (``RISK_FORMULA_VERSION``).
* ``evidence``   - 3-6 human-readable sentences built from the model's TreeSHAP
  attributions (``evidence_scores``) plus contextual rules.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import (
    CLASS_LABELS,
    CONFIDENCE_THRESHOLD,
    CONSOLE_FACILITY_CONTEXT_KM,
    LAND_COVER_NAMES,
    UNKNOWN_CLASS,
)
from src.export import json_safe

log = logging.getLogger(__name__)

CONSOLE_SCHEMA_VERSION = "console-1"
RISK_FORMULA_VERSION = "risk-v1"

# --------------------------------------------------------------------------- #
# Label maps (values are what the console filters / saved queries expect)
# --------------------------------------------------------------------------- #
CONSOLE_CLASS_LABELS: dict[int, str] = {
    0: "Wildfire",
    1: "Agricultural Burning",
    2: "Industrial Fire",
    3: "Gas Flare",
    4: "Persistent Thermal Source",
    5: "Unknown",
}

FACILITY_LABELS: dict[str, str] = {
    "oil_gas_flare": "Oil & Gas",
    "gas_processing": "Oil & Gas",
    "lng_terminal": "Oil & Gas",
    "refinery": "Refinery",
    "refinery_petrochemical": "Refinery",
    "refinery_steel": "Refinery",
    "chemical_refinery": "Chemical Plant",
    "petrochemical": "Chemical Plant",
    "power_coal": "Power Plant",
    "steel_smelter": "Steel Plant",
    "coal_mining_fire": "Coal Mine",
    "industrial_unknown": "Industrial Area",
}

SATELLITE_LABELS: dict[str, str] = {
    "Suomi-NPP": "VIIRS_SNPP",
    "NOAA-20": "VIIRS_NOAA20",
    "NOAA-21": "VIIRS_NOAA21",
    "Terra": "MODIS_TERRA",
    "Aqua": "MODIS_AQUA",
}

CONSOLE_FIELDS: tuple[str, ...] = (
    "id", "lat", "lon", "acq_date", "acq_time", "satellite", "brightness_temperature", "frp",
    "confidence", "day_night", "persistence_1d", "persistence_3d", "persistence_7d",
    "distance_to_industry_km", "inside_industrial_polygon", "nearest_facility_type",
    "land_cover_class", "hotspot_density", "classification", "classification_confidence",
    "risk_score", "evidence",
)

# --------------------------------------------------------------------------- #
# Risk score
# --------------------------------------------------------------------------- #
RISK_WEIGHTS: dict = {
    "class_prior": {"Industrial Fire": 55, "Wildfire": 35, "Persistent Thermal Source": 28,
                    "Gas Flare": 22, "Agricultural Burning": 12, "Unknown": 8},
    "frp_max_points": 30, "frp_saturation_mw": 30.0,
    "persistence_max_points": 10,
    "proximity_max_points": 14, "proximity_range_km": 5.0,
    "outbreak_front_points": 14,
    "persistent_cluster_points": 5,
    "cluster_max_points": 8, "cluster_saturation_count": 50,
    "confidence_max_points": 5,
}


def compute_risk_score(df: pd.DataFrame) -> np.ndarray:
    """Deterministic 0-100 operational risk score (``risk-v1``).

    risk = prior[class]
         + 30 * min(1, ln(1+frp) / ln(31))
         + 10 * min(persistence_7d, 7) / 7
         + 14 * (1 if inside polygon else max(0, 1 - distance_km / 5))
         + 14 * is_outbreak_front + 5 * is_persistent_cluster
         + 8 * min(1, ln(1+cluster_fire_count) / ln(51))
         + 5 * confidence_score
    """
    w = RISK_WEIGHTS
    n = len(df)
    if n == 0:
        return np.zeros(0, dtype=np.int64)
    labels = df["predicted_class"].astype(int).map(CONSOLE_CLASS_LABELS)
    prior = labels.map(w["class_prior"]).fillna(w["class_prior"]["Unknown"]).to_numpy(dtype=np.float64)
    frp = np.nan_to_num(df["frp"].to_numpy(dtype=np.float64), nan=0.0).clip(min=0.0)
    f_frp = w["frp_max_points"] * np.minimum(1.0, np.log1p(frp) / np.log1p(w["frp_saturation_mw"]))
    pers = np.nan_to_num(df["persistence_7d"].to_numpy(dtype=np.float64), nan=0.0)
    f_pers = w["persistence_max_points"] * np.minimum(pers, 7.0) / 7.0
    inside = df["inside_industrial_polygon"].to_numpy().astype(bool)
    dist = np.nan_to_num(df["distance_to_industry_km"].to_numpy(dtype=np.float64), nan=1e9)
    f_prox = w["proximity_max_points"] * np.where(inside, 1.0, np.maximum(0.0, 1.0 - dist / w["proximity_range_km"]))
    f_out = w["outbreak_front_points"] * _bool_col(df, "is_outbreak_front")
    f_pc = w["persistent_cluster_points"] * _bool_col(df, "is_persistent_cluster")
    count = df["cluster_fire_count"].to_numpy(dtype=np.float64) if "cluster_fire_count" in df.columns else np.ones(n)
    count = np.nan_to_num(count, nan=1.0).clip(min=1.0)
    f_clu = w["cluster_max_points"] * np.minimum(1.0, np.log1p(count) / np.log1p(w["cluster_saturation_count"]))
    conf = np.nan_to_num(df["confidence_score"].to_numpy(dtype=np.float64), nan=0.0).clip(0.0, 1.0)
    f_conf = w["confidence_max_points"] * conf
    total = prior + f_frp + f_pers + f_prox + f_out + f_pc + f_clu + f_conf
    return np.clip(np.rint(total), 0, 100).astype(np.int64)


def _bool_col(df: pd.DataFrame, col: str) -> np.ndarray:
    if col not in df.columns:
        return np.zeros(len(df), dtype=np.float64)
    return df[col].fillna(False).to_numpy().astype(bool).astype(np.float64)


# --------------------------------------------------------------------------- #
# Evidence sentences
# --------------------------------------------------------------------------- #
MIN_ATTRIBUTION = 0.05

# feature -> (phrase, formatter of the feature value or None)
_FEATURE_PHRASES: dict[str, str] = {
    "brightness": "I-4 brightness temperature of {brightness:.0f} K",
    "bright_t31": "background (I-5) temperature of {bright_t31:.0f} K",
    "brightness_contrast": "fire-channel contrast of {brightness_contrast:.0f} K over background",
    "frp": "radiative power of {frp:.1f} MW",
    "frp_density": "FRP per pixel area of {frp_density:.1f} MW/km²",
    "scan": "pixel footprint ({scan:.2f} km scan)",
    "track": "pixel footprint ({track:.2f} km track)",
    "confidence_numeric": "FIRMS detection confidence of {confidence_numeric:.0f}%",
    "is_night": "{diurnal} acquisition",
    "local_hour": "local time of detection ({local_time} IST)",
    "month": "calendar month (seasonality)",
    "doy_sin": "seasonal timing (day of year)",
    "doy_cos": "seasonal timing (day of year)",
    "persistence_1d": "{persistence_1d} prior detection day within the last day",
    "persistence_3d": "{persistence_3d} prior detection days within the last 3 days",
    "persistence_7d": "{persistence_7d} prior detection days within the last 7 days",
    "persistence_30d": "{persistence_30d}-of-30-day repeat history at this location",
    "prior_detections_7d": "{prior_detections_7d} prior pings within 1 km over 7 days",
    "same_day_detections": "{same_day_detections} other same-day detections within 1 km",
    "hotspot_density": "{hotspot_density} neighbouring detections within 5 km / 6 h",
    "distance_to_industry_km": "distance of {distance_to_industry_km:.1f} km to mapped industry",
    "inside_industrial_polygon": "location {inside_phrase} a mapped industrial polygon",
    "facility_type_code": "nearest facility type ({facility_label})",
    "is_flare_zone": "location {flare_zone_phrase} a known flare-bearing zone",
    "land_cover_class": "{land_cover_label} land cover",
}


def _fmt_local_time(row: dict) -> str:
    lh = row.get("local_hour")
    try:
        lh = float(lh)
    except (TypeError, ValueError):
        return "unknown"
    if lh != lh:
        return "unknown"
    return f"{int(lh) % 24:02d}:{int(round((lh % 1) * 60)) % 60:02d}"


def _facility_label(row: dict) -> str | None:
    code = row.get("nearest_facility_type")
    if code is None or (isinstance(code, float) and code != code):
        return None
    code = str(code)
    if code in ("", "none", "nan"):
        return None
    return FACILITY_LABELS.get(code, code.replace("_", " ").title())


def _land_cover_label(row: dict) -> str | None:
    code = row.get("land_cover_class")
    try:
        return LAND_COVER_NAMES.get(int(code))
    except (TypeError, ValueError):
        return None


def build_evidence(row: dict) -> list[str]:
    """3-6 unique evidence sentences for one console record (``row`` = enriched frame row)."""
    pred = int(row.get("predicted_class", UNKNOWN_CLASS))
    cls = CONSOLE_CLASS_LABELS.get(pred, "Unknown")
    # Attributions are computed for the model's arg-max class; for a gated
    # (Unknown) record that is the leading candidate, not "Unknown" itself.
    attr_target = f"the {cls} call"
    if pred == UNKNOWN_CLASS:
        probs = [_num(row.get(f"prob_class_{i}"), default=-1.0) for i in range(5)]
        if max(probs) >= 0:
            attr_target = f"the leading candidate ({CONSOLE_CLASS_LABELS[int(np.argmax(probs))]})"
    facility_label = _facility_label(row)
    land_label = _land_cover_label(row)
    dist = _num(row.get("distance_to_industry_km"))
    inside = bool(row.get("inside_industrial_polygon"))
    fmt_ctx = {
        **{k: _num(row.get(k), default=0.0) for k in (
            "brightness", "bright_t31", "brightness_contrast", "frp", "frp_density", "scan", "track",
            "confidence_numeric", "distance_to_industry_km")},
        **{k: int(_num(row.get(k), default=0.0)) for k in (
            "persistence_1d", "persistence_3d", "persistence_7d", "persistence_30d",
            "prior_detections_7d", "same_day_detections", "hotspot_density")},
        "diurnal": "night-time" if str(row.get("daynight", "")).upper() == "N" else "daytime",
        "local_time": _fmt_local_time(row),
        "inside_phrase": "inside" if inside else "outside",
        "facility_label": facility_label or "none mapped",
        "flare_zone_phrase": "inside" if (facility_label in ("Oil & Gas", "Refinery", "Chemical Plant")
                                         and dist is not None and dist <= 2.0) else "outside",
        "land_cover_label": land_label or "unclassified",
    }

    sentences: list[str] = []

    # ---- tier 1: model attributions -------------------------------------
    scores = row.get("evidence_scores")
    contributions: dict[str, float] = {}
    if isinstance(scores, str) and scores.strip():
        try:
            contributions = {str(k): float(v) for k, v in json.loads(scores).items()}
        except (ValueError, TypeError, AttributeError):
            contributions = {}
    elif isinstance(scores, dict):
        contributions = {str(k): float(v) for k, v in scores.items()}
    for feat, val in sorted(contributions.items(), key=lambda kv: -abs(kv[1])):
        if abs(val) < MIN_ATTRIBUTION:
            continue
        phrase = _FEATURE_PHRASES.get(feat)
        try:
            body = phrase.format(**fmt_ctx) if phrase else feat.replace("_", " ")
        except (KeyError, ValueError):
            body = feat.replace("_", " ")
        verb = "supports" if val > 0 else "argues against"
        sentences.append(f"Model attribution: {body} {verb} {attr_target} ({val:+.2f})")

    # ---- tier 2: contextual rules ---------------------------------------
    count = int(_num(row.get("cluster_fire_count"), default=1.0))
    if bool(row.get("is_outbreak_front")):
        sentences.append(f"Flagged as an outbreak front: {count} detections in a fast-growing cluster with low prior persistence")
    if bool(row.get("is_persistent_cluster")):
        sentences.append(f"Member of a persistent industrial cluster ({count} detections, mean persistence >= 3 days)")
    p30 = fmt_ctx["persistence_30d"]
    if p30 > 0:
        sentences.append(f"Repeated at this location on {p30} of the last 30 days")
    else:
        sentences.append("No detection at this location in the previous 30 days (sudden onset)")
    name = row.get("nearest_facility_name")
    if facility_label and dist is not None and dist <= CONSOLE_FACILITY_CONTEXT_KM:
        if inside:
            sentences.append(f"Falls inside the {name} industrial polygon ({facility_label})")
        else:
            sentences.append(f"Nearest mapped facility: {name} ({facility_label}), {dist:.1f} km away")
    else:
        sentences.append(f"No mapped industrial facility within {CONSOLE_FACILITY_CONTEXT_KM:.0f} km")
    if str(row.get("daynight", "")).upper() == "N":
        sentences.append(f"Night-time detection (local {fmt_ctx['local_time']}); no solar contamination")
    ftype = row.get("firms_type")
    if ftype is not None and ftype == ftype:
        if int(ftype) == 2:
            sentences.append("FIRMS flags this pixel as a static land source")
        elif int(ftype) == 3:
            sentences.append("FIRMS flags this pixel as an offshore detection")
    conf = _num(row.get("confidence_score"))
    if pred == UNKNOWN_CLASS and conf is not None:
        sentences.append(f"Held as Unknown: {attr_target.replace('the ', '', 1)} reaches only {conf:.2f}, "
                         f"below the {CONFIDENCE_THRESHOLD:.2f} confidence gate")
    prior = row.get("rule_prior_class")
    if prior is not None and prior == prior and int(prior) >= 0:
        prior_label = CONSOLE_CLASS_LABELS.get(int(prior), "Unknown")
        if int(prior) == pred:
            sentences.append(f"Rule-based domain prior agrees with the model ({cls})")
        else:
            sentences.append(f"Rule-based prior suggested {prior_label}; the model overrode it with {cls}")

    # ---- fallbacks ------------------------------------------------------
    fallbacks = [
        f"Radiative power {fmt_ctx['frp']:.1f} MW at {fmt_ctx['brightness']:.0f} K (I-4 channel)",
        f"Detection confidence {fmt_ctx['confidence_numeric']:.0f}% (FIRMS {str(row.get('confidence', ''))})",
        f"{fmt_ctx['hotspot_density']} neighbouring detections within 5 km in the same 6-hour window",
    ]

    unique: list[str] = []
    for s in sentences + fallbacks:
        if s and s not in unique:
            unique.append(s)
        if len(unique) >= 6:
            break
    return unique[:6] if len(unique) >= 3 else unique


def _num(v, default=None):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return default if f != f else f


# --------------------------------------------------------------------------- #
# Record builder
# --------------------------------------------------------------------------- #
def _satellite_label(sat: str, instrument: str) -> str:
    if sat in SATELLITE_LABELS:
        return SATELLITE_LABELS[sat]
    raw = f"{instrument}_{sat}".upper()
    return "".join(ch if ch.isalnum() else "_" for ch in raw)


def build_console_records(df: pd.DataFrame) -> list[dict]:
    """Map an enriched, classified, clustered hotspot frame onto console records."""
    n = len(df)
    if n == 0:
        return []
    risk = compute_risk_score(df)
    acq_time = df["acq_time"].astype(str).str.zfill(4)
    dist = df["distance_to_industry_km"].astype(float)
    ftype = df["nearest_facility_type"].astype(str)
    facility = ftype.map(lambda c: FACILITY_LABELS.get(c, c.replace("_", " ").title() if c not in ("", "none", "nan") else None))
    facility = facility.where(dist <= CONSOLE_FACILITY_CONTEXT_KM, None)
    land = df["land_cover_class"].map(lambda c: LAND_COVER_NAMES.get(int(c)) if c == c else None)
    satellites = [_satellite_label(s, i) for s, i in zip(df["satellite"].astype(str), df["instrument"].astype(str))]

    base = pd.DataFrame({
        "id": df["hotspot_id"].astype(str).values,
        "lat": df["latitude"].astype(float).round(5).values,
        "lon": df["longitude"].astype(float).round(5).values,
        "acq_date": df["acq_date"].astype(str).values,
        "acq_time": (acq_time.str[:2] + ":" + acq_time.str[2:4]).values,
        "satellite": satellites,
        "brightness_temperature": df["brightness"].astype(float).round(1).values,
        "frp": df["frp"].astype(float).round(2).values,
        "confidence": df["confidence_numeric"].fillna(50).astype(float).round().astype(int).values,
        "day_night": df["daynight"].astype(str).str.upper().str[:1].values,
        "persistence_1d": df["persistence_1d"].fillna(0).astype(int).values,
        "persistence_3d": df["persistence_3d"].fillna(0).astype(int).values,
        "persistence_7d": df["persistence_7d"].fillna(0).astype(int).values,
        "distance_to_industry_km": dist.round(2).values,
        "inside_industrial_polygon": df["inside_industrial_polygon"].fillna(0).astype(int).astype(bool).values,
        "nearest_facility_type": facility.values,
        "land_cover_class": land.values,
        "hotspot_density": df["hotspot_density"].fillna(0).astype(int).values,
        "classification": df["predicted_class"].astype(int).map(CONSOLE_CLASS_LABELS).fillna("Unknown").values,
        "classification_confidence": df["confidence_score"].astype(float).round(4).values,
        "risk_score": risk,
    }, index=df.index)

    evidence_source_cols = [c for c in (
        "predicted_class", "nearest_facility_type", "nearest_facility_name", "land_cover_class",
        "distance_to_industry_km", "inside_industrial_polygon", "brightness", "bright_t31", "brightness_contrast",
        "frp", "frp_density", "scan", "track", "confidence_numeric", "confidence", "daynight", "local_hour",
        "persistence_1d", "persistence_3d", "persistence_7d", "persistence_30d", "prior_detections_7d",
        "same_day_detections", "hotspot_density", "evidence_scores", "cluster_fire_count", "is_outbreak_front",
        "is_persistent_cluster", "firms_type", "confidence_score", "rule_prior_class",
        "prob_class_0", "prob_class_1", "prob_class_2", "prob_class_3", "prob_class_4") if c in df.columns]
    src_rows = df[evidence_source_cols].to_dict(orient="records")

    records: list[dict] = []
    for base_row, src in zip(base.to_dict(orient="records"), src_rows):
        rec = {k: json_safe(v) for k, v in base_row.items()}
        rec["inside_industrial_polygon"] = bool(base_row["inside_industrial_polygon"])
        rec["risk_score"] = int(base_row["risk_score"])
        for k in ("confidence", "persistence_1d", "persistence_3d", "persistence_7d", "hotspot_density"):
            rec[k] = int(base_row[k])
        rec["evidence"] = build_evidence(src)
        records.append({k: rec[k] for k in CONSOLE_FIELDS})
    return records


# --------------------------------------------------------------------------- #
# Writer
# --------------------------------------------------------------------------- #
def write_console_json(records: list[dict], path: Path, metadata: dict) -> dict:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    counts: dict[str, int] = {}
    for r in records:
        counts[r["classification"]] = counts.get(r["classification"], 0) + 1
    meta = {
        "schema_version": CONSOLE_SCHEMA_VERSION,
        "record_count": len(records),
        "class_distribution": {CONSOLE_CLASS_LABELS[i]: counts.get(CONSOLE_CLASS_LABELS[i], 0) for i in range(6)},
        "risk_formula": {"version": RISK_FORMULA_VERSION, "weights": RISK_WEIGHTS},
        "facility_context_km": CONSOLE_FACILITY_CONTEXT_KM,
        "class_labels": {str(k): v for k, v in CLASS_LABELS.items()},
        **{k: json_safe(v) if not isinstance(v, (dict, list)) else v for k, v in metadata.items()},
    }
    payload = {"hotspots": records, "metadata": meta}
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), allow_nan=False, ensure_ascii=False)
    if path.exists():
        path.unlink()
    tmp.rename(path)
    info = {"path": str(path), "records": len(records), "size_mb": round(path.stat().st_size / 1e6, 2),
            "class_distribution": meta["class_distribution"], "seconds": round(time.time() - t0, 1)}
    log.info("Console JSON written: %s (%d records, %.2f MB)", path, len(records), info["size_mb"])
    return info
