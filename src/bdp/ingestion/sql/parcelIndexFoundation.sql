-- Step 40B: source-governed spatial index SCHEMA FOUNDATION ONLY.
-- NOT an importer, not a data license, not a public API, and NOT run
-- automatically by npm/dev/build. Apply only as a trusted database owner
-- after reviewing source rights and existing RLS/roles.
--
-- This migration creates no application login or role memberships.
-- No GRANT to PUBLIC, browser roles or inherited BDP evidence roles.
-- County metadata and GIS snapshots require independent rights review.
-- In particular, the county REST interface being publicly readable does
-- NOT authorize commercial copying, storage, resale or bulk replication.
--
-- A complete GIS tile is still NOT a legal parcel survey, a zoning decision,
-- current ownership, verified sale listing or development clearance.

BEGIN;

CREATE SCHEMA IF NOT EXISTS bdp_parcel_index;
REVOKE ALL ON SCHEMA bdp_parcel_index FROM PUBLIC;

CREATE TABLE IF NOT EXISTS bdp_parcel_index.source_registry (
  source_id TEXT PRIMARY KEY,
  county_fips CHAR(5) NOT NULL
    CHECK (county_fips ~ '^48[0-9]{3}$'),
  source_url TEXT NOT NULL CHECK (
    length(source_url) BETWEEN 9 AND 2048
    AND source_url ~ '^https://[^[:space:]@/]+(/[^[:space:]]*)?$'
  ),
  attribution TEXT NOT NULL CHECK (
    length(btrim(attribution)) BETWEEN 1 AND 500
  ),
  rights_state TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (rights_state IN ('unreviewed', 'approved', 'restricted', 'revoked')),
  rights_review_reference TEXT,
  rights_reviewed_at TIMESTAMPTZ,
  approved_caching_until TIMESTAMPTZ,
  -- Never set to 'approved' without a recorded rights justification.
  CONSTRAINT source_rights_approval_requires_evidence CHECK (
    rights_state <> 'approved' OR (
      rights_review_reference IS NOT NULL
      AND length(btrim(rights_review_reference)) BETWEEN 1 AND 2048
      AND rights_reviewed_at IS NOT NULL
      AND approved_caching_until IS NOT NULL
      AND approved_caching_until > rights_reviewed_at
    )
  ),
  CONSTRAINT source_id_safe CHECK (
    source_id ~ '^[a-z][a-z0-9_-]{2,79}$'
  )
);

COMMENT ON TABLE bdp_parcel_index.source_registry IS
  'Source and commercial caching-rights review registry. Default unreviewed disallows trusted ingestion. Nothing is auto-approved.';

CREATE TABLE IF NOT EXISTS bdp_parcel_index.ingest_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id TEXT NOT NULL
    REFERENCES bdp_parcel_index.source_registry(source_id),
  source_version TEXT NOT NULL CHECK (
    length(btrim(source_version)) BETWEEN 1 AND 150
  ),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  outcome TEXT NOT NULL DEFAULT 'running'
    CHECK (outcome IN ('running','complete','partial','failed','cancelled')),
  source_requests INTEGER CHECK (source_requests >= 0),
  received_records INTEGER CHECK (received_records >= 0),
  omitted_unidentified INTEGER CHECK (omitted_unidentified >= 0),
  source_reported_truncated BOOLEAN,
  observed_envelope geometry(Polygon,4326),
  source_notes TEXT CHECK (source_notes IS NULL OR length(source_notes) <= 2000),
  CONSTRAINT finished_runs_require_finish_time CHECK (
    (outcome = 'running' AND finished_at IS NULL)
    OR (outcome <> 'running' AND finished_at IS NOT NULL)
  ),
  CONSTRAINT successful_run_requires_complete_evidence CHECK (
    outcome <> 'complete'
    OR (received_records IS NOT NULL
      AND omitted_unidentified = 0
      AND source_reported_truncated = FALSE
      AND observed_envelope IS NOT NULL)
  ),
  CONSTRAINT valid_ingest_envelope CHECK (
    observed_envelope IS NULL
    OR (ST_IsValid(observed_envelope) AND NOT ST_IsEmpty(observed_envelope))
  )
);

