# Fireball-26162
Smart India Hackathon 2026 - PS 26162

## ML & geospatial pipeline

Fully offline detection / classification pipeline for NASA FIRMS hotspots (no network access needed at
runtime). Design, feature dictionary, confidence-gating policy and DBSCAN specs are in
[PIPELINE_AND_MODEL_DOCS.md](PIPELINE_AND_MODEL_DOCS.md).

```bash
python -m pip install -r requirements-pipeline.txt
# put FIRMS CSV exports in data/raw/ (see data/raw/README.txt), then:
python src/run_pipeline.py                 # full archive  -> data/hotspots.db + data/latest_hotspots.geojson
python src/run_pipeline.py --years 2024    # single year
python src/run_pipeline.py --quick         # 5 % sample smoke test
```

Outputs: `data/hotspots.db` (SQLite, tables `hotspots_enriched`, `clusters`, `class_labels`,
`pipeline_runs`), `data/latest_hotspots.geojson` (last 7 days, Leaflet/Mapbox ready),
`data/latest_clusters.geojson` (DBSCAN hull polygons) and `data/pipeline_summary.json`.
