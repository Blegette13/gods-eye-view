-- Step 40C-36 — DBA REVIEW ONLY / NOT AUTO-MIGRATED.
-- Independent geometry-REDISTRIBUTION rights lookup. NOT source caching,
-- login authentication, user county entitlement, or browser permission.
-- Depends on the reviewed Step 40C-16 geometry_publication_reviews schema,
-- and should first be applied ONLY to isolated synthetic PostGIS fixtures.
-- A public county GIS endpoint does NOT constitute commercial republication
-- approval. The separate source-caching + immutable sealed-run authority
-- gates MUST still be checked before and after any geometry read.
BEGIN;

CREATE FUNCTION bdp_parcel_index.parcel_geometry_publication_review_rpc(
  p_county_fips text,
  p_source_id text
)
RETURNS TABLE (
  source_id text,
  county_fips text,
  review_state text,
  allow_geometry_redistribution boolean,
  review_reference text,
  reviewed_at_ms double precision,
  expires_at_ms double precision
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $ldos_publication_review_rpc$
  SELECT
    rights.source_id,
    rights.county_fips::text,
    rights.review_state,
    rights.allow_geometry_redistribution,
    rights.review_reference,
    FLOOR(EXTRACT(EPOCH FROM rights.reviewed_at) * 1000)
      ::double precision AS reviewed_at_ms,
    FLOOR(EXTRACT(EPOCH FROM rights.expires_at) * 1000)
      ::double precision AS expires_at_ms
  FROM bdp_parcel_index.geometry_publication_reviews AS rights
  WHERE p_county_fips ~ '^48[0-9]{3}$'
    AND p_source_id ~ '^[a-z][a-z0-9_-]{2,79}$'
    AND rights.county_fips = p_county_fips::char(5)
    AND rights.source_id = p_source_id
    AND rights.review_state = 'approved'
    AND rights.allow_geometry_redistribution = TRUE
    AND rights.review_reference ~ '^[A-Za-z0-9][A-Za-z0-9_./:-]{4,159}$'
    AND rights.reviewed_at IS NOT NULL
    AND rights.reviewed_at <= pg_catalog.clock_timestamp()
    AND rights.expires_at IS NOT NULL
    AND rights.expires_at > pg_catalog.clock_timestamp()
    AND rights.expires_at > rights.reviewed_at
  LIMIT 1
$ldos_publication_review_rpc$;

-- PostgreSQL normally gives PUBLIC EXECUTE on CREATE. Both revocations are
-- part of this same transaction. No GRANT to any service or any role.
REVOKE ALL ON FUNCTION bdp_parcel_index.parcel_geometry_publication_review_rpc(
  text,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION bdp_parcel_index.parcel_geometry_publication_review_rpc(
  text,text
) FROM ldos_parcel_rpc_client;

COMMENT ON FUNCTION bdp_parcel_index.parcel_geometry_publication_review_rpc(
  text,text
) IS
  'STAGED: independently reviewed current geometry redistribution evidence ONLY. Not a browser license, user grant, source caching approval or complete GIS coverage.';

COMMIT;
