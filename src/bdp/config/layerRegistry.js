export const BDP_LAYER_STATE_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'bdp-bexar-parcels',
    token: 'p',
    disposition: 'enabled-only',
  }),
  Object.freeze({
    id: 'bdp-fema-flood',
    token: 'h',
    disposition: 'enabled-only',
  }),
  Object.freeze({
    id: 'bdp-rrc-energy',
    token: 'j',
    disposition: 'enabled-only',
  }),
  Object.freeze({
    id: 'bdp-nwi-wetlands',
    token: 'k',
    disposition: 'enabled-only',
  }),
  Object.freeze({
    id: 'bdp-ssurgo-soils',
    token: 'l',
    disposition: 'enabled-only',
  }),
]);

/**
 * Extend the upstream God's Eye View production registry without modifying the
 * upstream share-link codec yet. BDP layer persistence will move into its own
 * workspace/state system as the land-intelligence product grows statewide.
 */
export function extendLayerStateRegistry(upstreamRegistry) {
  return Object.freeze([
    ...upstreamRegistry,
    ...BDP_LAYER_STATE_REGISTRY,
  ]);
}
