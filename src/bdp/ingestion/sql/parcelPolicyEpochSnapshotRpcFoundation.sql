-- Step 40C-41: DBA-REVIEW ONLY / UNDEPLOYED fixed read-only policy epoch RPC.
-- Depends on the Step 40C-40 rights epoch table and its reviewed triggers.
-- NO auto-migration, role creation, EXECUTE GRANT, user or browser geometry.
-- Counter snapshots are necessary for revocation detection, NEVER proof
-- of current source caching rights, GIS republication, session or run seal.
BEGIN;

CREATE FUNCTION bdp_parcel_index.parcel_policy_epoch_snapshot_rpc(
  p_county_fips text, p_source_id text
)
RETURNS TABLE (
  source_id text,
  county_fips text,
  source_cache_epoch text,
  publication_epoch text
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $ldos_policy_epoch_snapshot_rpc$
  SELECT
    source.source_id,
    source.county_fips::text AS county_fips,
    cache.epoch::text AS source_cache_epoch,
    publication.epoch::text AS publication_epoch
  FROM bdp_parcel_index.source_registry AS source
  JOIN bdp_parcel_index.geometry_publication_reviews AS rights
    ON rights.source_id = source.source_id
   AND rights.county_fips = source.county_fips
  JOIN bdp_parcel_index.parcel_policy_epochs AS cache
    ON cache.source_id = source.source_id
   AND cache.policy_scope = 'source_cache'
  JOIN bdp_parcel_index.parcel_policy_epochs AS publication
    ON publication.source_id = source.source_id
   AND publication.policy_scope = 'geometry_publication'
  WHERE p_county_fips ~ '^48[0-9]{3}$'
    AND p_source_id ~ '^[a-z][a-z0-9_-]{2,79}$'
    AND source.county_fips = p_county_fips::char(5)
    AND source.source_id = p_source_id
    AND cache.epoch > 0 AND publication.epoch > 0
  LIMIT 1
$ldos_policy_epoch_snapshot_rpc$;

-- PostgreSQL grants PUBLIC EXECUTE by default: revoke in CREATE transaction.
REVOKE ALL ON FUNCTION
  bdp_parcel_index.parcel_policy_epoch_snapshot_rpc(text,text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  bdp_parcel_index.parcel_policy_epoch_snapshot_rpc(text,text)
  FROM ldos_parcel_rpc_client;

COMMENT ON FUNCTION
  bdp_parcel_index.parcel_policy_epoch_snapshot_rpc(text,text)
IS 'PRIVATE DRAFT: read exact two rights-change epochs only. Never implies current approval, legal rights or coverage. No browser delivery authorization.';

COMMIT;
