import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchBdpParcelEntitlement } from './client.js';

const parcel = {
  property: {
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-98.50, 29.40],
        [-98.49, 29.40],
        [-98.49, 29.41],
        [-98.50, 29.41],
        [-98.50, 29.40],
      ]],
    },
  },
};

test('posts parcel geometry to the BDP entitlement endpoint', async () => {
  const calls = [];
  const metrics = { jurisdiction_screen: 'san-antonio-city-zoned' };
  const result = await fetchBdpParcelEntitlement(parcel, {
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
  assert.equal(calls[0].url, '/api/bdp/entitlement/screen');
  assert.equal(calls[0].init.method, 'POST');
});

test('surfaces entitlement provider failures', async () => {
  await assert.rejects(
    () => fetchBdpParcelEntitlement(parcel, {
      fetchImpl: async () => ({
        ok: false,
        status: 502,
        json: async () => ({ message: 'zoning source unavailable' }),
      }),
    }),
    (error) => error.status === 502 && /unavailable/i.test(error.message),
  );
});
