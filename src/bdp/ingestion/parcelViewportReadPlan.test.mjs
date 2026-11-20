import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import {
  PARCEL_VIEWPORT_PROBE_SQL,
  buildParcelViewportProbeStatement,
  summarizeParcelViewportProbe,
} from './parcelViewportReadPlan.js';

const plan = () => parseBoundedParcelPageRequest({
  countyFips: '48453',
  bounds: { west: -97.75, south: 30.25, east: -97.73, north: 30.27 },
  limit: 3,
});
const build = (extra = {}) => buildParcelViewportProbeStatement({
  plan: plan(), trustedSourceId: 'travis-cad', trustedRunId: 23, ...extra,
});
const row = (id) => ({
  source_parcel_id: id, geometry_vertices: 9, geometry_memory_bytes: 512,
});

test('valid requests generate a fixed, immutable, eight-parameter read plan', () => {
  const result = build();
  assert.equal(result.text, PARCEL_VIEWPORT_PROBE_SQL);
  assert.deepEqual(result.values, ['48453', 'travis-cad', 23, -97.75, 30.25, -97.73, 30.27, 4]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.values));
  assert.equal(new Set(result.text.match(/\$\d+(?=::)/g)).size, 8);
});

test('source and run identifiers are not interpolated into SQL', () => {
  const result = build({ trustedSourceId: 'bexar-parcel_2026', trustedRunId: 982 });
  assert.equal(result.text, build().text);
  assert.ok(!result.text.includes('travis-cad'));
  assert.ok(!result.text.includes('bexar-parcel_2026'));
  assert.equal(result.values[1], 'bexar-parcel_2026');
  assert.equal(result.values[2], 982);
});

test('rejects fabricated run identifiers, bad sources and browser-supplied query plans', () => {
  for (const trustedRunId of [0, -1, 1.5, '23', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(build({ trustedRunId }), null);
  }
  for (const trustedSourceId of ['TCA', '../travis', "travis'; DROP TABLE", '', 42]) {
    assert.equal(build({ trustedSourceId }), null);
  }
  const p = plan();
  assert.equal(build({ plan: { ...p, probeLimit: 999 } }), null);
  assert.equal(build({ plan: { ...p, bounds: { ...p.bounds, east: -96 } } }), null);
  assert.equal(build({ plan: { ...p, limit: 300 } }), null);
  assert.equal(build({ plan: null }), null);
});

test('SQL requires PostGIS index intersection and a single rights-approved run', () => {
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /ST_MakeEnvelope\(/);
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /pv\.geometry && b\.bounds/);
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /ST_Intersects\(pv\.geometry, b\.bounds\)/);
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /sr\.rights_state = 'approved'/);
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /sr\.approved_caching_until > clock_timestamp\(\)/);
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /ir\.id = \$3::bigint/);
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /pv\.county_fips = sr\.county_fips/);
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /pv\.source_version = ir\.source_version/);
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /ir\.finished_at IS NOT NULL/);
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /ir\.outcome IN \('complete', 'partial'\)/);
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /LIMIT \$8::integer/);
  assert.doesNotMatch(PARCEL_VIEWPORT_PROBE_SQL, /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|COPY|EXECUTE)\b/i);
});

test('metadata probe intentionally avoids serialized geometry and owner fields', () => {
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /ST_NPoints\(pv\.geometry\)/);
  assert.match(PARCEL_VIEWPORT_PROBE_SQL, /ST_MemSize\(pv\.geometry\)/);
  assert.doesNotMatch(PARCEL_VIEWPORT_PROBE_SQL, /ST_AsGeoJSON|ST_AsBinary|ST_AsMVT|\bowner\b|\baddress\b/i);
});

test('probe result notes overflow but never claims viewport completeness', () => {
  const p = plan();
  const short = summarizeParcelViewportProbe({ plan: p, rows: [row('1'), row('2')] });
  assert.deepEqual(short, { acceptedCount: 2, overflow: false, viewportCoverage: 'unknown', geometryDelivered: false });
  const full = summarizeParcelViewportProbe({ plan: p, rows: [row('1'), row('2'), row('3'), row('4')] });
  assert.equal(full.acceptedCount, 3);
  assert.equal(full.overflow, true);
  assert.equal(full.viewportCoverage, 'unknown');
  assert.equal(summarizeParcelViewportProbe({ plan: p, rows: [] }).viewportCoverage, 'unknown');
});

test('malformed, duplicate, or excessive result rows fail closed', () => {
  const p = plan();
  for (const rows of [
    'not rows', null,
    [row('1'), row('1')],
    [row('1'), row('2'), row('3'), row('4'), row('5')],
    [row('1'), { source_parcel_id: '2', geometry_vertices: 0, geometry_memory_bytes: 512 }],
    [row('1'), { source_parcel_id: '2', geometry_vertices: 3, geometry_memory_bytes: '512' }],
    [row('1'), { source_parcel_id: 2, geometry_vertices: 3, geometry_memory_bytes: 512 }],
  ]) assert.equal(summarizeParcelViewportProbe({ plan: p, rows }), null);
  assert.equal(summarizeParcelViewportProbe({ plan: { ...p, probeLimit: 10 }, rows: [] }), null);
});
