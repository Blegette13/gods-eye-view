import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SDA_TABULAR_URL,
  SDA_WGS84_WFS_URL,
  SSURGO_MAPUNIT_LAYER,
  buildSdaTabularRequest,
  buildSsurgoMapunitQuery,
  buildSsurgoWfsUrl,
  normalizeSsurgoBounds,
} from './ssurgoCatalog.js';

test('normalizes bounded WGS84 soil viewport', () => {
  assert.deepEqual(normalizeSsurgoBounds({
    west: -98.6,
    south: 29.3,
    east: -98.4,
    north: 29.5,
  }), {
    west: -98.6,
    south: 29.3,
    east: -98.4,
    north: 29.5,
  });
  assert.throws(() => normalizeSsurgoBounds({ west: -100, south: 29, east: -98, north: 30 }), /viewport/);
});

test('builds official WGS84 MapunitPoly WFS request', () => {
  const url = new URL(buildSsurgoWfsUrl({
    west: -98.6,
    south: 29.3,
    east: -98.4,
    north: 29.5,
  }, { maxFeatures: 1200 }));

  assert.equal(`${url.origin}${url.pathname}`, SDA_WGS84_WFS_URL);
  assert.equal(url.searchParams.get('SERVICE'), 'WFS');
  assert.equal(url.searchParams.get('VERSION'), '1.1.0');
  assert.equal(url.searchParams.get('TYPENAME'), SSURGO_MAPUNIT_LAYER);
  assert.equal(url.searchParams.get('SRSNAME'), 'EPSG:4326');
  assert.equal(url.searchParams.get('MAXFEATURES'), '1200');
  assert.match(url.searchParams.get('FILTER'), /BBOX/);
});

test('builds deduplicated mapunit enrichment query and SDA POST request', () => {
  const query = buildSsurgoMapunitQuery(['123', '456', '123', 'bad']);
  assert.equal(query, "SELECT mukey, musym, muname FROM mapunit WHERE mukey IN ('123','456') ORDER BY mukey");

  const request = buildSdaTabularRequest(query);
  assert.equal(request.url, SDA_TABULAR_URL);
  assert.equal(request.init.method, 'POST');
  const body = new URLSearchParams(request.init.body);
  assert.equal(body.get('FORMAT'), 'JSON+COLUMNNAME');
  assert.equal(body.get('QUERY'), query);
});
