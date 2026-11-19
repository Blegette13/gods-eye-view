-- STEP 40C-62D-C14B1 — DISPOSABLE PostgreSQL 17 SCHEMA ONLY.
-- Not a migration for persistent ldos_auth_dev, Supabase, or parcel PostGIS.
-- Must run ONLY inside a new isolated postgres:17 instance whose database is
-- ldos_c14b_disposable. No app account, writer, HTTP endpoint or GIS rights.
-- The triggers protect data shape/revisions, NOT approval authority: an
-- actual restricted enrollment writer/atomic approval procedure is NOT ready.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $c14b_disposable_guard$
BEGIN
  IF current_database() <> 'ldos_c14b_disposable'
     OR pg_is_in_recovery()
     OR current_user <> 'postgres'
     OR to_regnamespace('ldos_app_auth') IS NULL
     OR to_regclass('ldos_app_auth.accounts') IS NULL
     OR to_regclass('ldos_app_auth.sessions') IS NULL
     OR to_regclass('ldos_app_auth.county_grants') IS NULL
     OR EXISTS (SELECT 1 FROM ldos_app_auth.accounts)
     OR EXISTS (SELECT 1 FROM ldos_app_auth.sessions)
     OR EXISTS (SELECT 1 FROM ldos_app_auth.county_grants)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                WHERE rolname='ldos_auth_gateway_login')
     OR to_regclass('ldos_app_auth.enrollment_requests') IS NOT NULL
  THEN RAISE EXCEPTION 'C14B requires new isolated empty synthetic database';
  END IF;
END;
$c14b_disposable_guard$;

