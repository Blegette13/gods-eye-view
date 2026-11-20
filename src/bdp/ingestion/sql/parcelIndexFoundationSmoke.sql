-- Transactional manual smoke test for parcelIndexFoundation.sql.
-- REQUIRES prior review/application of parcelIndexFoundation.sql and PostGIS.
-- Runs only against the user's trusted local test database. ALL test rows
-- ROLLBACK; it never fetches county GIS, creates login roles, or imports data.
BEGIN;

DO $smoke$
DECLARE
  v_run BIGINT;
  v_partial_run BIGINT;
  v_geom geometry(MultiPolygon,4326);
BEGIN
  v_geom := ST_Multi(ST_GeomFromText(
    'POLYGON((-97.75 30.25,-97.74 30.25,-97.74 30.26,-97.75 30.25))',
    4326
  ));
  INSERT INTO bdp_parcel_index.source_registry
    (source_id,county_fips,source_url,attribution)
  VALUES ('step40b-local-test','48453','https://example.invalid/test',
    'LOCAL TEST ONLY; NO EXTERNAL COUNTY SOURCE');

  -- Neither an unreviewed source nor a public GIS URL is a storage grant.
  BEGIN
    INSERT INTO bdp_parcel_index.ingest_runs(source_id,source_version)
      VALUES ('step40b-local-test','test-v1');
    RAISE EXCEPTION 'FAIL: Unreviewed source was admitted';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  UPDATE bdp_parcel_index.source_registry
  SET rights_state='approved',
      rights_review_reference='LOCAL TEST ONLY - NOT REAL DATA RIGHTS',
      rights_reviewed_at=clock_timestamp()-interval '1 day',
      approved_caching_until=clock_timestamp()+interval '1 day'
  WHERE source_id='step40b-local-test';

  INSERT INTO bdp_parcel_index.ingest_runs
    (source_id,source_version,outcome,finished_at,
     source_requests,received_records,omitted_unidentified,
     source_reported_truncated,observed_envelope)
  VALUES ('step40b-local-test','test-v1','complete',clock_timestamp(),
    1,1,0,FALSE,ST_MakeEnvelope(-97.8,30.2,-97.7,30.3,4326))
  RETURNING id INTO v_run;

  INSERT INTO bdp_parcel_index.parcel_versions
    (ingest_run_id,source_id,county_fips,source_parcel_id,source_version,
     received_at,source_geometry_sha256,geometry)
  VALUES (v_run,'step40b-local-test','48453','TEST-00001','test-v1',
    clock_timestamp(),repeat('a',64),v_geom);

  INSERT INTO bdp_parcel_index.coverage_windows
    (ingest_run_id,source_id,county_fips,window_key,window_geometry,
     coverage_state,received_records,omitted_unidentified,
     source_truncated,observed_at)
  VALUES (v_run,'step40b-local-test','48453','center-01',
    ST_MakeEnvelope(-97.8,30.2,-97.7,30.3,4326),
    'complete',1,0,FALSE,clock_timestamp());

  -- Both table-specific trigger branches must be independently safe.
  -- A version column belongs only to parcel_versions, and coverage_state
  -- belongs only to coverage_windows. Neither may be accessed on the other.
  BEGIN
    INSERT INTO bdp_parcel_index.parcel_versions
      (ingest_run_id,source_id,county_fips,source_parcel_id,source_version,
       received_at,source_geometry_sha256,geometry)
    VALUES (v_run,'step40b-local-test','48453','WRONG-VERSION','wrong-v2',
      clock_timestamp(),repeat('c',64),v_geom);
    RAISE EXCEPTION 'FAIL: Parcel with mismatched source version accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  INSERT INTO bdp_parcel_index.ingest_runs
    (source_id,source_version,outcome,finished_at,source_requests,
     received_records,omitted_unidentified,source_reported_truncated,
     observed_envelope)
  VALUES ('step40b-local-test','partial-test-v1','partial',clock_timestamp(),
    1,1,0,TRUE,ST_MakeEnvelope(-97.8,30.2,-97.7,30.3,4326))
  RETURNING id INTO v_partial_run;

  INSERT INTO bdp_parcel_index.coverage_windows
    (ingest_run_id,source_id,county_fips,window_key,window_geometry,
     coverage_state,received_records,omitted_unidentified,source_truncated,observed_at)
  VALUES (v_partial_run,'step40b-local-test','48453','partial-ok',
    ST_MakeEnvelope(-97.8,30.2,-97.7,30.3,4326),
    'partial',1,0,TRUE,clock_timestamp());

  BEGIN
    INSERT INTO bdp_parcel_index.coverage_windows
      (ingest_run_id,source_id,county_fips,window_key,window_geometry,
       coverage_state,received_records,omitted_unidentified,source_truncated,observed_at)
    VALUES (v_partial_run,'step40b-local-test','48453','false-complete',
      ST_MakeEnvelope(-97.8,30.2,-97.7,30.3,4326),
      'complete',1,0,FALSE,clock_timestamp());
    RAISE EXCEPTION 'FAIL: Incomplete ingestion run certified complete';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  BEGIN
    INSERT INTO bdp_parcel_index.parcel_versions
      (ingest_run_id,source_id,county_fips,source_parcel_id,source_version,
       received_at,source_geometry_sha256,geometry)
    VALUES (v_run,'step40b-local-test','48029','BAD-COUNTY','test-v1',
      clock_timestamp(),repeat('a',64),v_geom);
    RAISE EXCEPTION 'FAIL: Cross-county source parcel accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  BEGIN
    INSERT INTO bdp_parcel_index.coverage_windows
      (ingest_run_id,source_id,county_fips,window_key,window_geometry,
       coverage_state,received_records,omitted_unidentified,
       source_truncated,observed_at)
    VALUES (v_run,'step40b-local-test','48453','bad-completeness',
      ST_MakeEnvelope(-97.8,30.2,-97.7,30.3,4326),
      'complete',1,0,TRUE,clock_timestamp());
    RAISE EXCEPTION 'FAIL: Truncated GIS query certified complete';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  UPDATE bdp_parcel_index.source_registry
  SET rights_state='revoked'
  WHERE source_id='step40b-local-test';

  BEGIN
    INSERT INTO bdp_parcel_index.parcel_versions
      (ingest_run_id,source_id,county_fips,source_parcel_id,source_version,
       received_at,source_geometry_sha256,geometry)
    VALUES (v_run,'step40b-local-test','48453','REVOKED-PARCEL','test-v1',
      clock_timestamp(),repeat('b',64),v_geom);
    RAISE EXCEPTION 'FAIL: Revoked source accepted more parcel geometries';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  RAISE NOTICE 'PASS: rights, row-type safe trigger branches, source version, partial-run coverage, county isolation, valid PostGIS geometry and truncation guards';
END;
$smoke$;

ROLLBACK;
