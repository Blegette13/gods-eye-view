import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LAND_WORKSPACE_LAYER_IDS,
  LEGACY_WORKSPACE_LAYER_IDS,
  landWorkspaceVisibilityGuard,
  isLandWorkspaceLayerId,
  useLegacyFirstRunLauncher,
} from './workspacePolicy.js';
import { BDP_LAYER_STATE_REGISTRY } from './layerRegistry.js';
import { LAYER_STATE_REGISTRY } from '../../data/layerState.js';

test('Phase 2 preserves every existing land registration without renaming IDs', () => {
  assert.deepEqual(
    LAND_WORKSPACE_LAYER_IDS,
    BDP_LAYER_STATE_REGISTRY.map((entry) => entry.id),
  );
  assert.ok(LAND_WORKSPACE_LAYER_IDS.includes('bdp-bexar-parcels'));
  assert.ok(LAND_WORKSPACE_LAYER_IDS.includes('bdp-utilities-infrastructure'));
  assert.ok(LAND_WORKSPACE_LAYER_IDS.includes('bdp-san-antonio-entitlement'));
  for (const id of LAND_WORKSPACE_LAYER_IDS) {
    assert.equal(isLandWorkspaceLayerId(id), true);
    assert.equal(landWorkspaceVisibilityGuard({
      layerId: id, enabled: true, origin: 'share-restore',
    }), null);
  }
});

test('every upstream legacy feed is blocked, including share and local restore', () => {
  assert.deepEqual(
    LEGACY_WORKSPACE_LAYER_IDS,
    LAYER_STATE_REGISTRY.map((entry) => entry.id),
  );
  for (const id of LEGACY_WORKSPACE_LAYER_IDS) {
    assert.equal(isLandWorkspaceLayerId(id), false);
    for (const origin of ['user', 'share-restore', 'local-restore', 'tool', 'programmatic']) {
      assert.match(
        landWorkspaceVisibilityGuard({ layerId: id, enabled: true, origin }),
        /unavailable/,
      );
    }
    // A blocked feed can always be turned off by restoration/cleanup.
    assert.equal(landWorkspaceVisibilityGuard({
      layerId: id, enabled: false, origin: 'user',
    }), null);
  }
});

test('unknown QA and future IDs are not mistaken for upstream legacy feeds', () => {
  assert.equal(landWorkspaceVisibilityGuard({ layerId: 'qa-fixture', enabled: true }), null);
  assert.equal(landWorkspaceVisibilityGuard({ layerId: null, enabled: true }), null);
  assert.equal(landWorkspaceVisibilityGuard(null), null);
});

test('legacy first-run missions are suppressed only for the land workspace', () => {
  assert.equal(useLegacyFirstRunLauncher('land-development-os'), false);
  assert.equal(useLegacyFirstRunLauncher('upstream-dev'), true);
  assert.equal(useLegacyFirstRunLauncher(undefined), true);
});
