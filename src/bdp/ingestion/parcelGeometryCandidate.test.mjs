import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import { stageParcelGeometryCandidate } from './parcelGeometryCandidate.js';

const NOW = 1_000_000;
const HASH = 'a'.repeat(64);
const polygon = () => ({
  type: 'MultiPolygon',
  coordinates: [[[[-97.75, 30.25], [-97.74, 30.25],
    [-97.74, 30.26], [-97.75, 30.26], [-97.75, 30.25]]]],
});
const plan = (limit = 2) => parseBoundedParcelPageRequest({
  countyFips: '48453',
  bounds: { west: -97.76, south: 30.24, east: -97.73, north: 30.27 },
  limit,
});
const source = () => ({
  sourceId: 'travis-cad',
  countyFips: '48453',
  rightsState: 'approved',
  approvedCachingUntilMs: NOW + 400_000,
});
const review = () => ({
  sourceId: 'travis-cad', countyFips: '48453',
  reviewState: 'approved',
  reviewReference: 'review/2026-11',
  allowGeometryRedistribution: true,
  reviewedAtMs: NOW - 10_000,
  expiresAtMs: NOW + 300_000,
});
const metadata = (id) => ({
  source_parcel_id: id,
  source_version: 'synthetic-v1',
  source_geometry_sha256: HASH,
  ingest_run_id: '42', // node-postgres's PostgreSQL bigint (int8) default
  geometry_vertices: 5,
  geometry_memory_bytes: 240,
});
const geometryRow = (id) => ({
  source_parcel_id: id,
  source_version: 'synthetic-v1',
  source_geometry_sha256: HASH,
  ingest_run_id: '42',
  source_id: 'travis-cad',
  county_fips: '48453',
  geometry: polygon(),
  owner_name: 'PRIVATE — DO NOT COPY',
  source_url: 'NEVER LEAK',
});
const inputs = () => ({
  plan: plan(),
  metadataRows: [metadata('TEST-001')],
  geometryRows: [geometryRow('TEST-001')],
  trustedSource: source(),
  trustedPublicationRights: review(),
  trustedRunId: 42,
  nowMs: NOW,
});
const denied = { ok: false, reason: 'unavailable', publishAuthorized: false };

test('separately reviewed redistribution and caching rights stage only unpublished GeoJSON', () => {
  const answer = stageParcelGeometryCandidate(inputs());
  assert.equal(answer.ok, true);
  assert.equal(answer.publishAuthorized, false);
  assert.equal(answer.viewportCoverage, 'unknown');
  assert.equal(answer.featureCount, 1);
  assert.equal(answer.overflow, false);
  assert.equal(answer.bytes, Buffer.byteLength(answer.candidateGeoJson, 'utf8'));
  const parsed = JSON.parse(answer.candidateGeoJson);
  assert.deepEqual(Object.keys(parsed), ['type', 'features']);
  assert.deepEqual(parsed.features[0], {
    type: 'Feature', id: 'TEST-001',
    properties: { sourceParcelId: 'TEST-001' },
    geometry: polygon(),
  });
  assert.equal(answer.candidateGeoJson.includes('PRIVATE'), false);
  assert.equal(answer.candidateGeoJson.includes('NEVER LEAK'), false);
  assert.equal(answer.candidateGeoJson.includes(HASH), false);
});

test('valid index caching rights alone NEVER allow a geometry candidate', () => {
  const base = inputs();
  for (const rights of [
    undefined, null,
    { ...review(), allowGeometryRedistribution: false },
    { ...review(), allowGeometryRedistribution: 'true' },
    { ...review(), reviewState: 'unreviewed' },
    { ...review(), reviewReference: '' },
    { ...review(), expiresAtMs: NOW },
    { ...review(), reviewedAtMs: NOW + 1 },
    { ...review(), expiresAtMs: source().approvedCachingUntilMs + 1 },
    { ...review(), countyFips: '48029' },
    { ...review(), sourceId: 'other-cad' },
  ]) {
    assert.deepEqual(stageParcelGeometryCandidate({
      ...base, trustedPublicationRights: rights,
    }), denied);
  }
});

test('unapproved, expired, or county-mismatched source caching gate fails closed', () => {
  for (const modification of [
    { rightsState: 'unreviewed' },
    { rightsState: 'revoked' },
    { approvedCachingUntilMs: NOW },
    { countyFips: '48029' },
    { sourceId: 'other-cad' },
  ]) assert.deepEqual(stageParcelGeometryCandidate({
    ...inputs(), trustedSource: { ...source(), ...modification },
  }), denied);
});

