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

  assert.equal(registry.length, 11);
  assert.deepEqual(registry[0], upstream[0]);
  assert.equal(registry[1].id, 'bdp-bexar-parcels');
  assert.equal(registry[1].token, 'p');
  assert.equal(registry[2].id, 'bdp-fema-flood');
  assert.equal(registry[2].token, 'h');
  assert.equal(registry[3].id, 'bdp-rrc-energy');
  assert.equal(registry[3].token, 'j');
  assert.equal(registry[4].id, 'bdp-nwi-wetlands');
  assert.equal(registry[4].token, 'k');
  assert.equal(registry[5].id, 'bdp-ssurgo-soils');
  assert.equal(registry[5].token, 'l');
  assert.equal(registry[6].id, 'bdp-epa-cleanups');
  assert.equal(registry[6].token, 'n');
  assert.equal(registry[7].id, 'bdp-txdot-traffic');
  assert.equal(registry[7].token, 'o');
  assert.equal(registry[8].id, 'bdp-utilities-infrastructure');
  assert.equal(registry[8].token, 'v');
  assert.equal(registry[9].id, 'bdp-tceq-water-rights');
  assert.equal(registry[9].token, 'y');
  assert.equal(registry[10].id, 'bdp-tceq-msw');
  assert.equal(registry[10].token, 'z');
  assert.ok(BDP_LAYER_STATE_REGISTRY.every((entry) => entry.disposition === 'enabled-only'));
  assert.equal(BDP_LAYER_STATE_REGISTRY.length, 10);
  assert.equal(new Set(BDP_LAYER_STATE_REGISTRY.map((entry) => entry.id)).size, 10);
  assert.equal(new Set(BDP_LAYER_STATE_REGISTRY.map((entry) => entry.token)).size, 10);
});

test('BDP extension does not mutate the upstream registry', () => {
  const upstream = [{ id: 'traffic', token: 't', disposition: 'enabled-only' }];
  const before = JSON.stringify(upstream);

  extendLayerStateRegistry(upstream);

  assert.equal(JSON.stringify(upstream), before);
});
