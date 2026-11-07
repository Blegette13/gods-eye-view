import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import { validatePrivateSealedGeometryPage } from './parcelSealedGeometryPageValidator.js';

const NOW = 1_000_000;
const SHA = 'a'.repeat(64);
const plan = () => parseBoundedParcelPageRequest({
  countyFips: '48453', limit: 2,
  bounds: { west: -97.76, south: 30.24, east: -97.73, north: 30.27 },
});
const polygon = () => ({
  type: 'MultiPolygon',
  coordinates: [[[[-97.75,30.25],[-97.74,30.25],[-97.74,30.26],
    [-97.75,30.26],[-97.75,30.25]]]],
});
const row = (id, versionId, geometry = polygon()) => ({
  parcel_version_id: versionId,
  source_parcel_id: id,
  source_version: 'synthetic-v1', source_geometry_sha256: SHA,
  ingest_run_id: '42', source_id: 'travis-cad', county_fips: '48453',
  geometry_vertices: 5, geometry_memory_bytes: 240, geometry,
});
const source = () => ({
  sourceId:'travis-cad', countyFips:'48453', rightsState:'approved',
  approvedCachingUntilMs:NOW + 400_000,
});
const rights = () => ({
  sourceId:'travis-cad', countyFips:'48453', reviewState:'approved',
  reviewReference:'synthetic/review/2026', allowGeometryRedistribution:true,
  reviewedAtMs:NOW - 10_000, expiresAtMs:NOW + 300_000,
});
const input = () => ({
  plan:plan(), rows:[row('P-001','1'),row('P-002','2'),row('P-003','3',null)],
  trustedSource:source(), trustedRunId:42, trustedPublicationRights:rights(),
  nowMs:NOW,
});
const denied = {
  status:'unavailable',publishAuthorized:false,
  viewportCoverage:'unknown',geometryDelivered:false,
};

test('valid sealed SQL page stages private only, without coverage or publication authority', () => {
  const result=validatePrivateSealedGeometryPage(input());
  assert.equal(result.status,'validated-private');
  assert.equal(result.featureCount,2);
  assert.equal(result.overflow,true);
  assert.equal(result.viewportCoverage,'unknown');
  assert.equal(result.publishAuthorized,false);
  assert.equal(result.geometryDelivered,false);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(JSON.parse(result.candidateGeoJson), {
    type:'FeatureCollection',features:[
      {type:'Feature',id:'P-001',properties:{sourceParcelId:'P-001'},geometry:polygon()},
      {type:'Feature',id:'P-002',properties:{sourceParcelId:'P-002'},geometry:polygon()},
    ],
  });
  assert.equal(result.candidateGeoJson.includes('P-003'),false);
});

test('missing, wrong-county, expired or unreviewed geometry-publication rights deny page', () => {
  for (const bad of [
    null,undefined,{...rights(),allowGeometryRedistribution:false},
    {...rights(),reviewState:'unreviewed'},
    {...rights(),expiresAtMs:NOW},
    {...rights(),countyFips:'48029'},
    {...rights(),reviewReference:''},
  ]) assert.deepEqual(validatePrivateSealedGeometryPage({
    ...input(),trustedPublicationRights:bad,
  }),denied);
});

test('source caching rights are independently necessary on every page', () => {
  for (const sourceChange of [
    {rightsState:'unreviewed'},{rightsState:'revoked'},
    {approvedCachingUntilMs:NOW},{countyFips:'48029'},
    {sourceId:'not-travis'},
  ]) assert.deepEqual(validatePrivateSealedGeometryPage({
    ...input(),trustedSource:{...source(),...sourceChange},
  }),denied);
});

test('all returned database rows, including overflow, must match exact ten-column allowlist', () => {
  for (const change of [
    { owner_name:'PRIVATE' }, {estimated_sale_price:9999},
    { source_id:'another-cad' }, { county_fips:'48029' },
    { ingest_run_id:'43' },{ ingest_run_id:'42.0' },
    { source_version:'different-run-version' },
    { parcel_version_id:'2e0' },{parcel_version_id:'9223372036854775808'},
  ]) {
    const q=input();q.rows[2]={...q.rows[2],...change};
    assert.deepEqual(validatePrivateSealedGeometryPage(q),denied);
  }
});

test('overflow sentinel must be last, null geometry, and never included in candidate', () => {
  const q=input();
  q.rows[2].geometry=polygon();
  assert.deepEqual(validatePrivateSealedGeometryPage(q),denied);
  const v=validatePrivateSealedGeometryPage({...input(),rows:input().rows.slice(0,2)});
  assert.equal(v.status,'validated-private');
  assert.equal(v.overflow,false);
  assert.equal(v.featureCount,2);
});

