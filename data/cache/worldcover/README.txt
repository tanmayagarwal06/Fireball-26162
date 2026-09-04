Optional ESA WorldCover tiles.

Drop ESA WorldCover 10 m GeoTIFF tiles (e.g. ESA_WorldCover_10m_2021_v200_N21E084_Map.tif) into this
folder and the pipeline will sample land cover from them with rasterio instead of the embedded
heuristic estimator. Tiles must be in EPSG:4326. Points outside every tile (or on no-data cells) still
fall back to the heuristic, so partial coverage is fine.

Nothing is downloaded automatically; the pipeline never touches the network.
