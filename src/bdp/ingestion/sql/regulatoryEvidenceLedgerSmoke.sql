-- Transactional database smoke test for Step 41 evidence journal.
-- Requires regulatoryEvidenceLedger.sql installed first.
-- Inserts a synthetic review note, tests append-only and unverified checks,
-- then ROLLS BACK: no evidence documents or fake clearance is persisted.

BEGIN;

DO $smoke$
DECLARE
  event_id BIGINT;
  blocked_update BOOLEAN := FALSE;
  blocked_delete BOOLEAN := FALSE;
  blocked_verified BOOLEAN := FALSE;
  found_state TEXT;
BEGIN
  INSERT INTO bdp_regulatory_evidence_events
    (county_fips, parcel_id, task_id, event_type, notes, entered_by)
  VALUES
    ('48453', 'bdp-smoke-fixture', 'verify-zoning-designation',
     'review-note', 'Synthetic regression fixture only. No zoning evidence.', 'bdp-test')
  RETURNING id INTO event_id;

  SELECT verification_state INTO found_state
    FROM bdp_regulatory_evidence_events WHERE id = event_id;
  IF found_state <> 'unverified' THEN
    RAISE EXCEPTION 'Smoke test incorrectly generated verified evidence';
  END IF;

  BEGIN
    UPDATE bdp_regulatory_evidence_events SET notes = 'tampered' WHERE id = event_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    blocked_update := TRUE;
  END;
  IF NOT blocked_update THEN
    RAISE EXCEPTION 'Append-only UPDATE guard failed';
  END IF;

  BEGIN
    DELETE FROM bdp_regulatory_evidence_events WHERE id = event_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    blocked_delete := TRUE;
  END;
  IF NOT blocked_delete THEN
    RAISE EXCEPTION 'Append-only DELETE guard failed';
  END IF;

  BEGIN
    INSERT INTO bdp_regulatory_evidence_events
      (county_fips, parcel_id, task_id, event_type, notes, entered_by, verification_state)
    VALUES
      ('48453', 'bdp-smoke-fixture', 'verify-zoning-designation',
       'review-note', 'Should fail', 'bdp-test', 'verified');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    blocked_verified := TRUE;
  END;
  IF NOT blocked_verified THEN
    RAISE EXCEPTION 'Evidence verification constraint failed';
  END IF;

  RAISE NOTICE 'BDP evidence ledger transaction smoke checks passed: insert unverified; block UPDATE; block DELETE; block verified state.';
END;
$smoke$;

ROLLBACK;
