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

test('normalizes only point cleanup features and preserves risk fields', () => {
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
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [] },
        properties: {},
      },
    ],
  });
  assert.equal(normalized.features.length, 1);
  assert.equal(normalized.features[0].properties.PRIMARY_NAME, 'TEST CLEANUP');
  assert.equal(normalized.features[0].properties.SF_SITE_NAME, 'TEST SUPERFUND');
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
