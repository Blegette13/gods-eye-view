import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchBdpParcelWaterRights } from './client.js';

const parcel = {
  property: {
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-98.5, 29.4],
        [-98.49, 29.4],
        [-98.49, 29.41],
        [-98.5, 29.41],
        [-98.5, 29.4],
      ]],
    },
  },
};

test('posts parcel geometry to the TCEQ water-right endpoint', async () => {
  const calls = [];
  const metrics = { water_right_points_on_parcel: 1 };
  const result = await fetchBdpParcelWaterRights(parcel, {
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
  assert.equal(calls[0].url, '/api/bdp/water/rights');
  assert.equal(calls[0].init.method, 'POST');
});

test('surfaces TCEQ water endpoint failures', async () => {
  await assert.rejects(
    () => fetchBdpParcelWaterRights(parcel, {
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        json: async () => ({ message: 'water-right data unavailable' }),
      }),
    }),
    (error) => error.status === 503 && /unavailable/i.test(error.message),
  );
});
