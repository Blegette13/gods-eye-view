import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import {
  PARCEL_GEOMETRY_SNAPSHOT_SQL,
  buildParcelGeometrySnapshotStatement,
  stageParcelGeometrySnapshot,
} from './parcelGeometrySnapshotPlan.js';

const NOW = 1_000_000;
const SHA = 'a'.repeat(64);
const plan = (limit = 2) => parseBoundedParcelPageRequest({
  countyFips: '48453', bounds: {
    west: -97.76, south: 30.24, east: -97.73, north: 30.27,
  }, limit,
});
const source = () => ({
  sourceId: 'travis-cad', countyFips: '48453',
  rightsState: 'approved', approvedCachingUntilMs: NOW + 400_000,
});
const rights = () => ({
  sourceId: 'travis-cad', countyFips: '48453',
  reviewState: 'approved', reviewReference: 'review/synthetic',
  reviewedAtMs: NOW - 10_000, expiresAtMs: NOW + 300_000,
  allowGeometryRedistribution: true,
});
const polygon = () => ({
  type: 'MultiPolygon',
  coordinates: [[[[-97.75,30.25],[-97.74,30.25],[-97.74,30.26],
    [-97.75,30.26],[-97.75,30.25]]]],
});
const row = (id, geometry = polygon()) => ({
  parcel_version_id: '100',
  source_parcel_id: id,
  source_version: 'synthetic-v1', source_geometry_sha256: SHA,
  ingest_run_id: '42', source_id: 'travis-cad', county_fips: '48453',
  geometry_vertices: 5, geometry_memory_bytes: 240,
  geometry, owner_name: 'NEVER EXPOSE', appraisal: 9999999,
});
const args = () => ({
  plan: plan(), rows: [row('FAKE-PARCEL-001')],
  trustedSource: source(), trustedRunId: 42,
  trustedPublicationRights: rights(), nowMs: NOW,
});
const unavailable = { ok: false, reason: 'unavailable', publishAuthorized: false };

test('fixed geometry SQL accepts ONLY the canonical 8 bounded query parameters', () => {
  const statement = buildParcelGeometrySnapshotStatement({
    plan: plan(), trustedSourceId: 'travis-cad', trustedRunId: 42,
  });
  assert.equal(statement.text, PARCEL_GEOMETRY_SNAPSHOT_SQL);
  assert.deepEqual(statement.values, [
    '48453','travis-cad',42,-97.76,30.24,-97.73,30.27,3,
  ]);
  assert.ok(Object.isFrozen(statement));
  assert.ok(Object.isFrozen(statement.values));
  assert.equal(new Set(statement.text.match(/\$[1-8]::/g)).size,8);
  assert.doesNotMatch(statement.text,/FAKE-PARCEL-001|travis-cad|synthetic-v1/);
});

