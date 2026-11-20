import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTxdotTrafficQueryUrl,
  trafficStyleForAadt,
} from './txdotTrafficLayer.js';

test('TxDOT traffic overlay builds a bounded WGS84 GeoJSON query', () => {
  const url = new URL(buildTxdotTrafficQueryUrl({
    west: -98.6,
    south: 29.3,
    east: -98.4,
    north: 29.5,
  }));
  assert.equal(url.hostname, 'services.arcgis.com');
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.equal(url.searchParams.get('outSR'), '4326');
  assert.match(url.searchParams.get('outFields'), /AADT_CUR/);
});

test('TxDOT traffic styling increases emphasis with AADT', () => {
  const rural = trafficStyleForAadt(500);
  const arterial = trafficStyleForAadt(10000);
  const freeway = trafficStyleForAadt(60000);
  assert.ok(rural.width < arterial.width);
  assert.ok(arterial.width < freeway.width);
  assert.ok(rural.alpha < freeway.alpha);
});
