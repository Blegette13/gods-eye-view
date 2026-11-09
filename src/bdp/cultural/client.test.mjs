import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchBdpParcelCemeteries,
  fetchThcCemeteryFeatures,
} from './client.js';

const geometry = {
  type: 'Polygon',
  coordinates: [[
    [-98.5, 29.4],
    [-98.49, 29.4],
    [-98.49, 29.41],
    [-98.5, 29.41],
    [-98.5, 29.4],
  ]],
};

test('posts parcel geometry to the BDP cultural cemetery endpoint', async () => {
  const calls = [];
  const metrics = { cemeteries_intersecting_parcel: 1 };
  const result = await fetchBdpParcelCemeteries({ property: { geometry } }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ metrics }),
      };
    },
  });
  assert.equal(result, metrics);
  assert.equal(calls[0].url, '/api/bdp/cultural/cemeteries');
  assert.equal(calls[0].init.method, 'POST');
});

test('loads and normalizes public THC cemetery polygons for the map', async () => {
  const result = await fetchThcCemeteryFeatures({
    west: -98.6,
    south: 29.3,
    east: -98.4,
    north: 29.5,
  }, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry,
          properties: { CEMNAME: 'Example Cemetery', CEMTYPE: 'Cemetery' },
        }],
      }),
    }),
  });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.CEMNAME, 'Example Cemetery');
});
