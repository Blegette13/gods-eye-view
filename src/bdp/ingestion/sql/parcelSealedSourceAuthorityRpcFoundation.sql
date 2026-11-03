-- Step 40C-34: DBA-REVIEW-ONLY / UNDEPLOYED fixed sealed-source authority RPC.
-- NOT an application migration; execute ONLY in an explicitly disposable
-- PostGIS database for first review. The function is not an authenticator,
-- GIS redistribution license, user/county entitlement or API.
-- REQUIRED BEFORE REVIEW: parcelIndexFoundation.sql and
-- parcelRunSealFoundation.sql. Never install with an application owner.
--
-- This lookup proves a *specific* latest FINISHED ingest run has a matching,
-- immutable run seal and current reviewed CACHING rights. It deliberately
-- does NOT infer geometry redistribution rights from caching permission.
-- The trusted server must independently read publication approval, enforce
-- session/county grants, and recheck both before and after geometry SQL.
-- A returned row is private evidence, not permission to publish geometry.
BEGIN;

CREATE FUNCTION bdp_parcel_index.parcel_sealed_source_authority_rpc(
  p_county_fips text
)
RETURNS TABLE (
  source_id text,
  county_fips text,
  rights_state text,
  approved_caching_until_ms double precision,
  run_id bigint,
  source_version text,
  sealed_at_ms double precision,
  indexed_records bigint,
  sealed_run boolean
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $ldos_sealed_authority_rpc$
  SELECT
    sr.source_id,
    sr.county_fips::text,
    sr.rights_state,
    pg_catalog.floor(pg_catalog.extract(EPOCH FROM sr.approved_caching_until) * 1000)
      ::double precision AS approved_caching_until_ms,
    ir.id AS run_id,
    ir.source_version,
    pg_catalog.floor(pg_catalog.extract(EPOCH FROM seal.sealed_at) * 1000)
      ::double precision AS sealed_at_ms,
    seal.indexed_records,
    TRUE AS sealed_run
  FROM bdp_parcel_index.source_registry AS sr
  JOIN LATERAL (
    -- Do NOT silently fallback to an older complete/sealed run when a more
    -- recent finished run for this source is incomplete, failed or unsealed.
    SELECT finished.id, finished.source_id, finished.source_version,
           finished.finished_at, finished.outcome,
           finished.received_records, finished.omitted_unidentified,
           finished.source_reported_truncated
    FROM bdp_parcel_index.ingest_runs AS finished
    WHERE finished.source_id = sr.source_id
      AND finished.finished_at IS NOT NULL
    ORDER BY finished.finished_at DESC, finished.id DESC
    LIMIT 1
  ) AS ir ON TRUE
  JOIN bdp_parcel_index.parcel_run_seals AS seal
    ON seal.ingest_run_id = ir.id
    AND seal.source_id = sr.source_id
    AND seal.county_fips = sr.county_fips
    AND seal.source_version = ir.source_version
    AND seal.indexed_records = ir.received_records
    AND seal.sealed_at >= ir.finished_at
  WHERE p_county_fips ~ '^48[0-9]{3}$'
    AND sr.county_fips = p_county_fips::char(5)
    AND sr.rights_state = 'approved'
    AND sr.rights_review_reference IS NOT NULL
    AND sr.rights_reviewed_at IS NOT NULL
    AND sr.approved_caching_until > pg_catalog.clock_timestamp()
    AND ir.outcome = 'complete'
    AND ir.received_records IS NOT NULL
    AND ir.omitted_unidentified = 0
    AND ir.source_reported_truncated = FALSE
  ORDER BY sr.source_id COLLATE "C" ASC
  LIMIT 2
$ldos_sealed_authority_rpc$;

-- PostgreSQL defaults to PUBLIC EXECUTE for newly created functions.
-- Same-transaction revocation prevents a publicly callable interval.
-- ZERO GRANTs to metadata, geometry, browser or app roles. Later role
-- provisioning requires separate independent DBA and GIS-rights review.
REVOKE ALL ON FUNCTION bdp_parcel_index.parcel_sealed_source_authority_rpc(
  text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION bdp_parcel_index.parcel_sealed_source_authority_rpc(
  text
) FROM ldos_parcel_rpc_client;

COMMENT ON FUNCTION bdp_parcel_index.parcel_sealed_source_authority_rpc(
  text
) IS
  'STAGED: bounded cache-rights/immutable-run source lookup, not a publication decision, browser geometry service, or county completeness proof. No production EXECUTE grant.';

COMMIT;
