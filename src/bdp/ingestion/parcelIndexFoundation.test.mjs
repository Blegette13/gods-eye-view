import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('./sql/parcelIndexFoundation.sql', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('./sql/parcelIndexFoundationSmoke.sql', import.meta.url), 'utf8');

test('index cannot be publicly browsed or accidentally act as an ingestion endpoint',()=>{
  assert.match(schema,/REVOKE ALL ON SCHEMA bdp_parcel_index FROM PUBLIC;/);
  assert.match(schema,/REVOKE ALL ON ALL TABLES IN SCHEMA bdp_parcel_index FROM PUBLIC;/);
  assert.match(schema,/REVOKE ALL ON ALL SEQUENCES IN SCHEMA bdp_parcel_index FROM PUBLIC;/);
  assert.match(schema,/REVOKE ALL ON FUNCTION bdp_parcel_index\.guard_source_write\(\) FROM PUBLIC;/);
  assert.doesNotMatch(schema,/\bGRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|EXECUTE|USAGE|ALL)\s+[^;]*\bTO\s+(?:PUBLIC|bdp_evidence_reader|bdp_evidence_appender)\s*;/i);
  assert.doesNotMatch(schema,/\b(?:COPY\s+\w+\s+FROM|http_get\s*\(|dblink_connect\s*\()\b/i);
});

test('source registry defaults unreviewed and approval requires explicit time-limited evidence',()=>{
  assert.match(schema,/rights_state TEXT NOT NULL DEFAULT 'unreviewed'/);
  assert.match(schema,/source_rights_approval_requires_evidence CHECK/);
  assert.match(schema,/rights_review_reference IS NOT NULL/);
  assert.match(schema,/approved_caching_until > rights_reviewed_at/);
  assert.match(schema,/v_rights_expiry <= clock_timestamp\(\)/);
  assert.match(schema,/v_rights_state IS DISTINCT FROM 'approved'/);
  assert.match(schema,/source_rights_guard_ingest_runs/);
  assert.match(schema,/source_rights_guard_parcel_versions/);
  assert.match(schema,/source_rights_guard_coverage_windows/);
});

test('versioned source geometry and bounded coverage keep immutable source identity',()=>{
  for(const name of ['source_registry','ingest_runs','parcel_versions','coverage_windows']) {
    assert.match(schema,new RegExp('CREATE TABLE IF NOT EXISTS bdp_parcel_index\\.'+name+'\\b'));
  }
  assert.match(schema,/county_fips CHAR\(5\)/);
  assert.match(schema,/parcel_version_unique_source UNIQUE/);
  assert.match(schema,/source_parcel_id TEXT NOT NULL/);
  assert.match(schema,/source_geometry_sha256 TEXT NOT NULL/);
  assert.match(schema,/geometry geometry\(MultiPolygon,4326\) NOT NULL/);
  assert.match(schema,/ST_IsValid\(geometry\) AND NOT ST_IsEmpty\(geometry\)/);
  assert.match(schema,/USING GIST \(geometry\)/);
  assert.match(schema,/USING GIST \(window_geometry\)/);
  assert.match(schema,/complete_window_must_have_source_evidence CHECK/);
  assert.match(schema,/source_truncated = FALSE/);
  assert.match(schema,/omitted_unidentified = 0/);
  assert.match(schema,/NEW\.county_fips IS DISTINCT FROM v_county/);
  assert.match(schema,/v_run_version IS DISTINCT FROM NEW\.source_version/);
  assert.match(schema,/v_run_outcome <> 'complete'/);
});

test('manual database smoke rolls back and exercises revocation, incompleteness and county boundaries',()=>{
  assert.match(smoke,/^BEGIN;/m);
  assert.match(smoke,/^ROLLBACK;/m);
  assert.match(smoke,/Unreviewed source was admitted/);
  assert.match(smoke,/Cross-county source parcel accepted/);
  assert.match(smoke,/Truncated GIS query certified complete/);
  assert.match(smoke,/Revoked source accepted more parcel geometries/);
  assert.doesNotMatch(smoke,/\bGRANT\s+/i);
});