test('source ID, run identity, version and indexed SHA must match each geometry row', () => {
  const changes = [
    { source_parcel_id: 'WRONG' },
    { source_version: 'synthetic-v2' },
    { source_geometry_sha256: 'b'.repeat(64) },
    { ingest_run_id: '43' },
    { ingest_run_id: 9_007_199_254_740_993n },
    { ingest_run_id: '9e2' },
    { source_id: 'other-cad' },
    { county_fips: '48029' },
  ];
  for (const change of changes) assert.deepEqual(stageParcelGeometryCandidate({
    ...inputs(), geometryRows: [{ ...geometryRow('TEST-001'), ...change }],
  }), denied);
  const badMetadata = { ...metadata('TEST-001'), source_geometry_sha256: 'invalid-hash' };
  assert.deepEqual(stageParcelGeometryCandidate({ ...inputs(), metadataRows: [badMetadata] }), denied);
});

test('only ordered and aligned geometry rows from the bounded probe are accepted', () => {
  const args = {
    ...inputs(),
    metadataRows: [metadata('TEST-001'), metadata('TEST-002')],
    geometryRows: [geometryRow('TEST-001'), geometryRow('TEST-002')],
  };
  const valid = stageParcelGeometryCandidate(args);
  assert.equal(valid.ok, true);
  assert.equal(valid.featureCount, 2);
  assert.deepEqual(stageParcelGeometryCandidate({
    ...args, geometryRows: args.geometryRows.slice().reverse(),
  }), denied);
  assert.deepEqual(stageParcelGeometryCandidate({
    ...args, geometryRows: args.geometryRows.slice(0, 1),
  }), denied);
  assert.deepEqual(stageParcelGeometryCandidate({
    ...args, geometryRows: [...args.geometryRows, geometryRow('TEST-003')],
  }), denied);
  assert.deepEqual(stageParcelGeometryCandidate({
    ...args, metadataRows: [metadata('TEST-001'), metadata('TEST-001')],
    geometryRows: [geometryRow('TEST-001'), geometryRow('TEST-001')],
  }), denied);
});

test('overflow probe row is never serialized, nor promoted to complete coverage', () => {
  const answer = stageParcelGeometryCandidate({
    ...inputs(), metadataRows: [
      metadata('TEST-001'), metadata('TEST-002'), metadata('TEST-PROBE-ONLY'),
    ], geometryRows: [geometryRow('TEST-001'), geometryRow('TEST-002')],
  });
  assert.equal(answer.ok, true);
  assert.equal(answer.featureCount, 2);
  assert.equal(answer.overflow, true);
  assert.equal(answer.viewportCoverage, 'unknown');
  assert.equal(answer.publishAuthorized, false);
  assert.ok(!answer.candidateGeoJson.includes('TEST-PROBE-ONLY'));
});

test('malformed coordinates and misreported index vertex budgets deny all delivery', () => {
  for (const badGeometry of [
    { type: 'Point', coordinates: [-97.7, 30.2] },
    { type: 'Polygon', coordinates: [[[-97.75,30.25],[-97.74,30.25],
      [-97.74,30.26],[-97.75,30.25,44]]] },
    { type: 'MultiPolygon', coordinates: [[[[-97.75, 30.25], [-97.74, 30.25],
      [-97.74, 30.26], [-97.75, 30.26], [-97.75, 30.27]]]] },
  ]) assert.deepEqual(stageParcelGeometryCandidate({
    ...inputs(), geometryRows: [{ ...geometryRow('TEST-001'), geometry: badGeometry }],
  }), denied);
  assert.deepEqual(stageParcelGeometryCandidate({
    ...inputs(), metadataRows: [{ ...metadata('TEST-001'), geometry_vertices: 999 }],
  }), denied);
});

test('invalid, unbounded, or forged page request never passes preparation', () => {
  const original = inputs();
  for (const p of [
    null,
    { ...plan(), probeLimit: 9 },
    { ...plan(), limit: 201 },
    { ...plan(), bounds: { west: -98, south: 30.2, east: -97.5, north: 30.3 } },
  ]) assert.deepEqual(stageParcelGeometryCandidate({ ...original, plan: p }), denied);
  assert.deepEqual(stageParcelGeometryCandidate({ ...original, trustedRunId: '42' }), denied);
  assert.deepEqual(stageParcelGeometryCandidate({ ...original, trustedRunId: 0 }), denied);
});

test('an empty queried page always remains unknown and unpublished', () => {
  const candidate = stageParcelGeometryCandidate({
    ...inputs(), metadataRows: [], geometryRows: [],
  });
  assert.equal(candidate.ok, true);
  assert.equal(candidate.featureCount, 0);
  assert.equal(candidate.viewportCoverage, 'unknown');
  assert.equal(candidate.publishAuthorized, false);
  assert.deepEqual(JSON.parse(candidate.candidateGeoJson), {
    type: 'FeatureCollection', features: [],
  });
});
