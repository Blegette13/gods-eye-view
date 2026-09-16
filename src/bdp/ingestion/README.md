# BDP ingestion

BDP ingestion converts authoritative or licensed land-data products into a normalized spatial store before the UI or AI consumes them.

## Texas RRC flow

1. Read the official Railroad Commission dataset catalog.
2. Build county work from Texas county FIPS.
3. Resolve the published county archive (`wellNNN.zip`, `pipelineNNN.zip`) from the official RRC HTTPS folders.
4. Compare publisher metadata/checksum with the last successful ingestion run.
5. Skip unchanged data when the source confirms it has not changed.
6. When changed, download the official shapefile archive into `.gev-cache/bdp/rrc/<county>/`.
7. Import directly from the ZIP with GDAL `/vsizip/`, avoiding a manual extraction step.
8. Reproject RRC NAD27 geometry (EPSG:4267) to EPSG:4326 during import.
9. Normalize records into PostGIS while preserving the original source attributes in `source_record`.
10. Record filename, modified time, checksum, source URL, row count, and ingestion timestamp.
11. Serve parcel intelligence from PostGIS rather than repeatedly crawling or downloading source websites.

## Bexar pilot

Bexar County uses Texas county FIPS `029`.

Download the current official well and pipeline archives:

```bash
npm run bdp:rrc:download -- --county=029
```

The downloader resolves the current RRC HTTPS folder entries, stores `well029.zip` and `pipeline029.zip`, and writes a JSON provenance/checksum manifest beside each archive.

To import the cached archives into PostGIS, configure a libpq service (recommended so credentials are not placed in command-line arguments), then run:

```bash
BDP_PG_SERVICE=bdp npm run bdp:rrc:import -- --county=029
```

The importer requires `ogr2ogr`, `psql`, PostGIS, and a configured `BDP_PG_SERVICE`. It applies `sql/rrcPostgis.sql` and `sql/rrcParcelEnergy.sql`, reads the shapefiles directly from the ZIPs, reprojects them, normalizes the official RRC attributes, and records a successful ingestion run. A checksum already recorded as successfully imported is skipped.

Dataset-specific runs are also supported:

```bash
npm run bdp:rrc:download -- --county=029 --dataset=pipelines
BDP_PG_SERVICE=bdp npm run bdp:rrc:import -- --county=029 --dataset=pipelines
```

## Parcel energy metrics

`sql/rrcParcelEnergy.sql` defines `bdp_rrc_parcel_energy_metrics(parcel_geometry, county_fips)`. Geometry is calculated in PostGIS rather than by an LLM.

The current metrics are:

- nearest RRC well distance
- wells within 1 mile
- wells within 2 miles
- wells within 5 miles
- nearest RRC pipeline distance
- number of pipeline segments intersecting the parcel
- total mapped pipeline length inside the parcel

These are screening metrics. RRC itself describes its digital mapping data as informational and subject to accuracy/completeness limitations, so title, easement, survey, operator, and legal verification remain separate due-diligence steps.

## Source-model notes

The county well shapefile provides surface-well geometry and attributes such as API, location reliability, `SYMNUM`, and NAD27/NAD83 coordinates. It is not treated as a complete operator/lease database. Operator, lease, completion, plug, and production enrichment will be joined from separate RRC regulatory datasets as those connectors are added.

The pipeline shapefile exposes attributes including operator, system/subsystem, pipeline ID, diameter, commodity, interstate designation, status, quality, T-4 permit, system type, and county. BDP normalizes these fields while retaining the full source row in `source_record`.

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

The ingestion catalog lives in `rrcCatalog.js`; download resolution/checksums live in `rrcDownloader.js`; the normalized PostGIS schema is in `sql/rrcPostgis.sql`; parcel metrics are in `sql/rrcParcelEnergy.sql`.
