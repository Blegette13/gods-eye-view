-- BDP Land Intelligence: TCEQ surface-water-rights store
--
-- Rights/holder records and diversion-point geometry are intentionally stored
-- separately. Structured TCEQ files describe authorizations and holders;
-- spatial locations come from TCEQ GIS and remain screening evidence.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS bdp_tceq_water_rights (
  id BIGSERIAL PRIMARY KEY,
  record_status TEXT NOT NULL,
  water_right_id TEXT,
  authorization_type TEXT,
  holder_name TEXT,
  basin TEXT,
  county TEXT,
  priority_date DATE,
  authorized_amount_acre_feet DOUBLE PRECISION,
  use_type TEXT,
  source_dataset TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_last_modified TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bdp_tceq_water_rights_status_check
    CHECK (record_status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS bdp_tceq_water_rights_id_idx
  ON bdp_tceq_water_rights (water_right_id);
CREATE INDEX IF NOT EXISTS bdp_tceq_water_rights_holder_idx
  ON bdp_tceq_water_rights (holder_name);
CREATE INDEX IF NOT EXISTS bdp_tceq_water_rights_basin_idx
  ON bdp_tceq_water_rights (basin);
CREATE INDEX IF NOT EXISTS bdp_tceq_water_rights_county_idx
  ON bdp_tceq_water_rights (county);
CREATE INDEX IF NOT EXISTS bdp_tceq_water_rights_priority_idx
  ON bdp_tceq_water_rights (priority_date);

CREATE TABLE IF NOT EXISTS bdp_tceq_water_right_points (
  id BIGSERIAL PRIMARY KEY,
  water_right_id TEXT,
  location_role TEXT,
  point_label TEXT,
  county TEXT,
  watercourse TEXT,
  source_feature_id TEXT,
  source_url TEXT NOT NULL,
  source_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_last_modified TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  geom geometry(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS bdp_tceq_water_right_points_right_idx
  ON bdp_tceq_water_right_points (water_right_id);
CREATE INDEX IF NOT EXISTS bdp_tceq_water_right_points_geom_gix
  ON bdp_tceq_water_right_points USING GIST (geom);
CREATE INDEX IF NOT EXISTS bdp_tceq_water_right_points_county_idx
  ON bdp_tceq_water_right_points (county);

-- The normalized columns above are deliberately nullable until the TCEQ data
-- dictionary for a specific source revision is mapped and verified. Every row
-- retains source_record so source fidelity is not lost when mappings evolve.
