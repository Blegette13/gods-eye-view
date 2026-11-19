-- Step 40C-62D-C14B2C2B — DISPOSABLE OWNER-ONLY APPROVAL ISSUANCE.
-- TEST PROTOTYPE, never apply to persistent ldos_auth_dev, Supabase or GIS.
-- It proves locked, audited, purpose-specific SQL issuance with synthetic
-- reviewers; it cannot authenticate a real reviewer, bootstrap an admin
-- or authorize an application LOGIN. No grants or account/session writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $c14b2c2b_install_guard$
BEGIN
  IF current_database()<>'ldos_c14b_disposable'
     OR current_user<>'postgres' OR pg_is_in_recovery()
     OR to_regnamespace('ldos_app_auth') IS NULL
     OR to_regclass('ldos_app_auth.accounts') IS NULL
     OR to_regclass('ldos_app_auth.enrollment_reviewer_authorities') IS NULL
     OR to_regclass('ldos_app_auth.enrollment_invitations') IS NULL
     OR to_regclass('ldos_app_auth.enrollment_requests') IS NULL
     OR to_regclass('ldos_app_auth.enrollment_approvals') IS NULL
     OR to_regclass('ldos_app_auth.enrollment_audit_events') IS NULL
     OR to_regprocedure(
       'ldos_app_auth.disposable_enrollment_transition(text,uuid,text,uuid,uuid,uuid,bigint)'
     ) IS NULL
     OR to_regprocedure(
       'ldos_app_auth.disposable_issue_enrollment_review(text,uuid,text,uuid,uuid,uuid,text,uuid,bigint)'
     ) IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname IN ('ldos_auth_gateway_login','ldos_auth_account_reader',
         'ldos_auth_enrollment_writer','ldos_auth_review_issuer_writer',
         'ldos_auth_enrollment_executor_login','ldos_auth_review_issuer_login'))
  THEN RAISE EXCEPTION 'C14B2C2B requires fresh synthetic PG17 fixture'
    USING ERRCODE='42501';
  END IF;
END;
$c14b2c2b_install_guard$;

