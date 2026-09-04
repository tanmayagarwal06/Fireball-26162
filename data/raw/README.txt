Place NASA FIRMS CSV exports here (VIIRS 375 m or MODIS 1 km, standard or NRT products), for example:
    viirs-jpss1_2024_India.csv
    viirs-snpp_2024_India.csv

They are read recursively by src/pipeline/cleaner.py. CSVs are git-ignored because the 2020-2024 India
archive is ~480 MB; download them from https://firms.modaps.eosdis.nasa.gov/download/ on a machine with
network access and copy them in. The pipeline itself never touches the network.