CREATE INDEX IF NOT EXISTS parcel_ingest_source_date_idx
  ON bdp_parcel_index.ingest_runs(source_id,started_at DESC,id DESC);

-- Every record retains its original source feature ID and version; it is
-- NOT equivalent to a legally verified parcel or present-day title evidence.
CREATE TABLE IF NOT EXISTS bdp_parcel_index.parcel_versions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ingest_run_id BIGINT NOT NULL
    REFERENCES bdp_parcel_index.ingest_runs(id),
  source_id TEXT NOT NULL
    REFERENCES bdp_parcel_index.source_registry(source_id),
  county_fips CHAR(5) NOT NULL CHECK (county_fips ~ '^48[0-9]{3}$'),
  source_parcel_id TEXT NOT NULL
    CHECK (source_parcel_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'),
  source_version TEXT NOT NULL CHECK (length(btrim(source_version)) BETWEEN 1 AND 150),
  source_feature_id TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  source_modified_at TIMESTAMPTZ,
  source_currency TEXT NOT NULL DEFAULT 'unverified'
    CHECK (source_currency IN ('unverified','source-dated','stale')),
  source_geometry_sha256 TEXT NOT NULL
    CHECK (source_geometry_sha256 ~ '^[0-9a-f]{64}$'),
  geometry geometry(MultiPolygon,4326) NOT NULL,
  CONSTRAINT parcel_version_unique_source UNIQUE (
    source_id,county_fips,source_parcel_id,source_version
  ),
  CONSTRAINT parcel_version_nonempty_valid_geometry CHECK (
    ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry)
  )
);

CREATE INDEX IF NOT EXISTS parcel_versions_gix
  ON bdp_parcel_index.parcel_versions USING GIST (geometry);
CREATE INDEX IF NOT EXISTS parcel_versions_county_source_idx
  ON bdp_parcel_index.parcel_versions(county_fips,source_id,source_parcel_id);

-- Coverage describes exactly which GIS window was queried, never automatic
-- sale/title/buildability clearance. 'complete' is valid ONLY when the source
-- confirms no truncation, no missing identities and a known record count.
CREATE TABLE IF NOT EXISTS bdp_parcel_index.coverage_windows (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ingest_run_id BIGINT NOT NULL REFERENCES bdp_parcel_index.ingest_runs(id),
  source_id TEXT NOT NULL REFERENCES bdp_parcel_index.source_registry(source_id),
  county_fips CHAR(5) NOT NULL CHECK (county_fips ~ '^48[0-9]{3}$'),
  window_key TEXT NOT NULL CHECK (
    length(window_key) BETWEEN 1 AND 150
  ),
  window_geometry geometry(Polygon,4326) NOT NULL,
  coverage_state TEXT NOT NULL DEFAULT 'unknown'
    CHECK (coverage_state IN ('unknown','partial','complete','unavailable')),
  received_records INTEGER CHECK (received_records >= 0),
  omitted_unidentified INTEGER CHECK (omitted_unidentified >= 0),
  source_truncated BOOLEAN,
  observed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT coverage_window_unique_version UNIQUE (ingest_run_id,window_key),
  CONSTRAINT valid_coverage_geometry CHECK (
    ST_IsValid(window_geometry) AND NOT ST_IsEmpty(window_geometry)
  ),
  CONSTRAINT complete_window_must_have_source_evidence CHECK (
    coverage_state <> 'complete'
    OR (received_records IS NOT NULL
      AND omitted_unidentified = 0
      AND source_truncated = FALSE)
  )
);

CREATE INDEX IF NOT EXISTS coverage_windows_gix
  ON bdp_parcel_index.coverage_windows USING GIST (window_geometry);
CREATE INDEX IF NOT EXISTS coverage_windows_by_source_idx
  ON bdp_parcel_index.coverage_windows(source_id,county_fips,observed_at DESC);