test('keyset order is strict and numeric BIGINT positions are compared correctly', () => {
  // The existing source-window budget intentionally rejects duplicate
  // parcel names even if different version IDs could sort numerically.
  const good=input();
  good.rows=[
    row('P-001','10'),
    row('P-002','11'),
    row('P-003','12',null),
  ];
  const ok=validatePrivateSealedGeometryPage({
    ...good,afterKey:{sourceParcelId:'P-001',parcelVersionId:'9'},
  });
  assert.equal(ok.status,'validated-private');
  assert.deepEqual(validatePrivateSealedGeometryPage({
    ...good,afterKey:{sourceParcelId:'P-001',parcelVersionId:'11'},
  }),denied);
  for (const ids of [
    [row('P-002','2'),row('P-001','1'),row('P-003','3',null)],
    [row('SAME-ID','9'),row('SAME-ID','10'),row('P-003','11',null)],
    [row('P-001','1'),row('P-001','1'),row('P-003','3',null)],
  ]) assert.deepEqual(validatePrivateSealedGeometryPage({...input(),rows:ids}),denied);
});

test('continuation afterKey is explicitly checked against first returned row', () => {
  const position={sourceParcelId:'P-000',parcelVersionId:'99'};
  assert.equal(validatePrivateSealedGeometryPage({...input(),afterKey:position}).status,
    'validated-private');
  for (const bad of [
    {sourceParcelId:'P-001',parcelVersionId:'1'},
    {sourceParcelId:'P-003',parcelVersionId:'3'},
    {sourceParcelId:'P-000',parcelVersionId:1},
    {sourceParcelId:'P-000',parcelVersionId:'0'},
    {sourceParcelId:'P-000',parcelVersionId:'0001'},
    {sourceParcelId:'P-000',parcelVersionId:'9223372036854775808'},
    {sourceParcelId:'P-000',parcelVersionId:'1',role:'admin'},
    {sourceParcelId:"';DROP TABLE",parcelVersionId:'1'},
  ]) assert.deepEqual(validatePrivateSealedGeometryPage({
    ...input(),afterKey:bad,
  }),denied);
});

test('invalid page plans, unknown county, malformed budgets and unbounded extents deny', () => {
  const initial=plan();
  for (const altered of [
    null, {...initial,probeLimit:10},{...initial,limit:201},
    {...initial,countyFips:'06037'},
    {...initial,bounds:{...initial.bounds,east:-96.5}},
    {...initial,bounds:{...initial.bounds,sql:'DROP'}},
    {...initial,sourceId:'attacker'},
  ]) assert.deepEqual(validatePrivateSealedGeometryPage({
    ...input(),plan:altered,
  }),denied);
});

test('untrusted/null/missing geometry is never silently dropped from a valid page', () => {
  for (const invalid of [
    null, {type:'Point',coordinates:[-97.75,30.25]},
    {type:'MultiPolygon',coordinates:[]},
    {type:'MultiPolygon',coordinates:[[[[-97,30],[-97,31],[-97,32]]]]},
  ]) {
    const q=input();q.rows[0].geometry=invalid;
    assert.deepEqual(validatePrivateSealedGeometryPage(q),denied);
  }
});

test('per-feature vertex, page and wire budgets still use existing geometry validator', () => {
  const q=input();q.rows[0].geometry_vertices=8001;
  assert.deepEqual(validatePrivateSealedGeometryPage(q),denied);
  const q2=input();q2.rows[1].geometry_memory_bytes=524289;
  assert.deepEqual(validatePrivateSealedGeometryPage(q2),denied);
  const q3=input();q3.rows[0].geometry_vertices=4;
  assert.deepEqual(validatePrivateSealedGeometryPage(q3),denied);
});

test('empty SQL page is UNKNOWN and private, not a verified empty/clear county', () => {
  const got=validatePrivateSealedGeometryPage({...input(),rows:[]});
  assert.equal(got.status,'validated-private');
  assert.equal(got.featureCount,0);
  assert.equal(got.overflow,false);
  assert.equal(got.publishAuthorized,false);
  assert.equal(got.viewportCoverage,'unknown');
  assert.deepEqual(JSON.parse(got.candidateGeoJson),{
    type:'FeatureCollection',features:[],
  });
});

test('unsafe trust values and oversized results fail without staging any polygons', () => {
  const q=input();
  for (const trustedRunId of [0,'42',-1,9_007_199_254_740_992]) {
    assert.deepEqual(validatePrivateSealedGeometryPage({...q,trustedRunId}),denied);
  }
  for (const nowMs of [0,'1000000',Number.NaN]) {
    assert.deepEqual(validatePrivateSealedGeometryPage({...q,nowMs}),denied);
  }
  assert.deepEqual(validatePrivateSealedGeometryPage({
    ...q,rows:[...q.rows,row('P-004','4',null)],
  }),denied);
});

test('module does not create a transport, database role, permission grant or map overlay', () => {
  const code=readFileSync(new URL('./parcelSealedGeometryPageValidator.js',
    import.meta.url),'utf8');
  assert.doesNotMatch(code, /createServer\(|\.listen\(|new Pool\(|fetch\(|GRANT EXECUTE/);
  assert.match(code, /PRIVATE ONLY/);
  assert.match(code, /stageParcelGeometrySnapshot/);
  assert.match(code, /viewportCoverage: 'unknown'/);
  assert.match(code, /publishAuthorized: false/);
});
