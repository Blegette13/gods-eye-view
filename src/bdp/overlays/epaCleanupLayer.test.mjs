import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EPA_CLEANUP_LAYER_URL,
  buildEpaCleanupQueryUrl,
  classifyEpaCleanupFeature,
} from './epaCleanupLayer.js';

test('EPA cleanup query is Texas-only, WGS84 and bounded', () => {
  const url = new URL(buildEpaCleanupQueryUrl({
    west: -98.7,
    south: 29.2,
    east: -98.3,
    north: 29.7,
  }, { limit: 9000 }));

  assert.equal(url.origin + url.pathname.replace(/\/query$/, ''), EPA_CLEANUP_LAYER_URL);
  assert.equal(url.searchParams.get('where'), "STATE_CODE='TX'");
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.equal(url.searchParams.get('outSR'), '4326');
  assert.equal(url.searchParams.get('resultRecordCount'), '2000');
  assert.equal(url.searchParams.get('f'), 'geojson');
});

test('classifies cleanup programs from source-specific fields', () => {
  assert.deepEqual(classifyEpaCleanupFeature({
    properties: {
      SF_SITE_NAME: 'TEST SUPERFUND',
      RCRA_HANDLER_NAME: 'TEST RCRA',
      BF_PROPERTY_NAME: '',
    },
  }), ['superfund', 'rcra']);

  assert.deepEqual(classifyEpaCleanupFeature({
    properties: { BF_PROPERTY_NAME: 'TEST BROWNFIELD' },
  }), ['brownfields']);

  assert.deepEqual(classifyEpaCleanupFeature({
    properties: {},
  }), ['cleanup']);
});

test('rejects invalid cleanup bounds', () => {
  assert.throws(() => buildEpaCleanupQueryUrl({
    west: -98,
    south: 30,
    east: -99,
    north: 29,
  }), /invalid WGS84 bounds/);
});
