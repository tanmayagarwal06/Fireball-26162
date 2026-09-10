# Fireball-26162

PS-26162 / SIH26162 - AI-based detection and classification of industrial fires and persistent thermal sources

## Overview

Our project is a technical solution designed to detect, classify and triage thermal anomalies across
India from satellite active-fire data. The core of the system is an AI model that turns raw NASA FIRMS
VIIRS/MODIS detections into labelled events, separating genuine industrial fires from routine gas
flares, persistent thermal sources, crop residue burning and wildfires. The system provides an
offline geospatial + ML pipeline, a FastAPI service, and a React operator console with map,
analytics, alert and investigation views. Its ultimate goal is to enable proactive response by
surfacing high-risk anomalies with the evidence behind every call, so an analyst can act on a ranked
shortlist instead of an undifferentiated hotspot feed.

```
data/raw/*.csv  ->  src/run_pipeline.py  ->  data/hotspots.json  ->  backend/app.py (FastAPI)  ->  frontend/ (React console)
                                         ->  data/hotspots.db, data/latest_hotspots.geojson, data/latest_clusters.geojson
```

## Tech Stack

- Frontend: React 19 + TypeScript with Vite, Tailwind CSS, React Router and Leaflet / react-leaflet

- Backend: Python FastAPI served by Uvicorn

- AI & Geospatial: Python (XGBoost with CUDA / LightGBM, scikit-learn, pandas, NumPy, SciPy, GeoPandas, Shapely, pyproj, rasterio)

- Storage: SQLite (`data/hotspots.db`) plus GeoJSON and JSON exports; no external database required

- Data source: NASA FIRMS VIIRS / MODIS active-fire CSV exports, processed fully offline

## Key Features

- Six-Class Thermal Anomaly Classification (Wildfire / Agricultural Burning / Industrial Fire / Gas Flare / Persistent Thermal Source / Unknown)

- Weak Supervision from Domain Priors, blended with a Gradient-Boosted Classifier

- Confidence Gating: predictions below 0.60 are surfaced as Unknown for manual triage instead of guessed

- Per-Detection Explainability via top-3 TreeSHAP attributions rendered as plain-English evidence

- Multi-Window Temporal Persistence Features (1d / 3d / 7d / 30d) that separate continuous flares from one-off fires

- Haversine DBSCAN Clustering with outbreak-front and persistent-cluster flags

- Deterministic 0-100 Risk Score (`risk-v1`) for ranked alerting

- Fully Offline Spatial Reference: 45 curated industrial polygons, land-cover estimator, 32 flare reference sites

- Operator Console: Dashboard map, Analytics, Alerts, AI Investigator and System Status views

## Running the demo

### 1. Pipeline (optional - a generated `data/hotspots.json` snapshot is committed)

```bash
python -m pip install -r requirements-pipeline.txt
# put FIRMS CSV exports in data/raw/ (see data/raw/README.txt), then:
python src/run_pipeline.py                 # full archive: train + every output (~7 min, GPU optional)
python src/run_pipeline.py --reuse-model   # refresh every output with the saved model (~6 min)
python -m src.export.console_export        # rebuild only data/hotspots.json from data/hotspots.db (<1 s)
python src/run_pipeline.py --years 2024 --sample-frac 0.02 --reuse-model   # 5 s smoke run
```

Outputs: `data/hotspots.db` (SQLite, tables `hotspots_enriched`, `clusters`, `class_labels`,
`pipeline_runs`; git-ignored), `data/latest_hotspots.geojson` (last 7 days, Leaflet/Mapbox ready),
`data/latest_clusters.geojson` (DBSCAN hull polygons), `data/hotspots.json` (capped console export,
3,000 records) and `data/pipeline_summary.json`. Design, feature dictionary, confidence-gating policy,
DBSCAN specs and the console export schema are in [PIPELINE_AND_MODEL_DOCS.md](PIPELINE_AND_MODEL_DOCS.md).

### 2. Backend

```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app:app --reload --port 8000
```

Loads `data/hotspots.json` once at startup (falls back to `mock/hotspots.json` if the export is
missing; the startup log names the file). After regenerating the export, restart uvicorn.
Interactive docs at http://127.0.0.1:8000/docs.

### 3. Frontend

```bash
cd frontend
npm ci
npm run dev          # http://localhost:5173, expects the backend on http://127.0.0.1:8000
npm run typecheck && npm test && npm run build
```

Override the API location with `VITE_API_BASE_URL` in `frontend/.env.local` (see `.env.example`).
The map tiles (Esri dark canvas / Esri imagery / OpenStreetMap, all keyless) and fonts load from the
internet, so the console needs connectivity even though the pipeline runs fully offline.

## Team

**Team Name:** Fireball

**Team Leader:** Ruhansh Bansal (2024UIC4171)

- Gunn - 2024UEE4122

- Hemang - 2024UCA1829

- Tanmay - 2024UIC3658

- Akshat - 2024UEC2530

- Vibhash - 2024UEE4075

## Project Links

- Presentation: https://drive.google.com/file/d/1eXRsnyQM4Dp6Rr5zIRLZlA8_KWKuNMtq/view?usp=sharing

- Additional Resources:
Datasets-
1. NASA FIRMS — VIIRS/MODIS Active Fire Data
https://firms.modaps.eosdis.nasa.gov/
2. ESA WorldCover 10m 2021 (Zanaga et al., 2022)
https://doi.org/10.5281/zenodo.7254221
3. Global Gas Flare Survey, VIIRS Nightfire 2012–2019 (Elvidge & Zhizhin, 2021, NASA Earthdata/ORNL DAAC)
https://doi.org/10.3334/ORNLDAAC/1874
4. OpenStreetMap, via OSMnx (Boeing, 2017)
https://doi.org/10.1016/j.compenvurbsys.2017.05.004
Research Papers-
1. Elvidge et al. (2013). VIIRS Nightfire: Satellite Pyrometry at Night. Remote Sensing 5(9):4423–4449.
https://doi.org/10.3390/rs5094423
2. Elvidge et al. (2016). Methods for Global Survey of Natural Gas Flaring from VIIRS Data. Energies 9:14.
https://doi.org/10.3390/en9010014
3. Fire-type classification with XGBoost/Random Forest on NASA MODIS data, Mediterranean Basin. ICAAI 2023.
https://doi.org/10.1145/3633598.3633603

## Repository Notes

The pipeline never opens a network socket: every reference dataset it needs (industrial zones, land
cover, flare sites) is embedded in code or cached under `data/cache/`. Large artifacts are
git-ignored, including `data/hotspots.db`, `data/raw/*.csv`, `node_modules` and virtualenvs; the
committed `data/hotspots.json` snapshot is what lets the backend and console run without a pipeline
execution. Optional ESA WorldCover GeoTIFF tiles can be dropped into `data/cache/worldcover/` to
replace the offline land-cover estimator with real raster sampling.
