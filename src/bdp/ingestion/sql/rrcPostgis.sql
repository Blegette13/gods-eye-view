-- BDP Land Intelligence: Texas Railroad Commission spatial store
-- Normalized geometry is stored in EPSG:4326 even when an upstream RRC
-- shapefile arrives in NAD27. Preserve source CRS and provenance separately.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS bdp_ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL,
  dataset TEXT NOT NULL,
  county_fips CHAR(3),
  source_filename TEXT,
  source_url TEXT,
  source_last_modified TIMESTAMPTZ,
  checksum_sha256 TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  row_count INTEGER,
  error_message TEXT,
  CONSTRAINT bdp_ingestion_runs_status_check
    CHECK (status IN ('running', 'succeeded', 'failed', 'skipped-unchanged'))
);

CREATE INDEX IF NOT EXISTS bdp_ingestion_runs_lookup_idx
  ON bdp_ingestion_runs (source_id, dataset, county_fips, completed_at DESC);

CREATE TABLE IF NOT EXISTS bdp_rrc_wells (
  id BIGSERIAL PRIMARY KEY,
  county_fips CHAR(3) NOT NULL,
  api_number TEXT,
  well_number TEXT,
  lease_name TEXT,
  lease_id TEXT,
  survey_name TEXT,
  completion_date DATE,
  plug_date DATE,
  status TEXT,
  operator_name TEXT,
  source_filename TEXT NOT NULL,
  source_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_last_modified TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  geom geometry(Point, 4326) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS bdp_rrc_wells_identity_idx
  ON bdp_rrc_wells (county_fips, api_number)
  WHERE api_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS bdp_rrc_wells_geom_gix
  ON bdp_rrc_wells USING GIST (geom);

CREATE INDEX IF NOT EXISTS bdp_rrc_wells_county_idx
  ON bdp_rrc_wells (county_fips);

CREATE TABLE IF NOT EXISTS bdp_rrc_pipelines (
  id BIGSERIAL PRIMARY KEY,
  county_fips CHAR(3) NOT NULL,
  operator_name TEXT,
  permit_number TEXT,
  system_name TEXT,
  commodity TEXT,
  operational_status TEXT,
  source_filename TEXT NOT NULL,
  source_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_last_modified TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  geom geometry(MultiLineString, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS bdp_rrc_pipelines_geom_gix
  ON bdp_rrc_pipelines USING GIST (geom);

CREATE INDEX IF NOT EXISTS bdp_rrc_pipelines_county_idx
  ON bdp_rrc_pipelines (county_fips);

-- A parcel-risk query can use these indexes to calculate nearest wells and
-- pipeline intersections without asking an LLM to perform geometry math.
-- Example application operations:
--   ST_DWithin(well.geom::geography, parcel.geom::geography, radius_meters)
--   ST_Intersects(pipeline.geom, parcel.geom)
--   ST_Length(ST_Intersection(pipeline.geom, parcel.geom)::geography)