CREATE FUNCTION ldos_app_auth.disposable_issue_enrollment_review(
  p_phase text,
  p_subject uuid,
  p_issuer text,
  p_request_id uuid,
  p_reviewer_subject uuid,
  p_approval_id uuid,
  p_nonce_digest text,
  p_audit_id uuid,
  p_expected_account_revision bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=pg_catalog,pg_temp
AS $c14b2c2b_issue$
DECLARE
  v_request ldos_app_auth.enrollment_requests%ROWTYPE;
  v_invitation ldos_app_auth.enrollment_invitations%ROWTYPE;
  v_reviewer ldos_app_auth.enrollment_reviewer_authorities%ROWTYPE;
  v_account ldos_app_auth.accounts%ROWTYPE;
  v_now timestamptz;
  v_expiry timestamptz;
  v_revision bigint;
BEGIN
  -- OWNER-ONLY in a disposable database. Parameters alone do NOT prove
  -- reviewer identity. A future trusted issuer needs independently verified
  -- operator identity and a separate least-privilege routine.
  IF current_database()<>'ldos_c14b_disposable'
    OR current_user<>'postgres'
    OR pg_is_in_recovery()
    OR current_setting('transaction_isolation')<>'serializable'
    OR current_setting('transaction_read_only')<>'off'
    OR p_phase IS NULL
    OR p_phase NOT IN ('enroll_suspended','activate')
    OR p_subject IS NULL OR p_issuer IS NULL OR p_request_id IS NULL
    OR p_reviewer_subject IS NULL OR p_approval_id IS NULL
    OR p_nonce_digest IS NULL OR p_audit_id IS NULL
    OR p_issuer !~ '^https://[a-z0-9]{8,40}[.]supabase[.]co/auth/v1$'
    OR p_nonce_digest !~ '^[0-9a-f]{64}$'
    OR (p_phase='enroll_suspended'
      AND p_expected_account_revision IS NOT NULL)
    OR (p_phase='activate' AND
      (p_expected_account_revision IS NULL OR p_expected_account_revision<1
       OR p_expected_account_revision>=9223372036854775807))
  THEN RAISE EXCEPTION 'C14B2C2B synthetic issuance rejected'
    USING ERRCODE='42501';
  END IF;

  -- Fixed lock order matches the atomic executor where possible:
  -- request -> invitation -> reviewer -> account. Unique approval
  -- (request_id,purpose) provides final database replay fencing.
  SELECT * INTO v_request FROM ldos_app_auth.enrollment_requests
    WHERE request_id=p_request_id AND subject=p_subject AND issuer=p_issuer
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'C14B2C2B request mismatched' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_invitation FROM ldos_app_auth.enrollment_invitations
    WHERE invite_id=v_request.invite_id AND subject=p_subject
      AND issuer=p_issuer FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'C14B2C2B invitation mismatched' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_reviewer FROM ldos_app_auth.enrollment_reviewer_authorities
    WHERE reviewer_subject=p_reviewer_subject FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'C14B2C2B reviewer missing' USING ERRCODE='42501';
  END IF;

  v_now:=clock_timestamp();
  IF v_request.request_state IS DISTINCT FROM
      (CASE WHEN p_phase='enroll_suspended'
        THEN 'pending' ELSE 'enrolled_suspended' END)
     OR v_request.revision<1
     OR v_request.revision>=9223372036854775807
     OR v_request.expires_at<=v_now
     OR v_invitation.invitation_state<>'redeemed'
     OR v_invitation.expires_at<=v_now
     OR v_invitation.issued_by=p_subject
     OR v_invitation.issued_by=p_reviewer_subject
     OR p_reviewer_subject=p_subject
     OR v_reviewer.authority_state<>'active'
     OR v_reviewer.authority_scope<>'account_enrollment_review'
     OR v_reviewer.revision<1
  THEN RAISE EXCEPTION 'C14B2C2B invalid current reviewer authority'
    USING ERRCODE='42501';
  END IF;

  IF p_nonce_digest=v_invitation.nonce_digest THEN
    RAISE EXCEPTION 'C14B2C2B nonce reused' USING ERRCODE='42501';
  END IF;
  IF p_phase='enroll_suspended' THEN
    SELECT * INTO v_account FROM ldos_app_auth.accounts
      WHERE subject=p_subject FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'C14B2C2B account exists' USING ERRCODE='42501';
    END IF;
  ELSE
    SELECT * INTO v_account FROM ldos_app_auth.accounts
      WHERE subject=p_subject FOR UPDATE;
    IF NOT FOUND OR v_account.account_state<>'suspended'
       OR v_account.revision<>p_expected_account_revision THEN
      RAISE EXCEPTION 'C14B2C2B activation account stale'
        USING ERRCODE='42501';
    END IF;
  END IF;

  -- A revoked/consumed/denied approval must not be silently replaced.
  IF EXISTS (SELECT 1 FROM ldos_app_auth.enrollment_approvals
    WHERE request_id=p_request_id AND purpose=p_phase) THEN
    RAISE EXCEPTION 'C14B2C2B duplicate purpose' USING ERRCODE='42501';
  END IF;

  v_now:=clock_timestamp();
  v_expiry:=LEAST(v_now+interval '10 minutes',
    v_request.expires_at-interval '1 second',
    v_invitation.expires_at-interval '1 second');
  IF v_expiry<=v_now THEN
    RAISE EXCEPTION 'C14B2C2B approval would expire' USING ERRCODE='42501';
  END IF;

  INSERT INTO ldos_app_auth.enrollment_approvals (
    approval_id,request_id,subject,issuer,reviewer_subject,purpose,
    decision,approval_state,nonce_digest,created_at,expires_at
  ) VALUES (
    p_approval_id,p_request_id,p_subject,p_issuer,p_reviewer_subject,p_phase,
    'approve','unconsumed',p_nonce_digest,v_now,v_expiry
  ) RETURNING revision INTO v_revision;
  IF v_revision<>1 THEN
    RAISE EXCEPTION 'C14B2C2B initial approval revision rejected'
      USING ERRCODE='42501';
  END IF;

  IF p_phase='enroll_suspended' THEN
    UPDATE ldos_app_auth.enrollment_requests
      SET request_state='approved_for_enrollment'
      WHERE request_id=p_request_id AND revision=v_request.revision;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'C14B2C2B request transition rejected'
        USING ERRCODE='42501';
    END IF;
  END IF;

  INSERT INTO ldos_app_auth.enrollment_audit_events (
    event_id,request_id,subject,reviewer_subject,event_type,account_revision
  ) VALUES (
    p_audit_id,p_request_id,p_subject,p_reviewer_subject,'reviewed',NULL
  );
  -- Any audit conflict aborts the full caller transaction. No procedure
  -- COMMIT is issued, so the approval/request cannot be half-applied.
  RETURN v_revision;
END;
$c14b2c2b_issue$;

REVOKE ALL ON FUNCTION ldos_app_auth.disposable_issue_enrollment_review(
  text,uuid,text,uuid,uuid,uuid,text,uuid,bigint
) FROM PUBLIC;
COMMIT;
