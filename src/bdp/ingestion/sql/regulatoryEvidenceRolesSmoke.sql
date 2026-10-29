-- Step 46 trusted-local role privilege regression. Requires the Step 41
-- evidence table and Step 46 roles migration, run as a role administrator.
-- BEGIN ... ROLLBACK ensures the synthetic journal event never persists.
-- This test intentionally uses SET LOCAL ROLE to evaluate NOLOGIN grants.
BEGIN;

DO $privileges$
BEGIN
  IF NOT pg_catalog.has_column_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'parcel_id', 'SELECT')
    OR NOT pg_catalog.has_column_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'verification_state', 'SELECT') THEN
    RAISE EXCEPTION 'Reader is missing allowed metadata SELECT';
  END IF;
  IF pg_catalog.has_column_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'notes', 'SELECT')
    OR pg_catalog.has_column_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'entered_by', 'SELECT')
    OR pg_catalog.has_column_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'source_url', 'SELECT') THEN
    RAISE EXCEPTION 'Reader can inspect private notes, identity or source URL';
  END IF;
  IF pg_catalog.has_table_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'INSERT')
    OR pg_catalog.has_table_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'UPDATE')
    OR pg_catalog.has_table_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'DELETE')
    OR pg_catalog.has_function_privilege('bdp_evidence_reader',
      'public.bdp_evidence_append_unverified(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Reader has forbidden write/function permission';
  END IF;
  IF pg_catalog.has_any_column_privilege('bdp_evidence_appender',
      'public.bdp_regulatory_evidence_events', 'SELECT')
    OR pg_catalog.has_table_privilege('bdp_evidence_appender',
      'public.bdp_regulatory_evidence_events', 'INSERT')
    OR pg_catalog.has_table_privilege('bdp_evidence_appender',
      'public.bdp_regulatory_evidence_events', 'UPDATE')
    OR pg_catalog.has_table_privilege('bdp_evidence_appender',
      'public.bdp_regulatory_evidence_events', 'DELETE') THEN
    RAISE EXCEPTION 'Appender has direct table access';
  END IF;
  IF NOT pg_catalog.has_function_privilege('bdp_evidence_appender',
      'public.bdp_evidence_append_unverified(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Appender cannot invoke restricted unverified RPC';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname IN ('bdp_evidence_reader', 'bdp_evidence_appender') AND rolcanlogin) THEN
    RAISE EXCEPTION 'Evidence group roles must be NOLOGIN';
  END IF;
  RAISE NOTICE 'BDP least-privilege metadata and RPC grant checks passed';
END;
$privileges$;

SET LOCAL ROLE bdp_evidence_appender;

-- This function executes using its DEFINER's narrow, fixed SQL path.
-- No user-provided SQL expression is executed by the function.
SELECT public.bdp_evidence_append_unverified(
  '{"countyFips":"48453","parcelId":"bdp-security-smoke-fixture",
  "taskId":"verify-zoning-designation","eventType":"review-note",
  "sourceUrl":null,"sourceTitle":null,"sourceDate":null,
  "sourceSha256":null,"notes":"Synthetic local security test, no real zoning evidence.",
  "enteredBy":"bdp-smoke-test"}'::jsonb
);

RESET ROLE;

SET LOCAL ROLE bdp_evidence_reader;
-- Reader can see only index metadata. Does not get notes/source URL.
SELECT count(*) AS local_synthetic_events
FROM public.bdp_regulatory_evidence_events
WHERE county_fips = '48453' AND parcel_id = 'bdp-security-smoke-fixture';
RESET ROLE;

ROLLBACK;
