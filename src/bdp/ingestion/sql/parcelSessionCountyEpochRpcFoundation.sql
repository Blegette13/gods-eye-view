-- Step 40C-47 — DBA REVIEW ONLY, SYNTHETIC SESSION/COUNTY RPC.
-- Depends on parcelSessionCountyEpochFoundation.sql. NOT an MFA, login,
-- revocation provider or application/user authorization to publish GIS data.
-- No live account/session integration. Do NOT apply to the existing DB.
BEGIN;

CREATE FUNCTION ldos_private_auth.parcel_session_county_epoch_rpc(
  p_session_digest text, p_county_fips text
)
RETURNS TABLE (
  session_digest text,
  county_fips text,
  epoch text
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $ldos_session_county_epoch_rpc$
  SELECT d.session_digest, d.county_fips::text, e.epoch::text
  FROM ldos_private_auth.session_county_decisions AS d
  JOIN ldos_private_auth.session_county_epochs AS e
    ON e.session_digest=d.session_digest
   AND e.county_fips=d.county_fips
   AND e.epoch>0
  WHERE p_session_digest ~ '^[0-9a-f]{64}$'
    AND p_county_fips ~ '^48[0-9]{3}$'
    AND d.session_digest=p_session_digest
    AND d.county_fips=p_county_fips::char(5)
    AND d.account_active IS TRUE
    AND d.mfa_verified IS TRUE
    AND d.session_active IS TRUE
    AND d.allow_discovery IS TRUE
  LIMIT 1
$ldos_session_county_epoch_rpc$;

REVOKE ALL ON FUNCTION
  ldos_private_auth.parcel_session_county_epoch_rpc(text,text) FROM PUBLIC;

COMMENT ON FUNCTION
  ldos_private_auth.parcel_session_county_epoch_rpc(text,text)
IS 'SYNTHETIC unmounted session/county epoch. Current toy flags and change version, never a real identity provider, permission to disclose parcels or final release gate.';
COMMIT;
