"""SIH26162 - AI-based detection and classification of industrial fires and persistent thermal sources.

Package layout
--------------
src.config                      -> project paths and global constants
src.pipeline.spatial_reference  -> embedded offline Indian industrial / land-cover / flare reference engine
src.pipeline.cleaner            -> NASA FIRMS CSV loader, harmoniser and de-duplicator
src.pipeline.feature_engineer   -> spatio-temporal persistence, proximity, land cover, density features
src.ml.classifier               -> gradient-boosted multi-class fire classifier with confidence gating
src.ml.anomaly_detector         -> Haversine DBSCAN cluster / outbreak detector
src.run_pipeline                -> end-to-end orchestration (CSV -> SQLite + GeoJSON)
"""
