from pathlib import Path
from typing import Optional

import json
import logging

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware


# ============================================================
# 1. APPLICATION SETUP
# ============================================================

app = FastAPI(
    title="Thermal Intelligence API",
    description="Backend API for the GeoThermal Intelligence platform",
    version="0.1.0"
)

@app.get("/")
def root():
    return {
        "message": "Thermal Intelligence API is running",
        "docs": "/docs",
        "status": "ok"
    }
# Allow the frontend to communicate with the backend.
# During development, we allow all origins.
# We can restrict this later for production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# 2. LOAD HOTSPOT DATA
# ============================================================

# app.py is inside:
#
# Fireball-26162/backend/app.py
#
# Two candidate data files, same record schema:
#
# Fireball-26162/data/hotspots.json  <- written by src/run_pipeline.py
#                                       (capped export of the latest
#                                       7-day window of real FIRMS data)
# Fireball-26162/mock/hotspots.json  <- hand-written fallback fixture
#
# Therefore:
# __file__ -> backend/app.py
# parent -> backend/
# parent.parent -> Fireball-26162/

BASE_DIR = Path(__file__).resolve().parent.parent
PIPELINE_HOTSPOTS_FILE = BASE_DIR / "data" / "hotspots.json"
MOCK_HOTSPOTS_FILE = BASE_DIR / "mock" / "hotspots.json"
HOTSPOTS_FILE = (
    PIPELINE_HOTSPOTS_FILE if PIPELINE_HOTSPOTS_FILE.exists() else MOCK_HOTSPOTS_FILE
)


def load_hotspots():
    """Load hotspot records from the pipeline export, or the mock fixture if absent."""

    if not HOTSPOTS_FILE.exists():
        raise FileNotFoundError(
            f"Could not find hotspots.json at: {HOTSPOTS_FILE}"
        )

    logging.getLogger("uvicorn.error").info(
        "Loading hotspots from %s", HOTSPOTS_FILE
    )

    with open(HOTSPOTS_FILE, "r", encoding="utf-8") as file:
        data = json.load(file)

    # We expect hotspots.json to contain a list of hotspot objects.
    if isinstance(data, list):
        return data

    # If the JSON is wrapped inside an object such as:
    # {"hotspots": [...]}
    if isinstance(data, dict) and "hotspots" in data:
        return data["hotspots"]

    raise ValueError(
        "hotspots.json must contain a list of hotspots "
        "or an object containing a 'hotspots' list."
    )


# Load once when the server starts.
hotspots = load_hotspots()


# ============================================================
# 3. HELPER FUNCTIONS
# ============================================================

def confidence_as_percent(value):
    """
    Convert confidence into a percentage.

    The loaded data may contain either:
        0.91
    or:
        91

    This function handles both.
    """

    if value is None:
        return None

    value = float(value)

    if value <= 1:
        return round(value * 100, 1)

    return round(value, 1)


def get_persistence(hotspot):
    """
    Number of days on which this thermal source was actually detected.

    persistence_7d / persistence_3d / persistence_1d are day COUNTS within each
    look-back window, not flags. A record with persistence_7d = 1 was seen on
    one day out of seven.

    The previous implementation tested these fields for truthiness and returned
    the window length instead of the count:

        if hotspot.get("persistence_7d"):
            return 7

    Because every record carries a non-zero persistence_7d, that returned 7 for
    all of them. It made /statistics report every hotspot as 7+ day persistent
    and turned ?min_persistence= into a no-op that matched the whole dataset.

    The widest window carries the most complete count, so it is preferred, with
    the narrower windows as fallbacks. Returns 0 when no count is recorded,
    which keeps every numeric comparison below working without a None guard.
    """

    for field in ("persistence_7d", "persistence_3d", "persistence_1d"):
        value = hotspot.get(field)

        # Reject booleans explicitly: bool is a subclass of int in Python, so a
        # True would otherwise be silently counted as 1 day.
        if isinstance(value, bool):
            continue

        if isinstance(value, (int, float)):
            return int(value)

    return 0


