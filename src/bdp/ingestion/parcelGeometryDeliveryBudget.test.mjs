import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import {
  PARCEL_MAX_FEATURE_VERTICES,
  PARCEL_MAX_PAGE_VERTICES,
  PARCEL_MAX_FEATURE_GEOMETRY_MEMORY_BYTES,
  PARCEL_MAX_PAGE_GEOMETRY_MEMORY_BYTES,
  assessParcelGeometryMetadata,
  assessParcelGeoJsonPage,
} from './parcelGeometryDeliveryBudget.js';

const plan = (limit = 3) => parseBoundedParcelPageRequest({
  countyFips: '48453',
  bounds: { west: -97.75, south: 30.25, east: -97.73, north: 30.27 },
  limit,
});
const row = (id, vertices = 5, bytes = 200) => ({
  source_parcel_id: id, geometry_vertices: vertices, geometry_memory_bytes: bytes,
});
const polygon = () => ({
  type: 'Polygon',
  coordinates: [[[-97.75, 30.25], [-97.74, 30.25], [-97.74, 30.26], [-97.75, 30.26], [-97.75, 30.25]]],
});
const feature = (id, geometry = polygon()) => ({
  type: 'Feature', id, properties: { sourceParcelId: id }, geometry,
});
const collection = (...features) => ({ type: 'FeatureCollection', features });

test('good metadata passes without claiming complete viewport coverage', () => {
  assert.deepEqual(assessParcelGeometryMetadata({ plan: plan(), rows: [row('1'), row('2')] }), {
    ok: true, acceptedCount: 2, overflow: false,
    vertices: 10, geometryMemoryBytes: 400, viewportCoverage: 'unknown',
  });
});

test('overflow is explicit; the extra probe row is not part of the served geometry budget', () => {
  const rows = [row('1'), row('2'), row('3'), row('4', 999999, 9999999)];
  const result = assessParcelGeometryMetadata({ plan: plan(), rows });
  assert.equal(result.ok, true);
  assert.equal(result.overflow, true);
  assert.equal(result.acceptedCount, 3);
  assert.equal(result.geometryMemoryBytes, 600);
  assert.equal(result.viewportCoverage, 'unknown');
});

test('rejects oversized individual feature and rejects page-scale aggregate budgets', () => {
  for (const rows of [
    [row('1', PARCEL_MAX_FEATURE_VERTICES + 1)],
    [row('1', 5, PARCEL_MAX_FEATURE_GEOMETRY_MEMORY_BYTES + 1)],
    Array.from({ length: 9 }, (_, i) => row(String(i + 1), 7_500, 300)),
    Array.from({ length: 9 }, (_, i) => row(String(i + 1), 5, 500_000)),
  ]) {
    const r = assessParcelGeometryMetadata({ plan: plan(9), rows });
    assert.equal(r.ok, false);
    assert.match(r.reason, /budget-exceeded/);
  }
  assert.equal(PARCEL_MAX_PAGE_VERTICES, 60_000);
  assert.equal(PARCEL_MAX_PAGE_GEOMETRY_MEMORY_BYTES, 4 * 1024 * 1024);
});

test('bad probe metadata, invalid source IDs and duplicates fail closed', () => {
  for (const rows of [
    null, [], [row('unsafe ID')], [row('1'), row('1')],
    [row('1', -1)], [row('1', 5, -3)],
    [row('1'), row('2'), row('3'), row('4'), row('5')],
  ]) {
    const result = assessParcelGeometryMetadata({ plan: plan(), rows });
    if (rows && rows.length === 0) assert.equal(result.ok, true);
    else assert.equal(result.ok, false);
  }
});

test('valid 2D geometry collection passes, with bytes measured but publish disabled', () => {
  const result = assessParcelGeoJsonPage({ plan: plan(), rows: [row('1')], collection: collection(feature('1')) });
  assert.equal(result.ok, true);
  assert.equal(result.publishAuthorized, false);
  assert.ok(result.geoJsonBytes > 0);
  assert.equal(result.viewportCoverage, 'unknown');
});

test('forbids unrelated PII and unexpected attributes in delivery payload', () => {
  const base = feature('1');
  for (const invalid of [
    { ...base, ownerName: 'third-party' },
    { ...base, properties: { ...base.properties, address: 'not for map tiles' } },
    { ...base, id: 'different' },
  ]) {
    assert.equal(assessParcelGeoJsonPage({ plan: plan(), rows: [row('1')], collection: collection(invalid) }).ok, false);
  }
});

test('rejects malformed, open, non-WGS84 and nonfinite geometries', () => {
  const altered = [
    { type: 'Point', coordinates: [-97.7, 30.2] },
    { type: 'Polygon', coordinates: [[[-97.75, 30.25], [-97.74, 30.25], [-97.74, 30.26], [-97.75, 30.26]]] },
    { type: 'Polygon', coordinates: [[[999, 30.2], [1, 1], [1, 2], [2, 2], [999, 30.2]]] },
    { type: 'Polygon', coordinates: [[[NaN, 30.2], [1, 1], [1, 2], [2, 2], [NaN, 30.2]]] },
    { type: 'Polygon', coordinates: [[[0, 91], [1, 1], [1, 2], [2, 2], [0, 91]]] },
    { type: 'Polygon', coordinates: [[[1, 1, 12], [1, 1], [1, 2], [2, 2], [1, 1, 12]]] },
  ];
  for (const geometry of altered) {
    const result = assessParcelGeoJsonPage({ plan: plan(), rows: [row('1')], collection: collection(feature('1', geometry)) });
    assert.equal(result.ok, false);
  }
});

test('no hidden clipping: missing or extra features and incorrect coordinate counts fail', () => {
  for (const source of [
    collection(), collection(feature('1'), feature('2')),
    collection(feature('1', { type: 'MultiPolygon', coordinates: [polygon().coordinates, polygon().coordinates] })),
  ]) {
    assert.equal(assessParcelGeoJsonPage({ plan: plan(), rows: [row('1')], collection: source }).ok, false);
  }
});

test('malicious or cyclic feature collections cannot be serialized', () => {
  const cyc = collection(feature('1'));
  cyc.loop = cyc;
  assert.equal(assessParcelGeoJsonPage({ plan: plan(), rows: [row('1')], collection: cyc }).ok, false);
});

test('wire payload cap rejects a verbose page even when metadata budgets pass', () => {
  const rows = Array.from({ length: 8 }, (_, index) => row(String(index + 1), 7_500, 512));
  const features = rows.map((r, index) => {
    const coords = Array.from({ length: 7_499 }, (_, n) => [
      -97.712345678901 + (index + n / 1_000_000) * 0.000001,
      30.212345678901 + (index + n / 1_000_000) * 0.000001,
    ]);
    coords.push([...coords[0]]);
    return feature(r.source_parcel_id, { type: 'Polygon', coordinates: [coords] });
  });
  const result = assessParcelGeoJsonPage({ plan: plan(8), rows, collection: collection(...features) });
  assert.deepEqual(result, { ok: false, reason: 'wire-budget-exceeded' });
});
