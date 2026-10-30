import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTravisDiscoveryUrl, fetchHighAltitudeDiscovery,
  HIGH_ALTITUDE_DISCOVERY_COUNTIES, COUNTY_SAMPLE_LIMIT,
} from './highAltitudeDiscovery.js';
import { normalizeLandCriteria } from '../acquisition/session.js';

const criteria = normalizeLandCriteria({
  county: 'Travis', radiusMiles: 25, acresMin: 10, acresMax: 60,
  purpose: 'Residential development', budgetMax: 600000,
});
const center = { lat: 30.245, lon: -97.755 };

test('high-altitude source query is independent of camera and has bounded server-side filters', () => {
  const url = new URL(buildTravisDiscoveryUrl(criteria, center));
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.equal(url.searchParams.get('resultRecordCount'), String(COUNTY_SAMPLE_LIMIT + 1));
  assert.match(url.searchParams.get('where'), /tcad_acres >= 10/);
  assert.match(url.searchParams.get('where'), /tcad_acres <= 60/);
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.ok(url.searchParams.get('geometry').split(',').length === 4);
  assert.deepEqual(HIGH_ALTITUDE_DISCOVERY_COUNTIES, ['Travis']);
  assert.throws(() => buildTravisDiscoveryUrl(criteria, center, 1000));
  assert.throws(() => buildTravisDiscoveryUrl(criteria, null));
});

test('invalid county and malformed source do not become fabricated matches', async () => {
  const unsupported = await fetchHighAltitudeDiscovery({ criteria: normalizeLandCriteria({
    county: 'Bexar', acresMin: 10,
  }) });
  assert.equal(unsupported.state, 'unsupported');
  assert.equal(unsupported.results.length, 0);
  await assert.rejects(fetchHighAltitudeDiscovery({
    criteria, center, fetcher: async () => ({ok: true, json: async () => ({ error: { code: 498 } })}),
  }), /invalid GeoJSON/);
});

test('a real unambiguous sampled source record yields a provisional zoom-independent candidate', async () => {
  const feature = {
    type: 'Feature',
    properties: {
      OBJECTID: 123, PROP_ID: 302959,
      tcad_acres: 20, situs_address: 'Annie Street Austin TX 78704',
      py_owner_name: 'SOURCE NAME', market_value: 360000,
    },
    geometry: { type: 'Polygon', coordinates: [[
      [-97.76, 30.24], [-97.75, 30.24],
      [-97.75, 30.25], [-97.76, 30.24],
    ]] },
  };
  const result = await fetchHighAltitudeDiscovery({
    criteria, center,
    fetcher: async () => ({
      ok: true, json: async () => ({ type: 'FeatureCollection', features: [feature] }),
    }),
  });
  assert.equal(result.state, 'sample');
  assert.equal(result.complete, false, 'do not imply full county coverage');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].parcelId, '302959');
  assert.equal(result.results[0].acresReported, 20);
  assert.match(result.message, /not exhaustive/i);
});
