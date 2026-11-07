import assert from 'node:assert/strict';
import test from 'node:test';
import { createTceqMswLayer } from './tceqMswLayer.js';

test('TCEQ MSW layer exposes the God’s Eye land-intelligence identity', () => {
  const layer = createTceqMswLayer({
    featureLoader: async () => ({
      points: { type: 'FeatureCollection', features: [] },
    }),
  });
  assert.equal(layer.id, 'bdp-tceq-msw');
  assert.equal(layer.name, 'BDP · TCEQ Landfills / MSW');
  assert.match(layer.source, /TCEQ/i);
});