-- All writes remain admin-only. Even a trusted database owner must record
-- explicit unexpired rights approval before any parcel/coverage ingestion.
-- The trigger also prevents mixing counties, source versions or ingest runs.
-- It is SECURITY INVOKER (default), not a privileged browser RPC.
CREATE OR REPLACE FUNCTION bdp_parcel_index.guard_source_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_county CHAR(5);
  v_rights_state TEXT;
  v_rights_expiry TIMESTAMPTZ;
  v_run_source TEXT;
  v_run_version TEXT;
  v_run_outcome TEXT;
BEGIN
  SELECT s.county_fips, s.rights_state, s.approved_caching_until
    INTO v_county, v_rights_state, v_rights_expiry
  FROM bdp_parcel_index.source_registry s
  WHERE s.source_id = NEW.source_id;

  IF NOT FOUND OR v_rights_state IS DISTINCT FROM 'approved'
     OR v_rights_expiry IS NULL
     OR v_rights_expiry <= clock_timestamp() THEN
    RAISE EXCEPTION 'Parcel source not approved for current persistent caching'
      USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'ingest_runs' THEN
    RETURN NEW;
  END IF;
  IF NEW.county_fips IS DISTINCT FROM v_county THEN
    RAISE EXCEPTION 'County does not match source rights record'
      USING ERRCODE = '23514';
  END IF;
  SELECT r.source_id, r.source_version, r.outcome
    INTO v_run_source, v_run_version, v_run_outcome
  FROM bdp_parcel_index.ingest_runs r
  WHERE r.id = NEW.ingest_run_id;

  IF NOT FOUND OR v_run_source IS DISTINCT FROM NEW.source_id THEN
    RAISE EXCEPTION 'Parcel index source does not match its ingestion run'
      USING ERRCODE = '23514';
  END IF;
  -- NEW has a different row type for each trigger table. Never reference
  -- table-specific fields in an AND expression with TG_TABLE_NAME: PL/pgSQL
  -- may resolve/evaluate the missing NEW field even when the name differs.
  -- Branch first, then access only fields present on that table's row.
  IF TG_TABLE_NAME = 'parcel_versions' THEN
    IF v_run_version IS DISTINCT FROM NEW.source_version THEN
      RAISE EXCEPTION 'Parcel version does not match its ingestion run'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'coverage_windows' THEN
    IF NEW.coverage_state = 'complete' AND v_run_outcome <> 'complete' THEN
      RAISE EXCEPTION 'Cannot certify coverage from an incomplete source run'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unexpected parcel index trigger target'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$guard$;

CREATE TRIGGER source_rights_guard_ingest_runs
  BEFORE INSERT OR UPDATE ON bdp_parcel_index.ingest_runs
  FOR EACH ROW EXECUTE FUNCTION bdp_parcel_index.guard_source_write();
CREATE TRIGGER source_rights_guard_parcel_versions
  BEFORE INSERT OR UPDATE ON bdp_parcel_index.parcel_versions
  FOR EACH ROW EXECUTE FUNCTION bdp_parcel_index.guard_source_write();
CREATE TRIGGER source_rights_guard_coverage_windows
  BEFORE INSERT OR UPDATE ON bdp_parcel_index.coverage_windows
  FOR EACH ROW EXECUTE FUNCTION bdp_parcel_index.guard_source_write();

REVOKE ALL ON FUNCTION bdp_parcel_index.guard_source_write() FROM PUBLIC;
COMMENT ON FUNCTION bdp_parcel_index.guard_source_write() IS
  'Fail-closed source rights + source/county/run consistency gate for trusted GIS index writes. Does NOT create import or API access.';

-- Keep index datasets completely inaccessible to PUBLIC by default.
-- A future permission-checked READ ONLY RPC can be added separately after
-- rights and roles review; never expose these raw snapshots with bdp owner
-- privileges to the public browser.
REVOKE ALL ON ALL TABLES IN SCHEMA bdp_parcel_index FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA bdp_parcel_index FROM PUBLIC;

COMMIT;
