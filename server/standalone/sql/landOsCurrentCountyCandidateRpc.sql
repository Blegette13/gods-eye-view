-- STEP 40C-59 — UNROUTED, REVIEW-ONLY APP-OWNED CURRENT CANDIDATE RPC.
-- Apply ONLY after the 40C-57 ledger IN A FRESH DISPOSABLE TEST DATABASE.
-- NEVER apply to Supabase Auth or a live Land OS database at this stage.
-- This does NOT verify the Supabase JWT, MFA assurance, server-issued
-- sessions, user consent, county entitlement provenance or GIS source rights.
-- A matching stored row is CANDIDATE EVIDENCE, NOT release authorization.
-- No HTTP handler, login issuance or geometry access is created here.
BEGIN;

-- FUNCTION OWNER MUST BE A SEPARATE NOLOGIN NON-SUPERUSER ROLE IN A REAL
-- DEPLOYMENT, WITH ONLY the necessary SELECT permissions. The disposable
-- test owner is not an example for production role provisioning.
CREATE FUNCTION ldos_app_auth.current_county_candidate_rpc(
  p_session_digest text,
  p_county_fips text
)
RETURNS TABLE (
  account_epoch bigint,
  session_epoch bigint,
  county_grant_epoch bigint
)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $ldos_current$
  SELECT a.revision, s.revision, g.revision
  FROM ldos_app_auth.sessions AS s
  JOIN ldos_app_auth.accounts AS a
    ON a.subject = s.subject
  JOIN ldos_app_auth.county_grants AS g
    ON g.subject = a.subject
   AND g.county_fips = p_county_fips
  WHERE p_session_digest ~ '^[0-9a-f]{64}$'
    AND p_county_fips ~ '^48[0-9]{3}$'
    AND s.session_digest = p_session_digest
    AND s.session_state = 'active'
    AND s.mfa_state = 'verified'
    AND a.account_state = 'active'
    AND g.grant_state = 'allowed'
    AND s.issued_at <= clock_timestamp()
    AND s.expires_at > clock_timestamp();
$ldos_current$;

-- PostgreSQL defaults functions to PUBLIC EXECUTE: revoke immediately
-- inside the same atomic transaction, BEFORE any caller can invoke it.
REVOKE ALL ON FUNCTION ldos_app_auth.current_county_candidate_rpc(text,text)
  FROM PUBLIC;
-- No GRANT to any production or authenticated user, no schema USAGE
-- to browser, anon, authenticated, service_role or the public.
-- Only a future separately vetted server-held candidate-reader SQL LOGIN
-- may receive the precise EXECUTE privilege through a reviewed migration.
COMMIT;
