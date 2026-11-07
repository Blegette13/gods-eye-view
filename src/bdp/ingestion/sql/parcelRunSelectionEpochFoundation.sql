-- Step 40C-43 — DRAFT sealed-run/source-selection revision authority.
-- DBA review only; NOT auto-migrated or connected to browser geometry.
-- Tracks future writes changing finished-run/seal selection for a source.
-- This is NOT evidence that a run is currently valid, sealed, newest,
-- covered by a GIS license or the user's county authorization.
-- Depends on parcelIndexFoundation and parcelRunSealFoundation.
BEGIN;
CREATE TABLE bdp_parcel_index.parcel_run_selection_epochs (
  source_id text NOT NULL CHECK (source_id ~ '^[a-z][a-z0-9_-]{2,79}$'),
  county_fips char(5) NOT NULL CHECK (county_fips ~ '^48[0-9]{3}$'),
  epoch bigint NOT NULL CHECK (epoch > 0),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_id,county_fips)
);
REVOKE ALL ON TABLE bdp_parcel_index.parcel_run_selection_epochs FROM PUBLIC;
REVOKE ALL ON TABLE bdp_parcel_index.parcel_run_selection_epochs
  FROM ldos_parcel_rpc_client;

-- Prevent missed source-run transition during migration/backfill.
LOCK TABLE bdp_parcel_index.source_registry,
  bdp_parcel_index.ingest_runs,
  bdp_parcel_index.parcel_run_seals IN SHARE ROW EXCLUSIVE MODE;
-- Historic transitions CANNOT be reconstructed; baseline is only 1.
INSERT INTO bdp_parcel_index.parcel_run_selection_epochs
  (source_id,county_fips,epoch)
SELECT source_id,county_fips,1 FROM bdp_parcel_index.source_registry;

CREATE FUNCTION bdp_parcel_index.track_run_selection_epoch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $ldos_run_selection_epoch$
DECLARE
  v_source text;
  v_county char(5);
BEGIN
  IF TG_TABLE_SCHEMA <> 'bdp_parcel_index'
    OR TG_TABLE_NAME NOT IN ('ingest_runs','parcel_run_seals') THEN
    RAISE EXCEPTION 'Unexpected run epoch trigger target'
      USING ERRCODE='42501';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Run selection TRUNCATE prohibited'
      USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME = 'parcel_run_seals' THEN
    IF TG_OP <> 'INSERT' OR TG_WHEN <> 'AFTER' THEN
      RAISE EXCEPTION 'Unexpected sealed-run revision event'
        USING ERRCODE='42501';
    END IF;
    v_source := NEW.source_id;
    v_county := NEW.county_fips;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      IF OLD.id IS DISTINCT FROM NEW.id
        OR OLD.source_id IS DISTINCT FROM NEW.source_id THEN
        RAISE EXCEPTION 'Ingest run identity cannot be changed'
          USING ERRCODE='42501';
      END IF;
    END IF;
    IF TG_WHEN = 'BEFORE' THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' THEN
      v_source := OLD.source_id;
    ELSE
      v_source := NEW.source_id;
    END IF;
    SELECT sr.county_fips INTO v_county
    FROM bdp_parcel_index.source_registry AS sr
    WHERE sr.source_id = v_source
    FOR KEY SHARE;
  END IF;
  IF v_source IS NULL OR v_source !~ '^[a-z][a-z0-9_-]{2,79}$'
    OR v_county IS NULL OR v_county !~ '^48[0-9]{3}$' THEN
    RAISE EXCEPTION 'Invalid run selection revision key'
      USING ERRCODE='23514';
  END IF;
  -- Transaction-serialized per-source revision. Aborted writes roll back.
  INSERT INTO bdp_parcel_index.parcel_run_selection_epochs AS current_epoch
    (source_id,county_fips,epoch,changed_at)
  VALUES (v_source,v_county,1,clock_timestamp())
  ON CONFLICT (source_id,county_fips)
  DO UPDATE SET epoch=current_epoch.epoch+1,
                changed_at=clock_timestamp();
  RETURN NULL;
END;
$ldos_run_selection_epoch$;
REVOKE ALL ON FUNCTION bdp_parcel_index.track_run_selection_epoch()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION bdp_parcel_index.track_run_selection_epoch()
  FROM ldos_parcel_rpc_client;

CREATE TRIGGER run_selection_preserve_ingest_identity
  BEFORE UPDATE ON bdp_parcel_index.ingest_runs
  FOR EACH ROW EXECUTE FUNCTION bdp_parcel_index.track_run_selection_epoch();
CREATE TRIGGER run_selection_track_ingest
  AFTER INSERT OR UPDATE OR DELETE ON bdp_parcel_index.ingest_runs
  FOR EACH ROW EXECUTE FUNCTION bdp_parcel_index.track_run_selection_epoch();
CREATE TRIGGER run_selection_track_seal
  AFTER INSERT ON bdp_parcel_index.parcel_run_seals
  FOR EACH ROW EXECUTE FUNCTION bdp_parcel_index.track_run_selection_epoch();
CREATE TRIGGER run_selection_no_ingest_truncate
  BEFORE TRUNCATE ON bdp_parcel_index.ingest_runs
  FOR EACH STATEMENT EXECUTE FUNCTION bdp_parcel_index.track_run_selection_epoch();
CREATE TRIGGER run_selection_no_seal_truncate
  BEFORE TRUNCATE ON bdp_parcel_index.parcel_run_seals
  FOR EACH STATEMENT EXECUTE FUNCTION bdp_parcel_index.track_run_selection_epoch();

COMMENT ON TABLE bdp_parcel_index.parcel_run_selection_epochs IS
  'DRAFT, synthetic only: future source/run-selection change counter. Epoch alone never establishes latest finished sealed source or public GIS rights.';
COMMIT;
