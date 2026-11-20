-- STEP 40C-57 — REVIEW-ONLY APP-OWNED AUTHORIZATION LEDGER FOUNDATION.
-- DRAFT FOR ISOLATED DISPOSABLE POSTGRES VALIDATION ONLY.
-- DO NOT APPLY TO A SUPABASE PROJECT, LIVE POSTGIS, OR PUBLIC DATA API.
-- This separate schema does NOT read auth.users, create users, validate MFA,
-- expose any API, issue sessions, or grant any database/application permissions.
-- Server-side Supabase subject verification and MFA assurance still required.
BEGIN;

-- Fail closed rather than reuse unknown existing schema/ownership.
CREATE SCHEMA ldos_app_auth;
REVOKE ALL ON SCHEMA ldos_app_auth FROM PUBLIC;

-- The authenticated Supabase subject must be verified SERVER-SIDE before
-- any trusted writer may enroll it. These are NOT Supabase auth.users rows.
CREATE TABLE ldos_app_auth.accounts (
  subject uuid PRIMARY KEY,
  account_state text NOT NULL DEFAULT 'suspended'
    CHECK (account_state IN ('active','suspended','closed')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Only a HMAC session digest, never the raw bearer/access/refresh token.
-- Deny-first defaults even if a future provisioning caller omits states.
CREATE TABLE ldos_app_auth.sessions (
  session_digest text PRIMARY KEY
    CHECK (session_digest ~ '^[0-9a-f]{64}$'),
  subject uuid NOT NULL REFERENCES ldos_app_auth.accounts(subject)
    ON DELETE RESTRICT,
  session_state text NOT NULL DEFAULT 'revoked'
    CHECK (session_state IN ('active','revoked')),
  mfa_state text NOT NULL DEFAULT 'unverified'
    CHECK (mfa_state IN ('verified','unverified')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '8 hours')
);
CREATE INDEX sessions_by_subject ON ldos_app_auth.sessions(subject);

-- Each Texas county entitlement is distinct from GIS-source licensing.
-- County rows are tombstoned (denied), not physically deleted and recreated.
CREATE TABLE ldos_app_auth.county_grants (
  subject uuid NOT NULL REFERENCES ldos_app_auth.accounts(subject)
    ON DELETE RESTRICT,
  county_fips text NOT NULL CHECK (county_fips ~ '^48[0-9]{3}$'),
  grant_state text NOT NULL DEFAULT 'denied'
    CHECK (grant_state IN ('allowed','denied')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (subject, county_fips)
);

-- PostgreSQL row locks serialize concurrent changes to the same row.
-- Every accepted UPDATE bumps its revision, including ABA restored flags.
-- A caller cannot reset a revision or mutate row identities. DO NOT expose
-- table owner privileges; a superuser/owner can bypass ordinary triggers.
CREATE FUNCTION ldos_app_auth.guard_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'authority rows must be retained; deny via state'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.revision IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'initial authority revision must be 1'
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'unexpected authority mutation' USING ERRCODE = '22023';
  END IF;
  IF NEW.revision IS DISTINCT FROM OLD.revision THEN
    RAISE EXCEPTION 'authority revision is database-managed'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.revision = 9223372036854775807 THEN
    RAISE EXCEPTION 'authority revision exhausted' USING ERRCODE = '22003';
  END IF;

  IF TG_TABLE_NAME = 'accounts' THEN
    IF NEW.subject IS DISTINCT FROM OLD.subject
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'account identity is immutable' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'sessions' THEN
    IF NEW.session_digest IS DISTINCT FROM OLD.session_digest
      OR NEW.subject IS DISTINCT FROM OLD.subject
      OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
      RAISE EXCEPTION 'session binding is immutable' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'county_grants' THEN
    IF NEW.subject IS DISTINCT FROM OLD.subject
      OR NEW.county_fips IS DISTINCT FROM OLD.county_fips THEN
      RAISE EXCEPTION 'county binding is immutable' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown authority table' USING ERRCODE = '42501';
  END IF;
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ldos_app_auth.guard_revision() FROM PUBLIC;

CREATE TRIGGER account_revision
  BEFORE INSERT OR UPDATE OR DELETE ON ldos_app_auth.accounts
  FOR EACH ROW EXECUTE FUNCTION ldos_app_auth.guard_revision();
CREATE TRIGGER session_revision
  BEFORE INSERT OR UPDATE OR DELETE ON ldos_app_auth.sessions
  FOR EACH ROW EXECUTE FUNCTION ldos_app_auth.guard_revision();
CREATE TRIGGER county_grant_revision
  BEFORE INSERT OR UPDATE OR DELETE ON ldos_app_auth.county_grants
  FOR EACH ROW EXECUTE FUNCTION ldos_app_auth.guard_revision();

-- PostgreSQL TRUNCATE bypasses row DELETE triggers, so separately deny it.
CREATE TRIGGER account_no_truncate
  BEFORE TRUNCATE ON ldos_app_auth.accounts
  FOR EACH STATEMENT EXECUTE FUNCTION ldos_app_auth.guard_revision();
CREATE TRIGGER session_no_truncate
  BEFORE TRUNCATE ON ldos_app_auth.sessions
  FOR EACH STATEMENT EXECUTE FUNCTION ldos_app_auth.guard_revision();
CREATE TRIGGER county_grant_no_truncate
  BEFORE TRUNCATE ON ldos_app_auth.county_grants
  FOR EACH STATEMENT EXECUTE FUNCTION ldos_app_auth.guard_revision();

REVOKE ALL ON ALL TABLES IN SCHEMA ldos_app_auth FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ldos_app_auth FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ldos_app_auth FROM PUBLIC;
-- No role/table/function grants, no RLS policies, no HTTP/Data API exposure,
-- and no administrative public procedures in this draft.
COMMIT;
