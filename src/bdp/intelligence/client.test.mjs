import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchBdpParcelIntelligence } from './client.js';

const parcel = {
  id: '48029:123',
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

test('posts one canonical parcel to the unified intelligence endpoint', async () => {
  const calls = [];
  const screening = { parcelId: parcel.id, sourceCoveragePercent: 100 };
  const result = await fetchBdpParcelIntelligence(parcel, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ screening }),
      };
    },
  });

  assert.equal(result, screening);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/bdp/intelligence/screen');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { parcel });
});

test('surfaces unified endpoint HTTP failures', async () => {
  await assert.rejects(
    () => fetchBdpParcelIntelligence(parcel, {
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        json: async () => ({ message: 'screening unavailable' }),
      }),
    }),
    (error) => error.status === 503 && /screening unavailable/i.test(error.message),
  );
});