CREATE TABLE ldos_app_auth.enrollment_reviewer_authorities (
  reviewer_subject uuid PRIMARY KEY,
  authority_state text NOT NULL DEFAULT 'revoked'
    CHECK (authority_state IN ('active','revoked')),
  authority_scope text NOT NULL DEFAULT 'none'
    CHECK (authority_scope IN ('none','account_enrollment_review')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE ldos_app_auth.enrollment_invitations (
  invite_id uuid PRIMARY KEY,
  subject uuid NOT NULL,
  issuer text NOT NULL
    CHECK (issuer ~ '^https://[a-z0-9]{8,40}[.]supabase[.]co/auth/v1$'),
  issued_by uuid NOT NULL REFERENCES ldos_app_auth.enrollment_reviewer_authorities(reviewer_subject),
  nonce_digest text NOT NULL UNIQUE CHECK (nonce_digest ~ '^[0-9a-f]{64}$'),
  invitation_state text NOT NULL DEFAULT 'revoked'
    CHECK (invitation_state IN ('pending','redeemed','revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (issued_by <> subject),
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '24 hours'),
  UNIQUE (invite_id, subject, issuer)
);

CREATE TABLE ldos_app_auth.enrollment_requests (
  request_id uuid PRIMARY KEY,
  invite_id uuid NOT NULL UNIQUE,
  subject uuid NOT NULL,
  issuer text NOT NULL,
  request_state text NOT NULL DEFAULT 'pending'
    CHECK (request_state IN (
      'pending','approved_for_enrollment','denied',
      'enrolled_suspended','activated','revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '24 hours'),
  FOREIGN KEY (invite_id, subject, issuer)
    REFERENCES ldos_app_auth.enrollment_invitations(invite_id, subject, issuer),
  UNIQUE (request_id, subject, issuer)
);

CREATE TABLE ldos_app_auth.enrollment_approvals (
  approval_id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  subject uuid NOT NULL,
  issuer text NOT NULL,
  reviewer_subject uuid NOT NULL
    REFERENCES ldos_app_auth.enrollment_reviewer_authorities(reviewer_subject),
  purpose text NOT NULL CHECK (purpose IN ('enroll_suspended','activate')),
  decision text NOT NULL DEFAULT 'deny'
    CHECK (decision IN ('approve','deny')),
  approval_state text NOT NULL DEFAULT 'revoked'
    CHECK (approval_state IN ('unconsumed','consumed','revoked')),
  nonce_digest text NOT NULL UNIQUE CHECK (nonce_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consumed_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (reviewer_subject <> subject),
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '15 minutes'),
  CHECK ((approval_state='consumed') = (consumed_at IS NOT NULL)),
  FOREIGN KEY (request_id,subject,issuer)
    REFERENCES ldos_app_auth.enrollment_requests(request_id,subject,issuer),
  UNIQUE (request_id,purpose)
);

CREATE TABLE ldos_app_auth.enrollment_audit_events (
  event_id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  subject uuid NOT NULL,
  reviewer_subject uuid NOT NULL
    REFERENCES ldos_app_auth.enrollment_reviewer_authorities(reviewer_subject),
  event_type text NOT NULL CHECK (event_type IN (
    'requested','reviewed','denied','enrolled_suspended','activated','revoked')),
  account_revision bigint CHECK (account_revision > 0),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (request_id,subject)
    REFERENCES ldos_app_auth.enrollment_requests(request_id,subject),
  CHECK ((event_type IN ('enrolled_suspended','activated'))
    = (account_revision IS NOT NULL))
);

CREATE FUNCTION ldos_app_auth.guard_enrollment_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $c14b_revision$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'enrollment authority rows may not be removed'
      USING ERRCODE='42501';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision IS DISTINCT FROM 1
       OR (TG_TABLE_NAME='enrollment_approvals' AND NEW.consumed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'invalid initial enrollment revision'
      USING ERRCODE='22023';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'UPDATE'
     OR NEW.revision IS DISTINCT FROM OLD.revision
     OR OLD.revision=9223372036854775807 THEN
    RAISE EXCEPTION 'enrollment revision must be database-managed'
      USING ERRCODE='42501';
  END IF;

  IF TG_TABLE_NAME='enrollment_reviewer_authorities' THEN
    IF NEW.reviewer_subject IS DISTINCT FROM OLD.reviewer_subject
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (NEW.authority_state IS NOT DISTINCT FROM OLD.authority_state
           AND NEW.authority_scope IS NOT DISTINCT FROM OLD.authority_scope)
    THEN RAISE EXCEPTION 'reviewer binding cannot change' USING ERRCODE='42501';
    END IF;

  ELSIF TG_TABLE_NAME='enrollment_invitations' THEN
    IF NEW.invite_id IS DISTINCT FROM OLD.invite_id
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.issuer IS DISTINCT FROM OLD.issuer
       OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
       OR NEW.nonce_digest IS DISTINCT FROM OLD.nonce_digest
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NOT (OLD.invitation_state='pending'
          AND NEW.invitation_state IN ('redeemed','revoked'))
       OR OLD.expires_at <= clock_timestamp()
    THEN RAISE EXCEPTION 'invitation cannot be rebound or replayed'
      USING ERRCODE='42501';
    END IF;

  ELSIF TG_TABLE_NAME='enrollment_requests' THEN
    IF NEW.request_id IS DISTINCT FROM OLD.request_id
       OR NEW.invite_id IS DISTINCT FROM OLD.invite_id
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.issuer IS DISTINCT FROM OLD.issuer
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR OLD.expires_at <= clock_timestamp()
       OR NOT (
         (OLD.request_state='pending' AND NEW.request_state IN
           ('approved_for_enrollment','denied','revoked'))
         OR (OLD.request_state='approved_for_enrollment' AND NEW.request_state IN
           ('enrolled_suspended','revoked'))
         OR (OLD.request_state='enrolled_suspended' AND NEW.request_state IN
           ('activated','revoked'))
       )
    THEN RAISE EXCEPTION 'request cannot be rebound or replayed'
      USING ERRCODE='42501';
    END IF;

  ELSIF TG_TABLE_NAME='enrollment_approvals' THEN
    IF NEW.approval_id IS DISTINCT FROM OLD.approval_id
       OR NEW.request_id IS DISTINCT FROM OLD.request_id
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.issuer IS DISTINCT FROM OLD.issuer
       OR NEW.reviewer_subject IS DISTINCT FROM OLD.reviewer_subject
       OR NEW.purpose IS DISTINCT FROM OLD.purpose
       OR NEW.decision IS DISTINCT FROM OLD.decision
       OR NEW.nonce_digest IS DISTINCT FROM OLD.nonce_digest
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR OLD.approval_state <> 'unconsumed'
       OR NEW.approval_state NOT IN ('consumed','revoked')
       OR (NEW.approval_state='consumed'
         AND (NEW.consumed_at IS NULL OR OLD.decision <> 'approve'
           OR OLD.expires_at <= clock_timestamp()))
       OR (NEW.approval_state='revoked' AND NEW.consumed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'approval cannot be rebound or replayed'
      USING ERRCODE='42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'unrecognized enrollment authority table'
      USING ERRCODE='42501';
  END IF;

  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$c14b_revision$;

CREATE FUNCTION ldos_app_auth.guard_enrollment_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $c14b_audit$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'enrollment audit is append-only'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$c14b_audit$;

CREATE TRIGGER c14b_reviewer_revision BEFORE INSERT OR UPDATE OR DELETE
  ON ldos_app_auth.enrollment_reviewer_authorities
  FOR EACH ROW EXECUTE FUNCTION ldos_app_auth.guard_enrollment_revision();
CREATE TRIGGER c14b_invitation_revision BEFORE INSERT OR UPDATE OR DELETE
  ON ldos_app_auth.enrollment_invitations
  FOR EACH ROW EXECUTE FUNCTION ldos_app_auth.guard_enrollment_revision();
CREATE TRIGGER c14b_request_revision BEFORE INSERT OR UPDATE OR DELETE
  ON ldos_app_auth.enrollment_requests
  FOR EACH ROW EXECUTE FUNCTION ldos_app_auth.guard_enrollment_revision();
CREATE TRIGGER c14b_approval_revision BEFORE INSERT OR UPDATE OR DELETE
  ON ldos_app_auth.enrollment_approvals
  FOR EACH ROW EXECUTE FUNCTION ldos_app_auth.guard_enrollment_revision();
CREATE TRIGGER c14b_audit_insert_only BEFORE INSERT OR UPDATE OR DELETE
  ON ldos_app_auth.enrollment_audit_events
  FOR EACH ROW EXECUTE FUNCTION ldos_app_auth.guard_enrollment_audit();

CREATE TRIGGER c14b_reviewer_no_truncate BEFORE TRUNCATE
  ON ldos_app_auth.enrollment_reviewer_authorities
  FOR EACH STATEMENT EXECUTE FUNCTION ldos_app_auth.guard_enrollment_revision();
CREATE TRIGGER c14b_invitation_no_truncate BEFORE TRUNCATE
  ON ldos_app_auth.enrollment_invitations
  FOR EACH STATEMENT EXECUTE FUNCTION ldos_app_auth.guard_enrollment_revision();
CREATE TRIGGER c14b_request_no_truncate BEFORE TRUNCATE
  ON ldos_app_auth.enrollment_requests
  FOR EACH STATEMENT EXECUTE FUNCTION ldos_app_auth.guard_enrollment_revision();
CREATE TRIGGER c14b_approval_no_truncate BEFORE TRUNCATE
  ON ldos_app_auth.enrollment_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION ldos_app_auth.guard_enrollment_revision();
CREATE TRIGGER c14b_audit_no_truncate BEFORE TRUNCATE
  ON ldos_app_auth.enrollment_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION ldos_app_auth.guard_enrollment_audit();

REVOKE ALL ON ALL TABLES IN SCHEMA ldos_app_auth FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ldos_app_auth FROM PUBLIC;
-- No positive grant. No writer role, endpoint or signed approval checker.
-- C14B2 will need an independently authorized, atomic primary writer.
COMMIT;