test('SQL rejects unapproved publication reviews even if caching was authorized', () => {
  const sql=PARCEL_GEOMETRY_SNAPSHOT_SQL;
  assert.match(sql,/JOIN bdp_parcel_index\.geometry_publication_reviews AS rights/);
  assert.match(sql,/rights\.review_state = 'approved'/);
  assert.match(sql,/rights\.allow_geometry_redistribution = TRUE/);
  assert.match(sql,/rights\.expires_at > pg_catalog\.clock_timestamp\(\)/);
  assert.match(sql,/rights\.expires_at <= sr\.approved_caching_until/);
  assert.match(sql,/sr\.rights_state = 'approved'/);
  assert.match(sql,/sr\.approved_caching_until > pg_catalog\.clock_timestamp\(\)/);
  assert.match(sql,/ir\.id = \$3::bigint/);
  assert.match(sql,/ir\.outcome IN \('complete', 'partial'\)/);
  assert.match(sql,/public\.ST_Intersects\(/);
  assert.match(sql,/LIMIT \$8::integer/);
  assert.doesNotMatch(sql,/\b(COPY|UPDATE|DELETE|INSERT|GRANT|EXECUTE|DROP)\b/i);
});

test('separate review table is deny-by-default and gives no read or public grants', () => {
  const sql = readFileSync(new URL('./sql/parcelGeometryPublicationRightsFoundation.sql',
    import.meta.url), 'utf8');
  assert.match(sql,/review_state text NOT NULL DEFAULT 'unreviewed'/);
  assert.match(sql,/allow_geometry_redistribution boolean NOT NULL DEFAULT FALSE/);
  assert.match(sql,/geometry_publication_approval_requires_evidence/);
  assert.match(sql,/REVOKE ALL ON TABLE bdp_parcel_index\.geometry_publication_reviews FROM PUBLIC/);
  assert.match(sql,/REVOKE ALL ON TABLE bdp_parcel_index\.geometry_publication_reviews FROM ldos_parcel_rpc_client/);
  // Comments may discuss grants; disallow a SQL GRANT statement itself.
  assert.doesNotMatch(sql,/^\s*GRANT\s/mi);
});

test('single query serializes an unpublished, sanitized map candidate only', () => {
  const result = stageParcelGeometrySnapshot(args());
  assert.equal(result.ok,true);
  assert.equal(result.publishAuthorized,false);
  assert.equal(result.viewportCoverage,'unknown');
  assert.equal(result.featureCount,1);
  const parsed = JSON.parse(result.candidateGeoJson);
  assert.deepEqual(parsed,{type:'FeatureCollection',features:[{
    type:'Feature',id:'FAKE-PARCEL-001',
    properties:{sourceParcelId:'FAKE-PARCEL-001'},
    geometry:polygon(),
  }]});
  assert.doesNotMatch(result.candidateGeoJson,/NEVER EXPOSE|appraisal|9999999/);
});

test('overflow sentinel is NEVER serialized and must carry null geometry', () => {
  const good=stageParcelGeometrySnapshot({
    ...args(), rows:[row('001'),row('002'),row('003',null)],
  });
  assert.equal(good.ok,true);
  assert.equal(good.overflow,true);
  assert.equal(good.featureCount,2);
  assert.equal(good.publishAuthorized,false);
  assert.ok(!good.candidateGeoJson.includes('003'));
  assert.deepEqual(stageParcelGeometrySnapshot({
    ...args(), rows:[row('001'),row('002'),row('003')],
  }),unavailable);
});

test('oversized feature sentinel, mismatched county/source and bad geometry fail closed', () => {
  for(const bad of [
    {...row('001'), geometry:null, geometry_vertices:8001},
    {...row('001'), geometry:null, geometry_memory_bytes:524289},
    {...row('001'), source_id:'other-source'},
    {...row('001'), county_fips:'48029'},
    {...row('001'), source_geometry_sha256:'b'.repeat(64),
      geometry:{type:'Point',coordinates:[-97.75,30.25]}},
    {...row('001'), ingest_run_id:'43'},
  ]){
    assert.deepEqual(stageParcelGeometrySnapshot({...args(),rows:[bad]}),unavailable);
  }
});

test('missing redistribution review or expired caching cannot stage geometry', () => {
  assert.deepEqual(stageParcelGeometrySnapshot({
    ...args(), trustedPublicationRights:null,
  }),unavailable);
  assert.deepEqual(stageParcelGeometrySnapshot({
    ...args(), trustedPublicationRights:{...rights(),allowGeometryRedistribution:false},
  }),unavailable);
  assert.deepEqual(stageParcelGeometrySnapshot({
    ...args(),trustedSource:{...source(),approvedCachingUntilMs:NOW},
  }),unavailable);
});

test('forged plan, unsafe source/run and oversized result fail before staging', () => {
  for(const p of [
    null,{...plan(),probeLimit:999},{...plan(),limit:300},
    {...plan(),bounds:{west:-98,south:30,east:-97,north:31}},
  ]) assert.equal(buildParcelGeometrySnapshotStatement({
    plan:p,trustedSourceId:'travis-cad',trustedRunId:42,
  }),null);
  for(const trustedRunId of ['42',0,1.1]){
    assert.equal(buildParcelGeometrySnapshotStatement({
      plan:plan(),trustedSourceId:'travis-cad',trustedRunId,
    }),null);
  }
  assert.equal(buildParcelGeometrySnapshotStatement({
    plan:plan(),trustedSourceId:"travis';DROP TABLE",trustedRunId:42,
  }),null);
  assert.deepEqual(stageParcelGeometrySnapshot({
    ...args(),rows:[row('001'),row('002'),row('003'),row('004')],
  }),unavailable);
});

test('zero records do not assert complete coverage or publication', () => {
  const result = stageParcelGeometrySnapshot({...args(),rows:[]});
  assert.equal(result.ok,true);
  assert.equal(result.featureCount,0);
  assert.equal(result.viewportCoverage,'unknown');
  assert.equal(result.publishAuthorized,false);
});
