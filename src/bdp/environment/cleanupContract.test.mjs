import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEpaCleanupMetricsSql,
  buildEpaCleanupParcelQueryUrl,
  normalizeEpaCleanupFeatureCollection,
} from './cleanupContract.js';

const parcel = {
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-98.50, 29.40],
      [-98.48, 29.40],
      [-98.48, 29.42],
      [-98.50, 29.42],
      [-98.50, 29.40],
    ]],
  },
};

test('EPA parcel query is Texas-only and expands beyond parcel bounds', () => {
  const url = new URL(buildEpaCleanupParcelQueryUrl(parcel));
  assert.equal(url.searchParams.get('where'), "STATE_CODE='TX'");
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.equal(url.searchParams.get('outSR'), '4326');
  const [west, south, east, north] = url.searchParams.get('geometry').split(',').map(Number);
  assert.ok(west < -98.50);
  assert.ok(south < 29.40);
  assert.ok(east > -98.48);
  assert.ok(north > 29.42);
});

test('normalizes valid point cleanup features and preserves risk fields', () => {
  const normalized = normalizeEpaCleanupFeatureCollection({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-98.49, 29.41] },
        properties: {
          REGISTRY_ID: '110000000001',
          PRIMARY_NAME: 'TEST CLEANUP',
          SF_SITE_NAME: 'TEST SUPERFUND',
        },
      },
    ],
  });
  assert.equal(normalized.features.length, 1);
  assert.equal(normalized.features[0].properties.PRIMARY_NAME, 'TEST CLEANUP');
  assert.equal(normalized.features[0].properties.SF_SITE_NAME, 'TEST SUPERFUND');
});

test('capped EPA responses fail even when the feature count is below the local limit', () => {
  for (const limit of [{ exceededTransferLimit: true }, { properties: { exceededTransferLimit: true } }]) {
    assert.throws(() => normalizeEpaCleanupFeatureCollection({ type: 'FeatureCollection', features: [], ...limit }), /capped/);
  }
});

test('invalid or missing EPA geometries cannot be silently dropped into a clear screen', () => {
  for (const geometry of [null, { type: 'Polygon', coordinates: [] },
    { type: 'Point', coordinates: [] }, { type: 'Point', coordinates: [-98] },
    { type: 'Point', coordinates: ['-98', 29] }, { type: 'Point', coordinates: [-98, null] },
    { type: 'Point', coordinates: [-181, 29] }, { type: 'Point', coordinates: [-98, 91] },
    { type: 'Point', coordinates: [-98, NaN] }]) {
    const input = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-98, 29] }, properties: {} },
      { type: 'Feature', geometry, properties: {} },
    ] };
    assert.throws(() => normalizeEpaCleanupFeatureCollection(input), /counts are unknown/);
    assert.throws(() => buildEpaCleanupMetricsSql(parcel, input), /counts are unknown/);
  }
  assert.equal(normalizeEpaCleanupFeatureCollection({ type: 'FeatureCollection', features: [] }).features.length, 0);
});

test('cleanup metrics SQL calculates exact parcel proximity in PostGIS', () => {
  const sql = buildEpaCleanupMetricsSql(parcel, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-98.49, 29.41] },
      properties: {
        REGISTRY_ID: '110000000001',
        PRIMARY_NAME: 'TEST CLEANUP',
        SF_SITE_NAME: 'TEST SUPERFUND',
      },
    }],
  });
  assert.match(sql, /ST_DWithin/);
  assert.match(sql, /8046\.72/);
  assert.match(sql, /cleanup_sites_within_1_mi/);
  assert.match(sql, /superfund_within_5_mi/);
  assert.match(sql, /nearest_site_name/);
});
