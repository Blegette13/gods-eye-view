-- Step 40C-26 — DRAFT ONLY / DBA REVIEW / NOT AUTO-MIGRATED.
-- Purpose: give future keyset geometry pagination a deliberately explicit
-- immutable run boundary; a signed cursor alone is NOT a stable snapshot.
--
-- Applying this to an existing database requires reviewing ingestion order,
-- historical records, privileges, backup/recovery and transaction lock order.
-- It does NOT grant public SELECT, authorize redistribution, or change Cesium.
--
-- Protocol: ingest parcels and coverage windows while run is unfinished;
-- finalize ingest_runs with checked source evidence; insert ONE run seal;
-- then no insert/update/delete of that run's parcels/coverage/metadata.
-- Future geometry RPCs MUST independently REQUIRE a valid seal before they
-- can treat multiple requests as a stable logical collection. The staged
-- RPCs from 40C-18 and 40C-24 do NOT enforce this yet.
BEGIN;

CREATE TABLE bdp_parcel_index.parcel_run_seals (
  ingest_run_id BIGINT PRIMARY KEY
    REFERENCES bdp_parcel_index.ingest_runs(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL,
  county_fips CHAR(5) NOT NULL
    CHECK (county_fips ~ '^48[0-9]{3}$'),
  source_version TEXT NOT NULL
    CHECK (length(btrim(source_version)) BETWEEN 1 AND 150),
  sealed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  indexed_records BIGINT NOT NULL CHECK (indexed_records >= 0)
);

REVOKE ALL ON TABLE bdp_parcel_index.parcel_run_seals FROM PUBLIC;

-- Finalize and seal are serialized against parcel writes by locking the
-- ingest_runs row. Writers below acquire FOR SHARE on the same parent row,
-- so a seal cannot certify an in-flight, uncommitted parcel import.
CREATE FUNCTION bdp_parcel_index.guard_parcel_run_seal_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $ldos_run_seal_insert$
DECLARE
  v_source TEXT;
  v_county CHAR(5);
  v_version TEXT;
  v_outcome TEXT;
  v_finished TIMESTAMPTZ;
  v_received INTEGER;
  v_omitted INTEGER;
  v_truncated BOOLEAN;
  v_indexed BIGINT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Run seal cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  SELECT ir.source_id, sr.county_fips, ir.source_version,
         ir.outcome, ir.finished_at, ir.received_records,
         ir.omitted_unidentified, ir.source_reported_truncated
    INTO v_source, v_county, v_version, v_outcome, v_finished,
         v_received, v_omitted, v_truncated
  FROM bdp_parcel_index.ingest_runs ir
  JOIN bdp_parcel_index.source_registry sr
    ON sr.source_id = ir.source_id
  WHERE ir.id = NEW.ingest_run_id
  FOR UPDATE OF ir;

  IF NOT FOUND
    OR v_outcome IS DISTINCT FROM 'complete'
    OR v_finished IS NULL
    OR v_received IS NULL OR v_received < 0
    OR v_omitted IS DISTINCT FROM 0
    OR v_truncated IS DISTINCT FROM FALSE
    OR NEW.source_id IS DISTINCT FROM v_source
    OR NEW.county_fips IS DISTINCT FROM v_county
    OR NEW.source_version IS DISTINCT FROM v_version THEN
    RAISE EXCEPTION 'Cannot seal missing, incomplete or mismatched parcel run'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_indexed
  FROM bdp_parcel_index.parcel_versions pv
  WHERE pv.ingest_run_id = NEW.ingest_run_id
    AND pv.source_id = v_source
    AND pv.county_fips = v_county
    AND pv.source_version = v_version;

  IF v_indexed IS DISTINCT FROM v_received
    OR NEW.indexed_records IS DISTINCT FROM v_indexed THEN
    RAISE EXCEPTION 'Run seal indexed count differs from completed run'
      USING ERRCODE = '23514';
  END IF;

  -- Seal time is server-owned, never a backdated caller assertion.
  NEW.sealed_at := clock_timestamp();
  RETURN NEW;
END;
$ldos_run_seal_insert$;

-- Existing guard_source_write covers INSERT/UPDATE source rights and version
-- relationships; this additional trigger is solely an immutability barrier.
-- The lock acquisition prevents TOCTOU between final seal and row mutation.
CREATE FUNCTION bdp_parcel_index.guard_sealed_parcel_run_mutation()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $ldos_sealed_run_mutation$
DECLARE
  v_old_id BIGINT;
  v_new_id BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'ingest_runs' THEN
    IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
    v_old_id := OLD.id;
    -- PostgreSQL's UPDATE/DELETE already holds the parent-row lock.
  ELSE
    IF TG_OP = 'INSERT' THEN
      v_new_id := NEW.ingest_run_id;
    ELSIF TG_OP = 'DELETE' THEN
      v_old_id := OLD.ingest_run_id;
    ELSE
      v_old_id := OLD.ingest_run_id;
      v_new_id := NEW.ingest_run_id;
    END IF;

    -- Serialize with an INSERT into parcel_run_seals, whose BEFORE trigger
    -- acquires FOR UPDATE on the same parent. A sealed row cannot be
    -- mutated, even if a writer attempts it concurrently with sealing.
    IF v_old_id IS NOT NULL THEN
      PERFORM 1 FROM bdp_parcel_index.ingest_runs
       WHERE id = v_old_id FOR SHARE;
    END IF;
    IF v_new_id IS NOT NULL AND v_new_id IS DISTINCT FROM v_old_id THEN
      PERFORM 1 FROM bdp_parcel_index.ingest_runs
       WHERE id = v_new_id FOR SHARE;
    END IF;
  END IF;

  IF v_old_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM bdp_parcel_index.parcel_run_seals
     WHERE ingest_run_id = v_old_id
  ) THEN
    RAISE EXCEPTION 'Sealed parcel run is immutable'
      USING ERRCODE = '42501';
  END IF;
  IF v_new_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM bdp_parcel_index.parcel_run_seals
     WHERE ingest_run_id = v_new_id
  ) THEN
    RAISE EXCEPTION 'Cannot add or move records into a sealed parcel run'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$ldos_sealed_run_mutation$;

CREATE TRIGGER parcel_run_seal_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON bdp_parcel_index.parcel_run_seals
  FOR EACH ROW EXECUTE FUNCTION bdp_parcel_index.guard_parcel_run_seal_insert();

CREATE TRIGGER parcel_versions_sealed_run_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON bdp_parcel_index.parcel_versions
  FOR EACH ROW EXECUTE FUNCTION bdp_parcel_index.guard_sealed_parcel_run_mutation();

CREATE TRIGGER coverage_windows_sealed_run_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON bdp_parcel_index.coverage_windows
  FOR EACH ROW EXECUTE FUNCTION bdp_parcel_index.guard_sealed_parcel_run_mutation();

CREATE TRIGGER ingest_runs_sealed_run_guard
  BEFORE UPDATE OR DELETE
  ON bdp_parcel_index.ingest_runs
  FOR EACH ROW EXECUTE FUNCTION bdp_parcel_index.guard_sealed_parcel_run_mutation();

REVOKE ALL ON FUNCTION bdp_parcel_index.guard_parcel_run_seal_insert()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION bdp_parcel_index.guard_sealed_parcel_run_mutation()
  FROM PUBLIC;

COMMENT ON TABLE bdp_parcel_index.parcel_run_seals IS
  'Manual approved immutable run evidence only; not redistribution rights, a legal survey, or a cross-request MVCC snapshot.';

COMMIT;
