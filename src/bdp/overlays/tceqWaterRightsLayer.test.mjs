import assert from 'node:assert/strict';
import test from 'node:test';
import { createTceqWaterRightsLayer } from './tceqWaterRightsLayer.js';

test('TCEQ water-right layer exposes God’s Eye layer identity', () => {
  const layer = createTceqWaterRightsLayer({
    featureLoader: async () => ({
      points: { type: 'FeatureCollection', features: [] },
    }),
  });
  assert.equal(layer.id, 'bdp-tceq-water-rights');
  assert.equal(layer.name, 'BDP · TCEQ Water Rights');
  assert.match(layer.source, /TCEQ/i);
});
