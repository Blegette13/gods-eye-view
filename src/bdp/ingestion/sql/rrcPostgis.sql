-- BDP Land Intelligence: Texas Railroad Commission spatial store
-- Normalized geometry is stored in EPSG:4326 even when an upstream RRC
-- shapefile arrives in NAD27. Preserve source CRS and provenance separately.
--
-- The county GIS well layer is intentionally treated as a geometry/symbology
-- source. Operator, lease, completion and plugging enrichment may come from
-- separate RRC regulatory data sets and therefore remains nullable here.

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
  well_id TEXT,
  surface_id BIGINT,
  well_number TEXT,
  lease_name TEXT,
  lease_id TEXT,
  survey_name TEXT,
  completion_date DATE,
  plug_date DATE,
  symnum INTEGER,
  status TEXT,
  reliability_code TEXT,
  operator_name TEXT,
  source_lat27 DOUBLE PRECISION,
  source_long27 DOUBLE PRECISION,
  source_lat83 DOUBLE PRECISION,
  source_long83 DOUBLE PRECISION,
  source_filename TEXT NOT NULL,
  source_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_last_modified TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  geom geometry(Point, 4326) NOT NULL
);

ALTER TABLE bdp_rrc_wells ADD COLUMN IF NOT EXISTS well_id TEXT;
ALTER TABLE bdp_rrc_wells ADD COLUMN IF NOT EXISTS surface_id BIGINT;
ALTER TABLE bdp_rrc_wells ADD COLUMN IF NOT EXISTS symnum INTEGER;
ALTER TABLE bdp_rrc_wells ADD COLUMN IF NOT EXISTS reliability_code TEXT;
ALTER TABLE bdp_rrc_wells ADD COLUMN IF NOT EXISTS source_lat27 DOUBLE PRECISION;
ALTER TABLE bdp_rrc_wells ADD COLUMN IF NOT EXISTS source_long27 DOUBLE PRECISION;
ALTER TABLE bdp_rrc_wells ADD COLUMN IF NOT EXISTS source_lat83 DOUBLE PRECISION;
ALTER TABLE bdp_rrc_wells ADD COLUMN IF NOT EXISTS source_long83 DOUBLE PRECISION;

CREATE UNIQUE INDEX IF NOT EXISTS bdp_rrc_wells_identity_idx
  ON bdp_rrc_wells (county_fips, api_number)
  WHERE api_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS bdp_rrc_wells_geom_gix
  ON bdp_rrc_wells USING GIST (geom);

CREATE INDEX IF NOT EXISTS bdp_rrc_wells_county_idx
  ON bdp_rrc_wells (county_fips);

CREATE INDEX IF NOT EXISTS bdp_rrc_wells_symnum_idx
  ON bdp_rrc_wells (symnum);

CREATE TABLE IF NOT EXISTS bdp_rrc_pipelines (
  id BIGSERIAL PRIMARY KEY,
  county_fips CHAR(3) NOT NULL,
  tpms_id TEXT,
  ops_id BIGINT,
  p5_number TEXT,
  operator_name TEXT,
  system_name TEXT,
  subsystem_name TEXT,
  pipeline_id TEXT,
  permit_number TEXT,
  diameter DOUBLE PRECISION,
  commodity TEXT,
  commodity_code TEXT,
  operational_status TEXT,
  interstate_code TEXT,
  quality_code TEXT,
  system_type TEXT,
  source_filename TEXT NOT NULL,
  source_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_last_modified TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  geom geometry(MultiLineString, 4326) NOT NULL
);

ALTER TABLE bdp_rrc_pipelines ADD COLUMN IF NOT EXISTS tpms_id TEXT;
ALTER TABLE bdp_rrc_pipelines ADD COLUMN IF NOT EXISTS ops_id BIGINT;
ALTER TABLE bdp_rrc_pipelines ADD COLUMN IF NOT EXISTS p5_number TEXT;
ALTER TABLE bdp_rrc_pipelines ADD COLUMN IF NOT EXISTS subsystem_name TEXT;
ALTER TABLE bdp_rrc_pipelines ADD COLUMN IF NOT EXISTS pipeline_id TEXT;
ALTER TABLE bdp_rrc_pipelines ADD COLUMN IF NOT EXISTS diameter DOUBLE PRECISION;
ALTER TABLE bdp_rrc_pipelines ADD COLUMN IF NOT EXISTS commodity_code TEXT;
ALTER TABLE bdp_rrc_pipelines ADD COLUMN IF NOT EXISTS interstate_code TEXT;
ALTER TABLE bdp_rrc_pipelines ADD COLUMN IF NOT EXISTS quality_code TEXT;
ALTER TABLE bdp_rrc_pipelines ADD COLUMN IF NOT EXISTS system_type TEXT;

CREATE INDEX IF NOT EXISTS bdp_rrc_pipelines_geom_gix
  ON bdp_rrc_pipelines USING GIST (geom);

CREATE INDEX IF NOT EXISTS bdp_rrc_pipelines_county_idx
  ON bdp_rrc_pipelines (county_fips);

CREATE INDEX IF NOT EXISTS bdp_rrc_pipelines_status_idx
  ON bdp_rrc_pipelines (operational_status);

-- A parcel-risk query can use these indexes to calculate nearest wells and
-- pipeline intersections without asking an LLM to perform geometry math.
-- Example application operations:
--   ST_DWithin(well.geom::geography, parcel.geom::geography, radius_meters)
--   ST_Intersects(pipeline.geom, parcel.geom)
--   ST_Length(ST_Intersection(pipeline.geom, parcel.geom)::geography)