def get_alert_status(hotspot):
    """
    Temporary/demo alert status.

    Later this will come from a real alert-management system/database.
    """

    risk = hotspot.get("risk_score", 0)

    if risk >= 90:
        return "NEEDS INVESTIGATION"

    if risk >= 80:
        return "NEW"

    if risk >= 60:
        return "REVIEWED"

    return "REVIEWED"


def is_industrial_related(hotspot):
    """
    Determine whether a hotspot is associated with industrial
    infrastructure.

    Uses the explicit boolean carried by every loaded record (the pipeline
    export emits a real bool, matching the mock fixture).
    """

    if hotspot.get("inside_industrial_polygon") is True:
        return True

    return False


# ============================================================
# 4. HEALTH CHECK
# ============================================================

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "thermal-intelligence-api",
        "hotspots_loaded": len(hotspots)
    }


# ============================================================
# 5. GET HOTSPOTS
# ============================================================

@app.get("/hotspots")
def get_hotspots(
    classification: Optional[str] = Query(
        default=None,
        description="Filter by classification"
    ),
    min_risk: Optional[int] = Query(
        default=None,
        ge=0,
        le=100,
        description="Minimum risk score"
    ),
    satellite: Optional[str] = Query(
        default=None,
        description="Filter by satellite/source"
    ),
    min_persistence: Optional[int] = Query(
        default=None,
        description="Minimum persistence in days"
    ),
    max_industrial_distance: Optional[float] = Query(
        default=None,
        ge=0,
        description="Maximum distance from industrial infrastructure in km"
    ),
    land_cover: Optional[str] = Query(
        default=None,
        description="Filter by land-cover class"
    ),
    date_from: Optional[str] = Query(
        default=None,
        description="Starting acquisition date YYYY-MM-DD"
    ),
    date_to: Optional[str] = Query(
        default=None,
        description="Ending acquisition date YYYY-MM-DD"
    )
):
    """
    Return hotspots with optional filters.
    """

    results = hotspots.copy()

    # --------------------------------------------------------
    # Classification
    # --------------------------------------------------------

    if classification:
        results = [
            h for h in results
            if str(h.get("classification", "")).lower()
            == classification.lower()
        ]

    # --------------------------------------------------------
    # Minimum risk
    # --------------------------------------------------------

    if min_risk is not None:
        results = [
            h for h in results
            if h.get("risk_score", 0) >= min_risk
        ]

    # --------------------------------------------------------
    # Satellite
    # --------------------------------------------------------

    if satellite:
        results = [
            h for h in results
            if str(h.get("satellite", "")).lower()
            == satellite.lower()
        ]

    # --------------------------------------------------------
    # Persistence
    # --------------------------------------------------------

    if min_persistence is not None:
        results = [
            h for h in results
            if get_persistence(h) >= min_persistence
        ]

    # --------------------------------------------------------
    # Industrial proximity
    # --------------------------------------------------------

    if max_industrial_distance is not None:
        results = [
            h for h in results
            if h.get("distance_to_industry_km") is not None
            and h.get("distance_to_industry_km")
            <= max_industrial_distance
        ]

    # --------------------------------------------------------
    # Land cover
    # --------------------------------------------------------

    if land_cover:
        results = [
            h for h in results
            if str(h.get("land_cover_class", "")).lower()
            == land_cover.lower()
        ]

    # --------------------------------------------------------
    # Date range
    # --------------------------------------------------------

    if date_from:
        results = [
            h for h in results
            if h.get("acq_date", "") >= date_from
        ]

    if date_to:
        results = [
            h for h in results
            if h.get("acq_date", "") <= date_to
        ]

    return {
        "count": len(results),
        "hotspots": results
    }


# ============================================================
# 6. GET ONE HOTSPOT
# ============================================================

