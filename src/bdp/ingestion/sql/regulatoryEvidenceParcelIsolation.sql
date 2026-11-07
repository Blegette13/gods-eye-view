-- Step 47: fail-closed parcel isolation for restricted PostGIS evidence roles.
--
-- Prerequisites: regulatoryEvidenceLedger.sql and regulatoryEvidenceRoles.sql.
-- Use a trusted local database administrator. NO operator accounts are
-- created, and NO real parcel access is granted by this migration.
--
-- PostgreSQL login session_user (not client-supplied JSON or SET ROLE) is
-- matched to an administrator-controlled exact parcel grant. Non-superuser
-- application logins must inherit the NOLOGIN reader/appender group roles.
-- Never use the original bdp database owner/superuser for an application.
--
-- The owner/superuser can bypass RLS; the ACL is NOT a complete auth system.
-- Run regulatoryEvidenceParcelIsolationSmoke.sql to exercise two ephemeral
-- simulated operator logins and ROLLBACK their test data/grants.

BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'bdp_evidence_acl_owner') THEN
    CREATE ROLE bdp_evidence_acl_owner NOLOGIN;
  END IF;
END;
$roles$;
ALTER ROLE bdp_evidence_acl_owner NOLOGIN;
GRANT USAGE ON SCHEMA public TO bdp_evidence_acl_owner;

CREATE TABLE IF NOT EXISTS public.bdp_evidence_parcel_acl (
  login_role NAME NOT NULL,
  county_fips CHAR(5) NOT NULL,
  parcel_id TEXT NOT NULL,
  can_read BOOLEAN NOT NULL DEFAULT FALSE,
  can_append BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (login_role, county_fips, parcel_id),
  CONSTRAINT bdp_evidence_acl_county CHECK (county_fips ~ '^48[0-9]{3}$'),
  CONSTRAINT bdp_evidence_acl_parcel CHECK
    (parcel_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'),
  CONSTRAINT bdp_evidence_acl_nonempty CHECK (can_read OR can_append)
);

-- Grant registry is admin-managed. Neither group role nor evidence function
-- owner can read or mutate the ACL. Only the isolated ACL function owner
-- receives SELECT; nobody gets an automatically provisioned parcel grant.
REVOKE ALL ON public.bdp_evidence_parcel_acl FROM PUBLIC;
REVOKE ALL ON public.bdp_evidence_parcel_acl FROM
  bdp_evidence_reader, bdp_evidence_appender, bdp_evidence_owner,
  bdp_evidence_acl_owner;
GRANT SELECT ON public.bdp_evidence_parcel_acl TO bdp_evidence_acl_owner;

CREATE OR REPLACE FUNCTION public.bdp_evidence_has_parcel_access(
  p_county_fips TEXT, p_parcel_id TEXT, p_operation TEXT
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $access$
  SELECT p_operation IN ('read-index', 'append-event')
    AND EXISTS (
      SELECT 1 FROM public.bdp_evidence_parcel_acl AS g
      WHERE g.login_role = SESSION_USER::NAME
        AND g.county_fips = p_county_fips
        AND g.parcel_id = p_parcel_id
        AND g.expires_at > CURRENT_TIMESTAMP
        AND CASE WHEN p_operation = 'read-index'
          THEN g.can_read
          WHEN p_operation = 'append-event'
          THEN g.can_append
          ELSE FALSE END
    );
$access$;
ALTER FUNCTION public.bdp_evidence_has_parcel_access(TEXT, TEXT, TEXT)
  OWNER TO bdp_evidence_acl_owner;
REVOKE ALL ON FUNCTION public.bdp_evidence_has_parcel_access(TEXT, TEXT, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.bdp_evidence_has_parcel_access(TEXT, TEXT, TEXT)
  TO bdp_evidence_reader, bdp_evidence_owner;

-- RLS prevents unrestricted row access for restricted LOGIN users. Policies
-- combine group role membership and exact, unexpired grants. The append RPC
-- executes under bdp_evidence_owner (Step 46), but the ACL still checks the
-- original authenticated PostgreSQL SESSION_USER.
ALTER TABLE public.bdp_regulatory_evidence_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bdp_evidence_reader_parcel_isolation
  ON public.bdp_regulatory_evidence_events;
CREATE POLICY bdp_evidence_reader_parcel_isolation
  ON public.bdp_regulatory_evidence_events
  FOR SELECT TO bdp_evidence_reader
  USING (public.bdp_evidence_has_parcel_access(
    BTRIM(county_fips), parcel_id, 'read-index'
  ));

DROP POLICY IF EXISTS bdp_evidence_owner_insert_parcel_isolation
  ON public.bdp_regulatory_evidence_events;
CREATE POLICY bdp_evidence_owner_insert_parcel_isolation
  ON public.bdp_regulatory_evidence_events
  FOR INSERT TO bdp_evidence_owner
  WITH CHECK (public.bdp_evidence_has_parcel_access(
    BTRIM(county_fips), parcel_id, 'append-event'
  ));

-- INSERT...RETURNING uses the restricted function owner's SELECT privileges.
-- Its SELECT policy may see ONLY rows in the original login's append grants.
DROP POLICY IF EXISTS bdp_evidence_owner_returning_parcel_isolation
  ON public.bdp_regulatory_evidence_events;
CREATE POLICY bdp_evidence_owner_returning_parcel_isolation
  ON public.bdp_regulatory_evidence_events
  FOR SELECT TO bdp_evidence_owner
  USING (public.bdp_evidence_has_parcel_access(
    BTRIM(county_fips), parcel_id, 'append-event'
  ));

COMMENT ON TABLE public.bdp_evidence_parcel_acl IS
  'Admin-managed exact parcel grants bound to authenticated PostgreSQL LOGIN session_user; no browser claims, no wildcard access, expires by timestamp.';
COMMENT ON FUNCTION public.bdp_evidence_has_parcel_access(TEXT, TEXT, TEXT) IS
  'Restricted evidence parcel ACL check. Owner/superuser can bypass RLS; never run browser API as DB owner.';

COMMIT;
