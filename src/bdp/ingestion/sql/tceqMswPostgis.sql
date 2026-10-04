-- BDP Land Intelligence: TCEQ municipal-solid-waste site store
--
-- TCEQ publishes point coordinates for MSW facilities and historical sites.
-- Coordinates may represent a benchmark, gate, centroid, or other facility
-- point. These records are screening evidence and do NOT establish exact waste
-- boundaries, contamination extent, cleanup status, or title restrictions.

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

CREATE TABLE IF NOT EXISTS bdp_tceq_msw_sites (
  id BIGSERIAL PRIMARY KEY,
  source_dataset TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_last_modified TIMESTAMPTZ,
  source_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  site_name TEXT,
  alternate_name TEXT,
  authorization_number TEXT,
  rn TEXT,
  facility_type TEXT,
  legal_status TEXT,
  physical_status TEXT,
  county TEXT,
  region TEXT,
  address TEXT,

  unauthorized BOOLEAN,
  hazardous_waste_confirmed BOOLEAN,
  hazardous_waste_probable BOOLEAN,
  hazardous_waste_unlikely BOOLEAN,
  date_opened DATE,
  date_closed DATE,
  size_acres DOUBLE PRECISION,

  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  coordinate_accuracy_code TEXT,
  coordinate_source_code TEXT,
  location_text TEXT,

  geom geometry(Point, 4326),

  CONSTRAINT bdp_tceq_msw_sites_dataset_check
    CHECK (source_dataset IN ('facilities', 'closed', 'revoked', 'unnumbered'))
);

CREATE INDEX IF NOT EXISTS bdp_tceq_msw_sites_geom_gix
  ON bdp_tceq_msw_sites USING GIST (geom);
CREATE INDEX IF NOT EXISTS bdp_tceq_msw_sites_dataset_idx
  ON bdp_tceq_msw_sites (source_dataset);
CREATE INDEX IF NOT EXISTS bdp_tceq_msw_sites_county_idx
  ON bdp_tceq_msw_sites (county);
CREATE INDEX IF NOT EXISTS bdp_tceq_msw_sites_status_idx
  ON bdp_tceq_msw_sites (physical_status);
CREATE INDEX IF NOT EXISTS bdp_tceq_msw_sites_auth_idx
  ON bdp_tceq_msw_sites (authorization_number);