@app.get("/hotspots/{hotspot_id}")
def get_hotspot(hotspot_id: str):
    """
    Return one complete hotspot record.
    """

    for hotspot in hotspots:
        if str(hotspot.get("id")) == hotspot_id:
            return hotspot

    raise HTTPException(
        status_code=404,
        detail=f"Hotspot '{hotspot_id}' not found"
    )


# ============================================================
# 7. STATISTICS
# ============================================================

@app.get("/statistics")
def get_statistics():
    """
    Calculate dashboard/analytics statistics from hotspot data.
    """

    total = len(hotspots)

    high_risk = sum(
        1 for h in hotspots
        if h.get("risk_score", 0) >= 80
    )

    persistent = sum(
        1 for h in hotspots
        if get_persistence(h) >= 7
    )

    industrial_linked = sum(
        1 for h in hotspots
        if is_industrial_related(h)
    )

    # --------------------------------------------------------
    # Classification distribution
    # --------------------------------------------------------

    classification_distribution = {}

    for hotspot in hotspots:
        classification = hotspot.get(
            "classification",
            "Unknown"
        )

        classification_distribution[classification] = (
            classification_distribution.get(classification, 0) + 1
        )

    # --------------------------------------------------------
    # Risk distribution
    # --------------------------------------------------------

    risk_distribution = {
        "Low": 0,
        "Medium": 0,
        "High": 0
    }

    for hotspot in hotspots:

        risk = hotspot.get("risk_score", 0)

        if risk >= 80:
            risk_distribution["High"] += 1

        elif risk >= 50:
            risk_distribution["Medium"] += 1

        else:
            risk_distribution["Low"] += 1

    # --------------------------------------------------------
    # Persistence distribution
    # --------------------------------------------------------

    persistence_distribution = {
        "1 Day": 0,
        "3 Days": 0,
        "7+ Days": 0
    }

    for hotspot in hotspots:

        persistence = get_persistence(hotspot)

        if persistence >= 7:
            persistence_distribution["7+ Days"] += 1

        elif persistence >= 3:
            persistence_distribution["3 Days"] += 1

        else:
            persistence_distribution["1 Day"] += 1

    # --------------------------------------------------------
    # Industrial proximity
    # --------------------------------------------------------

    proximity_distribution = {
        "Within 500m": 0,
        "500m-2km": 0,
        ">2km": 0
    }

    for hotspot in hotspots:

        distance = hotspot.get("distance_to_industry_km")

        if distance is None:
            continue

        if distance <= 0.5:
            proximity_distribution["Within 500m"] += 1

        elif distance <= 2:
            proximity_distribution["500m-2km"] += 1

        else:
            proximity_distribution[">2km"] += 1

    # --------------------------------------------------------
    # Return everything
    # --------------------------------------------------------

    return {
        "summary": {
            "total_detections": total,
            "high_risk": high_risk,
            "persistent_sources": persistent,
            "industrial_linked": industrial_linked
        },

        "classification_distribution":
            classification_distribution,

        "risk_distribution":
            risk_distribution,

        "persistence_distribution":
            persistence_distribution,

        "industrial_proximity":
            proximity_distribution
    }


# ============================================================
# 8. ALERTS
# ============================================================

@app.get("/alerts")
def get_alerts(
    min_risk: int = Query(
        default=0,
        ge=0,
        le=100
    ),
    classification: Optional[str] = None,
    status: Optional[str] = None
):
    """
    Generate operational alerts from hotspots.

    For now alerts are derived from the loaded hotspot dataset on each request.
    """

    alerts = []

    for hotspot in hotspots:

        risk = hotspot.get("risk_score", 0)

        if risk < min_risk:
            continue

        if classification and (
            str(hotspot.get("classification", "")).lower()
            != classification.lower()
        ):
            continue

        alert_status = get_alert_status(hotspot)

        if status and (
            alert_status.lower() != status.lower()
        ):
            continue

        alerts.append({
            "hotspot_id": hotspot.get("id"),
            "classification": hotspot.get("classification"),
            "risk_score": risk,
            "confidence": confidence_as_percent(
                hotspot.get("classification_confidence")
            ),
            "location": {
                "lat": hotspot.get("lat"),
                "lon": hotspot.get("lon")
            },
            "persistence_days": get_persistence(hotspot),
            "industrial_distance_km":
                hotspot.get("distance_to_industry_km"),
            "detection_date":
                hotspot.get("acq_date"),
            "detection_time":
                hotspot.get("acq_time"),
            "status": alert_status
        })

    # Highest-risk first
    alerts.sort(
        key=lambda x: x["risk_score"],
        reverse=True
    )

    return {
        "count": len(alerts),
        "alerts": alerts
    }


