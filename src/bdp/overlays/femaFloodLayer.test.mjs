import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFemaFloodQueryUrl,
  classifyFloodFeature,
  FEMA_NFHL_FLOOD_HAZARD_URL,
} from './femaFloodLayer.js';

test('FEMA query uses the official NFHL flood-hazard layer and viewport envelope', () => {
  const url = new URL(buildFemaFloodQueryUrl({
    west: -98.6,
    south: 29.2,
    east: -98.3,
    north: 29.5,
  }, { limit: 500 }));

  assert.equal(`${url.origin}${url.pathname}`, FEMA_NFHL_FLOOD_HAZARD_URL);
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.equal(url.searchParams.get('outSR'), '4326');
  assert.equal(url.searchParams.get('resultRecordCount'), '500');
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.match(url.searchParams.get('outFields'), /FLD_ZONE/);
  assert.match(url.searchParams.get('outFields'), /SFHA_TF/);
});

test('FEMA flood classification prioritizes floodway and SFHA', () => {
  assert.equal(classifyFloodFeature({
    properties: { FLD_ZONE: 'AE', SFHA_TF: 'T', ZONE_SUBTY: 'FLOODWAY' },
  }), 'floodway');

  assert.equal(classifyFloodFeature({
    properties: { FLD_ZONE: 'AE', SFHA_TF: 'T', ZONE_SUBTY: '' },
  }), 'sfha');

  assert.equal(classifyFloodFeature({
    properties: { FLD_ZONE: 'X', SFHA_TF: 'F', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD' },
  }), 'moderate');
});
