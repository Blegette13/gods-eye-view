import { LAYER_STATE_REGISTRY } from '../../data/layerState.js';
import { BDP_LAYER_STATE_REGISTRY } from './layerRegistry.js';

/**
 * Phase 2 operational surface.
 *
 * Keep upstream layer registrations intact so old share-link tokens and the
 * manager's strict registry contract remain valid. Refuse activation of
 * unrelated live feeds before their enable/init/update lifecycle begins.
 *
 * Do not mistake this UI policy for a security boundary. Parcel/evidence
 * authorization remains server-side and enforced by PostgreSQL RLS.
 */
export const LAND_WORKSPACE_LAYER_IDS = Object.freeze(
  BDP_LAYER_STATE_REGISTRY.map(({ id }) => id),
);

export const LEGACY_WORKSPACE_LAYER_IDS = Object.freeze(
  LAYER_STATE_REGISTRY.map(({ id }) => id),
);

const landIds = new Set(LAND_WORKSPACE_LAYER_IDS);
const legacyIds = new Set(LEGACY_WORKSPACE_LAYER_IDS);

if (landIds.size !== LAND_WORKSPACE_LAYER_IDS.length
  || legacyIds.size !== LEGACY_WORKSPACE_LAYER_IDS.length
  || [...landIds].some((id) => legacyIds.has(id))) {
  throw new Error('Land/legacy layer registries must be unique and disjoint');
}

/** Non-land modules remain registered for backward compatibility, not active. */
export function landWorkspaceVisibilityGuard(change) {
  if (change?.enabled !== true || typeof change.layerId !== 'string') return null;
  if (!legacyIds.has(change.layerId)) return null;
  return 'Layer unavailable in land-development workspace';
}

export function isLandWorkspaceLayerId(id) {
  return landIds.has(id);
}

/**
 * No old aircraft/military mission dialog in the dedicated land workspace.
 * Maps, provider key setup and search still initialize normally.
 */
export function useLegacyFirstRunLauncher(product) {
  return product !== 'land-development-os';
}