# ============================================================
# 9. HOTSPOT EXPLANATION
# ============================================================

@app.get("/hotspots/{hotspot_id}/explanation")
def get_hotspot_explanation(hotspot_id: str):
    """
    Produce an explainable summary of why the current
    classification/risk assessment exists.

    This is NOT an AI model.
    It is an evidence summary generated from structured
    hotspot data.
    """

    hotspot = None

    for h in hotspots:
        if str(h.get("id")) == hotspot_id:
            hotspot = h
            break

    if hotspot is None:
        raise HTTPException(
            status_code=404,
            detail=f"Hotspot '{hotspot_id}' not found"
        )

    classification = hotspot.get(
        "classification",
        "Unknown"
    )

    confidence = confidence_as_percent(
        hotspot.get("classification_confidence")
    )

    supporting_evidence = []

    # --------------------------------------------------------
    # Persistence
    # --------------------------------------------------------

    persistence = get_persistence(hotspot)

    if persistence >= 7:
        supporting_evidence.append(
            f"Strong {persistence}-day persistence"
        )

    elif persistence >= 3:
        supporting_evidence.append(
            f"Moderate {persistence}-day persistence"
        )

    # --------------------------------------------------------
    # Thermal intensity
    # --------------------------------------------------------

    frp = hotspot.get("frp")

    brightness_temperature = hotspot.get(
        "brightness_temperature"
    )

    if frp is not None:
        supporting_evidence.append(
            f"Thermal detection with FRP of {frp} MW"
        )

    if brightness_temperature is not None:
        supporting_evidence.append(
            f"Brightness temperature of "
            f"{brightness_temperature} K"
        )

    # --------------------------------------------------------
    # Industrial proximity
    # --------------------------------------------------------

    distance = hotspot.get(
        "distance_to_industry_km"
    )

    facility = hotspot.get(
        "nearest_facility_type"
    )

    if distance is not None and distance <= 2:

        facility_text = facility or "industrial infrastructure"

        supporting_evidence.append(
            f"{distance} km from {facility_text}"
        )

    # --------------------------------------------------------
    # Land cover
    # --------------------------------------------------------

    land_cover = hotspot.get(
        "land_cover_class"
    )

    if land_cover:
        supporting_evidence.append(
            f"Land cover: {land_cover}"
        )

    # --------------------------------------------------------
    # Existing evidence from JSON
    # --------------------------------------------------------

    existing_evidence = hotspot.get(
        "evidence",
        []
    )

    for item in existing_evidence:
        if item not in supporting_evidence:
            supporting_evidence.append(item)

    # --------------------------------------------------------
    # Risk factors
    # --------------------------------------------------------

    risk = hotspot.get("risk_score", 0)

    return {
        "hotspot_id": hotspot.get("id"),

        "classification": classification,

        "classification_confidence":
            confidence,

        "risk_score": risk,

        "supporting_evidence":
            supporting_evidence,

        "conflicting_evidence": [],

        "uncertainty": (
            "Classification is probabilistic and should "
            "be interpreted together with the available evidence."
        ),

        "risk_factors": {
            "thermal_intensity":
                frp,

            "persistence_days":
                persistence,

            "infrastructure_proximity_km":
                distance,

            "classification_confidence":
                confidence
        }
    }