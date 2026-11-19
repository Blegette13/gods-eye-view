-- Step 40C-62D-C14B2C1 — disposable role-isolation matrix ONLY.
-- DO NOT APPLY to persistent ldos_auth_dev, Supabase, GIS or production.
-- Prepared for a fresh --network none postgres:17 instance initialized as
-- ldos_c14b_disposable; replace the two placeholders only with random
-- synthetic 64-hex secrets in the disposable runner's process memory.
-- No CREATE FUNCTION, procedure EXECUTE grant, table grant, or real user.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $c14b2c1_guard$
BEGIN
  IF current_database()<>'ldos_c14b_disposable'
     OR current_user<>'postgres'
     OR pg_is_in_recovery()
     OR current_setting('password_encryption')<>'scram-sha-256'
     OR to_regnamespace('ldos_app_auth') IS NULL
     OR to_regclass('ldos_app_auth.accounts') IS NULL
     OR to_regclass('ldos_app_auth.sessions') IS NULL
     OR to_regclass('ldos_app_auth.county_grants') IS NULL
     OR to_regclass('ldos_app_auth.enrollment_reviewer_authorities') IS NULL
     OR to_regclass('ldos_app_auth.enrollment_invitations') IS NULL
     OR to_regclass('ldos_app_auth.enrollment_requests') IS NULL
     OR to_regclass('ldos_app_auth.enrollment_approvals') IS NULL
     OR to_regclass('ldos_app_auth.enrollment_audit_events') IS NULL
     OR to_regprocedure('ldos_app_auth.disposable_enrollment_transition(text,uuid,text,uuid,uuid,uuid,bigint)') IS NULL
     OR EXISTS (SELECT 1 FROM ldos_app_auth.accounts)
     OR EXISTS (SELECT 1 FROM ldos_app_auth.sessions)
     OR EXISTS (SELECT 1 FROM ldos_app_auth.county_grants)
     OR EXISTS (SELECT 1 FROM ldos_app_auth.enrollment_requests)
     OR EXISTS (SELECT 1 FROM ldos_app_auth.enrollment_approvals)
     OR EXISTS (SELECT 1 FROM ldos_app_auth.enrollment_audit_events)
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname IN (
         'ldos_auth_gateway_login',
         'ldos_auth_account_reader',
         'ldos_auth_enrollment_executor_login',
         'ldos_auth_review_issuer_login',
         'ldos_auth_enrollment_writer',
         'ldos_auth_review_issuer_writer'
       )
     )
  THEN RAISE EXCEPTION 'C14B2C1 requires untouched isolated PG17 fixture'
    USING ERRCODE='42501';
  END IF;
END;
$c14b2c1_guard$;

CREATE ROLE ldos_auth_enrollment_executor_login
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  NOBYPASSRLS PASSWORD '__C14B2C1_EXECUTOR_64HEX__';
CREATE ROLE ldos_auth_review_issuer_login
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  NOBYPASSRLS PASSWORD '__C14B2C1_ISSUER_64HEX__';
CREATE ROLE ldos_auth_enrollment_writer
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE ldos_auth_review_issuer_writer
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

-- C14B2C1 intentionally grants NO role membership, NO EXECUTE,
-- NO schema USAGE and NO direct SELECT, INSERT or UPDATE on any table.
-- The future separately reviewed issuer/executor routines are not built.
COMMIT;
