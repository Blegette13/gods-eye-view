-- Step 40C-62D-C14B2A — REVIEWABLE DISPOSABLE-ONLY ATOMIC PROTOTYPE.
-- NOT a persistent auth-dev migration or a deployable enrollment writer.
-- This function is SECURITY INVOKER, PostgreSQL owner-only in synthetic PG17.
-- It cannot verify a real Supabase user or bootstrap a real administrator.
-- No application LOGIN, grants, HTTP endpoint, session, county or GIS access.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $c14b2a_guard$
BEGIN
  IF current_database() <> 'ldos_c14b_disposable'
    OR current_user <> 'postgres'
    OR pg_is_in_recovery()
    OR to_regnamespace('ldos_app_auth') IS NULL
    OR to_regclass('ldos_app_auth.accounts') IS NULL
    OR to_regclass('ldos_app_auth.enrollment_reviewer_authorities') IS NULL
    OR to_regclass('ldos_app_auth.enrollment_invitations') IS NULL
    OR to_regclass('ldos_app_auth.enrollment_requests') IS NULL
    OR to_regclass('ldos_app_auth.enrollment_approvals') IS NULL
    OR to_regclass('ldos_app_auth.enrollment_audit_events') IS NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles
               WHERE rolname IN ('ldos_auth_gateway_login',
                                 'ldos_auth_enrollment_writer'))
    OR to_regprocedure(
      'ldos_app_auth.disposable_enrollment_transition(text,uuid,text,uuid,uuid,uuid,bigint)'
    ) IS NOT NULL
  THEN RAISE EXCEPTION 'C14B2A requires separately guarded synthetic PG17'
    USING ERRCODE='42501';
  END IF;
END;
$c14b2a_guard$;

