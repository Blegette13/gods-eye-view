-- Step 47 reversible smoke test. Requires Step 41, 46 and 47 migrations.
-- Run on local trusted PostGIS administrator connection ONLY.
-- This transaction creates temporary simulated LOGIN roles and synthetic
-- events/grants, exercises actual RLS and the append RPC, then ROLLS BACK.
-- PostgreSQL owner/superuser should NOT be used by an application service.
BEGIN;

CREATE ROLE bdp_acl_smoke_reader LOGIN INHERIT;
CREATE ROLE bdp_acl_smoke_appender LOGIN INHERIT;
GRANT bdp_evidence_reader TO bdp_acl_smoke_reader;
GRANT bdp_evidence_appender TO bdp_acl_smoke_appender;

INSERT INTO public.bdp_regulatory_evidence_events
  (county_fips, parcel_id, task_id, event_type, notes, entered_by)
VALUES
  ('48453', 'bdp-acl-allowed-smoke', 'verify-zoning-designation',
   'review-note', 'Synthetic allowed scope; not actual regulatory evidence', 'bdp-smoke'),
  ('48453', 'bdp-acl-denied-smoke', 'verify-zoning-designation',
   'review-note', 'Synthetic denied scope; not actual regulatory evidence', 'bdp-smoke');

-- Exactly one UNEXPIRED parcel grant per test login. Reader also
-- has an intentionally EXPIRED grant for the denied parcel; appender has no
-- second-parcel grant at all.
INSERT INTO public.bdp_evidence_parcel_acl
  (login_role, county_fips, parcel_id, can_read, can_append, expires_at)
VALUES
  ('bdp_acl_smoke_reader', '48453', 'bdp-acl-allowed-smoke',
   TRUE, FALSE, CURRENT_TIMESTAMP + INTERVAL '5 minutes'),
  ('bdp_acl_smoke_reader', '48453', 'bdp-acl-denied-smoke',
   TRUE, FALSE, CURRENT_TIMESTAMP - INTERVAL '5 minutes'),
  ('bdp_acl_smoke_appender', '48453', 'bdp-acl-allowed-smoke',
   FALSE, TRUE, CURRENT_TIMESTAMP + INTERVAL '5 minutes');

-- Test session_user identity, not a claimed browser role or SET ROLE.
SET SESSION AUTHORIZATION bdp_acl_smoke_reader;
DO $read$
DECLARE
  allowed_count BIGINT;
  denied_count BIGINT;
  all_rows BIGINT;
BEGIN
  SELECT COUNT(*) INTO allowed_count
  FROM public.bdp_regulatory_evidence_events
  WHERE parcel_id = 'bdp-acl-allowed-smoke';
  SELECT COUNT(*) INTO denied_count
  FROM public.bdp_regulatory_evidence_events
  WHERE parcel_id = 'bdp-acl-denied-smoke';
  SELECT COUNT(*) INTO all_rows
  FROM public.bdp_regulatory_evidence_events;
  IF allowed_count <> 1 OR denied_count <> 0 OR all_rows <> 1 THEN
    RAISE EXCEPTION
      'RLS reader isolation failed: allowed %, denied %, visible %',
      allowed_count, denied_count, all_rows;
  END IF;
  IF NOT public.bdp_evidence_has_parcel_access(
      '48453', 'bdp-acl-allowed-smoke', 'read-index')
    OR public.bdp_evidence_has_parcel_access(
      '48453', 'bdp-acl-denied-smoke', 'read-index')
    OR public.bdp_evidence_has_parcel_access(
      '48453', 'bdp-acl-allowed-smoke', 'append-event') THEN
    RAISE EXCEPTION 'ACL reader helper returned an unexpected permission';
  END IF;
  RAISE NOTICE 'BDP Step 47 reader: permitted parcel only; expired grant and append denied';
END;
$read$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION bdp_acl_smoke_appender;
DO $append$
DECLARE
  inserted JSONB;
  blocked_cross_parcel BOOLEAN := FALSE;
  blocked_direct_read BOOLEAN := FALSE;
BEGIN
  inserted := public.bdp_evidence_append_unverified(
    '{"countyFips":"48453","parcelId":"bdp-acl-allowed-smoke",
      "taskId":"verify-zoning-designation","eventType":"review-note",
      "sourceUrl":null,"sourceTitle":null,"sourceDate":null,
      "sourceSha256":null,"notes":"Synthetic append on granted parcel only",
      "enteredBy":"bdp-smoke"}'::jsonb);
  IF inserted->>'verificationState' <> 'unverified'
    OR inserted->>'legalClearance' IS NOT NULL
    OR inserted->>'acquisitionRecommendation' IS NOT NULL THEN
    RAISE EXCEPTION 'Appender returned an unsafe verification/clearance state';
  END IF;

  BEGIN
    PERFORM public.bdp_evidence_append_unverified(
      '{"countyFips":"48453","parcelId":"bdp-acl-denied-smoke",
        "taskId":"verify-zoning-designation","eventType":"review-note",
        "sourceUrl":null,"sourceTitle":null,"sourceDate":null,
        "sourceSha256":null,"notes":"This cross-parcel INSERT must fail",
        "enteredBy":"bdp-smoke"}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    blocked_cross_parcel := TRUE;
  END;
  IF NOT blocked_cross_parcel THEN
    RAISE EXCEPTION 'Cross-parcel append was not blocked by Postgres RLS';
  END IF;

  BEGIN
    PERFORM COUNT(*) FROM public.bdp_regulatory_evidence_events;
  EXCEPTION WHEN insufficient_privilege THEN
    blocked_direct_read := TRUE;
  END;
  IF NOT blocked_direct_read THEN
    RAISE EXCEPTION 'Append-only role should not be allowed to read base table';
  END IF;
  RAISE NOTICE 'BDP Step 47 appender: allowed unverified append; denied cross-parcel append and raw SELECT';
END;
$append$;
RESET SESSION AUTHORIZATION;

-- Ensure local fake identities and synthetic evidence never survive the test.
ROLLBACK;
