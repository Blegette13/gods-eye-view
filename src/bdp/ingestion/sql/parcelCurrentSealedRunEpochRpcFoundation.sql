-- Step 40C-45 — DBA REVIEW ONLY / NOT MIGRATED / NO GRANTS.
-- Requires 40B parcel index, 40C-26 immutable run seals, and the 40C-43
-- transactionally bumped run-selection epoch foundation.
-- Fixed exact current run + epoch reader, NOT independent legal publishing,
-- ownership, parcel coverage, real authentication or a browser API.
BEGIN;

CREATE FUNCTION bdp_parcel_index.parcel_current_sealed_run_epoch_rpc(
  p_county_fips text, p_source_id text, p_run_id bigint
)
RETURNS TABLE (
  source_id text,
  county_fips text,
  run_id text,
  epoch text
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $ldos_current_run_epoch_rpc$
  SELECT
    sr.source_id,
    sr.county_fips::text,
    latest.id::text,
    e.epoch::text
  FROM bdp_parcel_index.source_registry AS sr
  JOIN LATERAL (
    -- Select the one latest finished run BEFORE checking its seal. Do not
    -- silently fall back if a newer run is incomplete, failed or unsealed.
    SELECT ir.id, ir.source_id, ir.source_version, ir.finished_at,
           ir.outcome, ir.received_records, ir.omitted_unidentified,
           ir.source_reported_truncated
    FROM bdp_parcel_index.ingest_runs AS ir
    WHERE ir.source_id=sr.source_id
      AND ir.finished_at IS NOT NULL
    ORDER BY ir.finished_at DESC, ir.id DESC
    LIMIT 1
  ) AS latest ON TRUE
  JOIN bdp_parcel_index.parcel_run_seals AS seal
    ON seal.ingest_run_id=latest.id
   AND seal.source_id=sr.source_id
   AND seal.county_fips=sr.county_fips
   AND seal.source_version=latest.source_version
   AND seal.indexed_records=latest.received_records
   AND seal.sealed_at>=latest.finished_at
  JOIN bdp_parcel_index.parcel_run_selection_epochs AS e
    ON e.source_id=sr.source_id
   AND e.county_fips=sr.county_fips
   AND e.epoch>0
  WHERE p_county_fips ~ '^48[0-9]{3}$'
    AND p_source_id ~ '^[a-z][a-z0-9_-]{2,79}$'
    AND p_run_id>0
    AND sr.county_fips=p_county_fips::char(5)
    AND sr.source_id=p_source_id
    AND latest.id=p_run_id
    AND latest.outcome='complete'
    AND latest.received_records IS NOT NULL
    AND latest.omitted_unidentified=0
    AND latest.source_reported_truncated=FALSE
  LIMIT 1
$ldos_current_run_epoch_rpc$;

REVOKE ALL ON FUNCTION
  bdp_parcel_index.parcel_current_sealed_run_epoch_rpc(text,text,bigint)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  bdp_parcel_index.parcel_current_sealed_run_epoch_rpc(text,text,bigint)
  FROM ldos_parcel_rpc_client;

COMMENT ON FUNCTION
  bdp_parcel_index.parcel_current_sealed_run_epoch_rpc(text,text,bigint)
IS 'PRIVATE DRAFT: exact latest finished complete sealed run AND run-selection change epoch. Not caching permission, legal redistribution rights, session access, geographic completeness or release approval.';

COMMIT;
