import assert from 'node:assert/strict';
import test from 'node:test';

import { BDP_LAYER_STATE_REGISTRY } from '../config/layerRegistry.js';
import {
  LAND_LAYER_GROUPS,
  landLayerGroup,
  landLayerDisplayName,
} from './landLayerPresentation.js';

test('every registered land layer has exactly one visible category, in registry order', () => {
  const ids = BDP_LAYER_STATE_REGISTRY.map(({ id }) => id);
  const groupedIds = LAND_LAYER_GROUPS.flatMap(({ layerIds }) => layerIds);
  assert.equal(new Set(groupedIds).size, ids.length);
  assert.deepEqual(groupedIds, ids);
  assert.deepEqual(
    LAND_LAYER_GROUPS.map(({ label }) => label),
    [
      'Parcels & Ownership',
      'Environmental & Site Constraints',
      'Access & Infrastructure',
      'Regulatory & Entitlements',
    ],
  );
  for (const group of LAND_LAYER_GROUPS) {
    for (const id of group.layerIds) {
      assert.equal(landLayerGroup(id), group);
    }
  }
});

test('unrelated layers cannot be mislabeled as land', () => {
  assert.equal(landLayerGroup('flights'), null);
  assert.equal(landLayerGroup('military'), null);
  assert.equal(landLayerGroup('unknown-qa'), null);
});

test('presentation labels do not expose BDP prefix or alter names and IDs', () => {
  assert.equal(landLayerDisplayName('BDP · Bexar Parcels'), 'Bexar Parcels');
  assert.equal(landLayerDisplayName('BDP - FEMA Flood Hazard'), 'FEMA Flood Hazard');
  assert.equal(landLayerDisplayName('FEMA Flood Hazard'), 'FEMA Flood Hazard');
  assert.equal(landLayerDisplayName(''), '');
  assert.equal(landLayerDisplayName(undefined), '');
  assert.equal(BDP_LAYER_STATE_REGISTRY[0].id, 'bdp-bexar-parcels');
});