CREATE FUNCTION ldos_app_auth.disposable_enrollment_transition(
  p_phase text,
  p_subject uuid,
  p_issuer text,
  p_request_id uuid,
  p_approval_id uuid,
  p_audit_id uuid,
  p_expected_account_revision bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=pg_catalog,pg_temp
AS $c14b2a_atomic$
DECLARE
  v_request ldos_app_auth.enrollment_requests%ROWTYPE;
  v_invitation ldos_app_auth.enrollment_invitations%ROWTYPE;
  v_reviewer ldos_app_auth.enrollment_reviewer_authorities%ROWTYPE;
  v_approval ldos_app_auth.enrollment_approvals%ROWTYPE;
  v_account ldos_app_auth.accounts%ROWTYPE;
  v_reviewer_subject uuid;
  v_revision bigint;
  v_state text;
  v_now timestamptz;
BEGIN
  -- Only a synthetic superuser test can call this. A future restricted
  -- writer requires independent authenticated-approver evidence and a
  -- DIFFERENT audited procedure; never expose this one to an app client.
  IF current_database()<>'ldos_c14b_disposable'
     OR current_user<>'postgres'
     OR pg_is_in_recovery()
     OR current_setting('transaction_isolation')<>'serializable'
     OR current_setting('transaction_read_only')<>'off'
     OR p_phase IS NULL OR p_phase NOT IN ('enroll_suspended','activate')
     OR p_subject IS NULL OR p_request_id IS NULL OR p_approval_id IS NULL
     OR p_audit_id IS NULL OR p_issuer IS NULL
     OR p_issuer !~ '^https://[a-z0-9]{8,40}[.]supabase[.]co/auth/v1$'
     OR (p_phase='enroll_suspended' AND p_expected_account_revision IS NOT NULL)
     OR (p_phase='activate' AND (p_expected_account_revision IS NULL
          OR p_expected_account_revision<1
          OR p_expected_account_revision>=9223372036854775807))
  THEN RAISE EXCEPTION 'C14B2A refuses untrusted or non-serializable operation'
    USING ERRCODE='42501';
  END IF;

  -- Fixed row-lock order: request -> invitation -> reviewer -> approval
  -- -> account. The approval reviewer id read below is preliminary; it is
  -- compared again after acquiring the approval row lock.
  SELECT * INTO v_request
    FROM ldos_app_auth.enrollment_requests
    WHERE request_id=p_request_id AND subject=p_subject AND issuer=p_issuer
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found on primary' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_invitation
    FROM ldos_app_auth.enrollment_invitations
    WHERE invite_id=v_request.invite_id AND subject=p_subject
      AND issuer=p_issuer FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation mismatched on primary' USING ERRCODE='42501';
  END IF;

  SELECT a.reviewer_subject INTO v_reviewer_subject
    FROM ldos_app_auth.enrollment_approvals a
    WHERE a.approval_id=p_approval_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown approval' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_reviewer
    FROM ldos_app_auth.enrollment_reviewer_authorities
    WHERE reviewer_subject=v_reviewer_subject FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reviewer authority missing' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_approval
    FROM ldos_app_auth.enrollment_approvals
    WHERE approval_id=p_approval_id AND request_id=p_request_id
      AND subject=p_subject AND issuer=p_issuer FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval binding mismatched' USING ERRCODE='42501';
  END IF;

  v_now:=clock_timestamp();
  IF v_request.request_state IS DISTINCT FROM
       (CASE WHEN p_phase='enroll_suspended'
         THEN 'approved_for_enrollment' ELSE 'enrolled_suspended' END)
     OR v_request.revision<1 OR v_request.revision>=9223372036854775807
     OR v_request.expires_at<=v_now
     OR v_invitation.invitation_state<>'redeemed'
     OR v_invitation.expires_at<=v_now
     OR v_invitation.issued_by=p_subject
     OR v_reviewer.reviewer_subject IS DISTINCT FROM v_reviewer_subject
     OR v_reviewer.reviewer_subject=p_subject
     OR v_reviewer.reviewer_subject=v_invitation.issued_by
     OR v_reviewer.authority_state<>'active'
     OR v_reviewer.authority_scope<>'account_enrollment_review'
     OR v_reviewer.revision<1
     OR v_approval.reviewer_subject IS DISTINCT FROM v_reviewer_subject
     OR v_approval.purpose<>p_phase
     OR v_approval.decision<>'approve'
     OR v_approval.approval_state<>'unconsumed'
     OR v_approval.consumed_at IS NOT NULL
     OR v_approval.expires_at<=v_now
     OR v_approval.revision<1
     OR v_approval.revision>=9223372036854775807
     OR v_approval.nonce_digest=v_invitation.nonce_digest
  THEN RAISE EXCEPTION 'C14B2A evidence changed or approval already used'
    USING ERRCODE='42501';
  END IF;

  IF p_phase='enroll_suspended' THEN
    -- No UPSERT and no reuse of a closed or previously active subject.
    SELECT * INTO v_account FROM ldos_app_auth.accounts
      WHERE subject=p_subject FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'Subject already has an account' USING ERRCODE='42501';
    END IF;
    INSERT INTO ldos_app_auth.accounts(subject) VALUES (p_subject)
      RETURNING account_state,revision INTO v_state,v_revision;
    IF v_state<>'suspended' OR v_revision<>1 THEN
      RAISE EXCEPTION 'Suspended-first account invariant failed'
        USING ERRCODE='42501';
    END IF;
  ELSE
    SELECT * INTO v_account FROM ldos_app_auth.accounts
      WHERE subject=p_subject FOR UPDATE;
    IF NOT FOUND OR v_account.account_state<>'suspended'
       OR v_account.revision<>p_expected_account_revision THEN
      RAISE EXCEPTION 'Account activation revision/state changed'
        USING ERRCODE='42501';
    END IF;
    UPDATE ldos_app_auth.accounts SET account_state='active'
      WHERE subject=p_subject AND account_state='suspended'
        AND revision=p_expected_account_revision
      RETURNING account_state,revision INTO v_state,v_revision;
    IF NOT FOUND OR v_state<>'active'
       OR v_revision<>p_expected_account_revision+1 THEN
      RAISE EXCEPTION 'Account activation update rejected'
        USING ERRCODE='42501';
    END IF;
  END IF;

  UPDATE ldos_app_auth.enrollment_approvals
    SET approval_state='consumed',consumed_at=clock_timestamp()
    WHERE approval_id=p_approval_id AND approval_state='unconsumed'
      AND revision=v_approval.revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval consumption failed' USING ERRCODE='42501';
  END IF;
  UPDATE ldos_app_auth.enrollment_requests
    SET request_state=(CASE WHEN p_phase='enroll_suspended'
      THEN 'enrolled_suspended' ELSE 'activated' END)
    WHERE request_id=p_request_id AND revision=v_request.revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request transition failed' USING ERRCODE='42501';
  END IF;
  INSERT INTO ldos_app_auth.enrollment_audit_events (
    event_id,request_id,subject,reviewer_subject,event_type,account_revision
  ) VALUES (
    p_audit_id,p_request_id,p_subject,v_reviewer_subject,
    (CASE WHEN p_phase='enroll_suspended'
      THEN 'enrolled_suspended' ELSE 'activated' END),v_revision
  );
  -- A separate audit record is required, not an optional post-commit log.
  -- The statement's insert failure aborts the transaction. The caller
  -- must COMMIT exactly once after receiving a returned revision.
  RETURN v_revision;
END;
$c14b2a_atomic$;

-- Neither PUBLIC nor any current app gateway may call the prototype.
REVOKE ALL ON FUNCTION ldos_app_auth.disposable_enrollment_transition(
  text,uuid,text,uuid,uuid,uuid,bigint
) FROM PUBLIC;
COMMIT;
