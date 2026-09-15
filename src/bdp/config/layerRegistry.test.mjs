import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BDP_LAYER_STATE_REGISTRY,
  extendLayerStateRegistry,
} from './layerRegistry.js';

test('BDP layer registry adds parcel, flood, RRC, NWI, SSURGO, and EPA layers with unique identities', () => {
  const upstream = Object.freeze([
    Object.freeze({ id: 'traffic', token: 't', disposition: 'enabled-only' }),
  ]);

  const registry = extendLayerStateRegistry(upstream);

  assert.equal(registry.length, 7);
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
  assert.ok(BDP_LAYER_STATE_REGISTRY.every((entry) => entry.disposition === 'enabled-only'));
  assert.equal(BDP_LAYER_STATE_REGISTRY.length, 6);
  assert.equal(new Set(BDP_LAYER_STATE_REGISTRY.map((entry) => entry.id)).size, 6);
  assert.equal(new Set(BDP_LAYER_STATE_REGISTRY.map((entry) => entry.token)).size, 6);
});

test('BDP extension does not mutate the upstream registry', () => {
  const upstream = [{ id: 'traffic', token: 't', disposition: 'enabled-only' }];
  const before = JSON.stringify(upstream);

  extendLayerStateRegistry(upstream);

  assert.equal(JSON.stringify(upstream), before);
});
