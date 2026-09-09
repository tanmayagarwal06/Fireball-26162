# Fireball-26162
Smart India Hackathon 2026 - PS 26162

AI-based detection and classification of industrial fires and persistent thermal sources from NASA
FIRMS hotspots. Three parts, wired together through one file:

```
data/raw/*.csv  ->  src/run_pipeline.py  ->  data/hotspots.json  ->  backend/app.py (FastAPI)  ->  frontend/ (React console)
                                         ->  data/hotspots.db, data/latest_hotspots.geojson, data/latest_clusters.geojson
```

## Running the demo

### 1. Pipeline (optional - a generated `data/hotspots.json` snapshot is committed)

```bash
python -m pip install -r requirements-pipeline.txt
# put FIRMS CSV exports in data/raw/ (see data/raw/README.txt), then:
python src/run_pipeline.py                 # full archive: train + every output (~7 min, GPU optional)
python src/run_pipeline.py --reuse-model   # refresh every output with the saved model (~6 min)
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
The map tiles (CARTO / OpenStreetMap) and fonts load from the internet.
