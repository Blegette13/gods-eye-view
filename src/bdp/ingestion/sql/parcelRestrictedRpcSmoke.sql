-- Step 40C-9 disposable PostGIS smoke. Synthetic fixtures only; ROLLBACK.
-- Apply after parcelIndexFoundation.sql and parcelRestrictedRpcFoundation.sql.
BEGIN;

INSERT INTO bdp_parcel_index.source_registry
  (source_id, county_fips, source_url, attribution, rights_state,
   rights_review_reference, rights_reviewed_at, approved_caching_until)
VALUES ('step40c9-test', '48453', 'https://example.invalid/synthetic',
  'Synthetic verification fixture only', 'approved',
  'DISPOSABLE TEST ONLY', clock_timestamp()-interval '1 day',
  clock_timestamp()+interval '1 day');

INSERT INTO bdp_parcel_index.ingest_runs
  (source_id, source_version, outcome, finished_at, received_records,
   omitted_unidentified, source_reported_truncated, observed_envelope)
VALUES ('step40c9-test', 'test-v1', 'complete', clock_timestamp(),
  1,0,FALSE,public.ST_MakeEnvelope(-98,30,-97,31,4326));

INSERT INTO bdp_parcel_index.parcel_versions
  (ingest_run_id, source_id, county_fips, source_parcel_id, source_version,
   received_at, source_geometry_sha256, geometry)
SELECT id, source_id, '48453', 'TEST-ONLY', source_version,
  clock_timestamp(), repeat('a',64),
  public.ST_Multi(public.ST_MakeEnvelope(-97.75,30.25,-97.74,30.26,4326))
FROM bdp_parcel_index.ingest_runs
WHERE source_id='step40c9-test';

DO $ldos_rpc_smoke$
DECLARE
  v_count integer;
  v_run bigint;
BEGIN
  IF has_table_privilege('ldos_parcel_rpc_client',
       'bdp_parcel_index.source_registry', 'SELECT')
     OR has_table_privilege('ldos_parcel_rpc_client',
       'bdp_parcel_index.ingest_runs', 'SELECT')
     OR has_table_privilege('ldos_parcel_rpc_client',
       'bdp_parcel_index.parcel_versions', 'SELECT')
     OR has_table_privilege('ldos_parcel_rpc_client',
       'bdp_parcel_index.coverage_windows', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: restricted reader has raw table privileges';
  END IF;

  IF NOT has_function_privilege('ldos_parcel_rpc_client',
       'bdp_parcel_index.approved_sources_rpc(text)', 'EXECUTE')
    OR NOT has_function_privilege('ldos_parcel_rpc_client',
       'bdp_parcel_index.parcel_viewport_probe_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: restricted reader lacks fixed RPC grants';
  END IF;

  SELECT count(*), max(run_id) INTO v_count,v_run
  FROM bdp_parcel_index.approved_sources_rpc('48453');
  IF v_count<>1 OR v_run IS NULL THEN
    RAISE EXCEPTION 'FAIL: approved synthetic run not found';
  END IF;
  SELECT count(*) INTO v_count
  FROM bdp_parcel_index.parcel_viewport_probe_rpc(
    '48453','step40c9-test',v_run,-97.8,30.2,-97.7,30.3,201);
  IF v_count<>1 THEN
    RAISE EXCEPTION 'FAIL: bounded spatial query mismatch';
  END IF;
  SELECT count(*) INTO v_count
  FROM bdp_parcel_index.parcel_viewport_probe_rpc(
    '48453','step40c9-test',v_run,-97.8,30.2,-97.6,30.3,201);
  IF v_count<>0 THEN
    RAISE EXCEPTION 'FAIL: overlarge extent returned records';
  END IF;
  SELECT count(*) INTO v_count
  FROM bdp_parcel_index.parcel_viewport_probe_rpc(
    '48029','step40c9-test',v_run,-97.8,30.2,-97.7,30.3,201);
  IF v_count<>0 THEN
    RAISE EXCEPTION 'FAIL: wrong county returned records';
  END IF;
  RAISE NOTICE 'PASS: function grants, denied raw table grants and bounded synthetic geometry';
END;
$ldos_rpc_smoke$;

UPDATE bdp_parcel_index.source_registry SET rights_state='revoked'
WHERE source_id='step40c9-test';

DO $ldos_revoke$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM bdp_parcel_index.approved_sources_rpc('48453');
  IF v_count<>0 THEN
    RAISE EXCEPTION 'FAIL: revoked source still available';
  END IF;
  RAISE NOTICE 'PASS: source revocation hides registry response';
END;
$ldos_revoke$;

ROLLBACK;
