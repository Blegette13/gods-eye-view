import assert from 'node:assert/strict';
import test from 'node:test';
import { createThcCemeteryLayer } from './thcCemeteryLayer.js';

test('THC cemetery layer exposes a God’s Eye land-intelligence identity', () => {
  const layer = createThcCemeteryLayer({
    featureLoader: async () => ({ type: 'FeatureCollection', features: [] }),
  });
  assert.equal(layer.id, 'bdp-thc-cemeteries');
  assert.equal(layer.name, 'BDP · THC Cemeteries');
  assert.match(layer.source, /Historical Commission/i);
});
