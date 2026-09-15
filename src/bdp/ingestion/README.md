# BDP ingestion

BDP ingestion converts authoritative or licensed land-data products into a normalized spatial store before the UI or AI consumes them.

## Texas RRC flow

1. Read the official Railroad Commission dataset catalog.
2. Build county work from Texas county FIPS.
3. Resolve the published county archive (`wellNNN.zip`, `pipelineNNN.zip`).
4. Compare publisher metadata/checksum with the last successful ingestion run.
5. Skip the download when the source has not changed.
6. When changed, download and extract the official shapefile archive.
7. Reproject RRC NAD27 geometry to EPSG:4326 during import.
8. Upsert normalized records into PostGIS.
9. Store the original source attributes in `source_record` plus filename, modified time, checksum, and ingestion timestamp.
10. Serve parcel intelligence from PostGIS rather than repeatedly crawling or downloading source websites.

## Rules

- Official API/GIS/bulk data beats webpage scraping.
- Preserve provenance and last-verified metadata.
- Geometry calculations belong in GIS/PostGIS, not the LLM.
- RRC map data is decision-support evidence, not a title/easement determination.
- A pipeline shown on the map does not by itself establish the legal dimensions or terms of an easement.
- Acquisition targets may request an on-demand source refresh, but background refresh follows the publisher cadence.

## Current RRC datasets

- Wells by county: official RRC ZIP shapefile, published twice weekly.
- Pipelines by county: official RRC ZIP shapefile, published twice weekly.

The ingestion catalog lives in `rrcCatalog.js`; the initial PostGIS schema is in `sql/rrcPostgis.sql`.
