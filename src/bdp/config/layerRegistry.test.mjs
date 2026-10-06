import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BDP_LAYER_STATE_REGISTRY,
  extendLayerStateRegistry,
} from './layerRegistry.js';

test('BDP layer registry adds land-intelligence layers with unique identities', () => {
  const upstream = Object.freeze([
    Object.freeze({ id: 'traffic', token: 't', disposition: 'enabled-only' }),
  ]);

  const registry = extendLayerStateRegistry(upstream);

  assert.equal(registry.length, 16);
  assert.deepEqual(registry[0], upstream[0]);
  assert.equal(registry[1].id, 'bdp-bexar-parcels');
  assert.equal(registry[1].token, 'p');
  assert.equal(registry[2].id, 'bdp-travis-parcels');
  assert.equal(registry[2].token, '3');
  assert.equal(registry[3].id, 'bdp-williamson-parcels');
  assert.equal(registry[3].token, '4');
  assert.equal(registry[4].id, 'bdp-hays-parcels');
  assert.equal(registry[4].token, '5');
  const expected = ['bdp-fema-flood','bdp-rrc-energy','bdp-nwi-wetlands','bdp-ssurgo-soils','bdp-epa-cleanups','bdp-txdot-traffic','bdp-utilities-infrastructure','bdp-tceq-water-rights','bdp-tceq-msw','bdp-thc-cemeteries','bdp-san-antonio-entitlement'];
  assert.deepEqual(registry.slice(5).map((entry) => entry.id), expected);
  assert.ok(BDP_LAYER_STATE_REGISTRY.every((entry) => entry.disposition === 'enabled-only'));
  assert.equal(BDP_LAYER_STATE_REGISTRY.length, 15);
  assert.equal(new Set(BDP_LAYER_STATE_REGISTRY.map((entry) => entry.id)).size, 15);
  assert.equal(new Set(BDP_LAYER_STATE_REGISTRY.map((entry) => entry.token)).size, 15);
});

test('BDP extension does not mutate the upstream registry', () => {
  const upstream = [{ id: 'traffic', token: 't', disposition: 'enabled-only' }];
  const before = JSON.stringify(upstream);

  extendLayerStateRegistry(upstream);

  assert.equal(JSON.stringify(upstream), before);
});
