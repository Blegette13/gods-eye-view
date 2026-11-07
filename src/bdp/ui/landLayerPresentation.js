import { BDP_LAYER_STATE_REGISTRY } from '../config/layerRegistry.js';

/**
 * Phase 2 presentation-only taxonomy.
 * Never rename registered IDs, data sources, share tokens or PostGIS relations.
 */
export const LAND_LAYER_GROUPS = Object.freeze([
  Object.freeze({
    id: 'parcels',
    label: 'Parcels & Ownership',
    layerIds: Object.freeze([
      'bdp-bexar-parcels',
      'bdp-travis-parcels',
      'bdp-williamson-parcels',
      'bdp-hays-parcels',
      'bdp-dallas-parcels',
      'bdp-harris-parcels',
    ]),
  }),
  Object.freeze({
    id: 'constraints',
    label: 'Environmental & Site Constraints',
    layerIds: Object.freeze([
      'bdp-fema-flood',
      'bdp-rrc-energy',
      'bdp-nwi-wetlands',
      'bdp-ssurgo-soils',
      'bdp-epa-cleanups',
    ]),
  }),
  Object.freeze({
    id: 'infrastructure',
    label: 'Access & Infrastructure',
    layerIds: Object.freeze([
      'bdp-txdot-traffic',
      'bdp-utilities-infrastructure',
    ]),
  }),
  Object.freeze({
    id: 'regulatory',
    label: 'Regulatory & Entitlements',
    layerIds: Object.freeze([
      'bdp-tceq-water-rights',
      'bdp-tceq-msw',
      'bdp-thc-cemeteries',
      'bdp-san-antonio-entitlement',
    ]),
  }),
]);

const layerToGroup = new Map();
for (const group of LAND_LAYER_GROUPS) {
  for (const id of group.layerIds) {
    if (layerToGroup.has(id)) throw new Error('Land layer assigned to multiple presentation groups');
    layerToGroup.set(id, group);
  }
}
const registered = new Set(BDP_LAYER_STATE_REGISTRY.map(({ id }) => id));
if (registered.size !== layerToGroup.size
  || [...registered].some((id) => !layerToGroup.has(id))) {
  throw new Error('Land layer presentation is out of sync with registered land datasets');
}

export function landLayerGroup(id) {
  return layerToGroup.get(id) || null;
}

/** Strip company-specific presentation prefix only; never touch source IDs. */
export function landLayerDisplayName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/^BDP\s*[·:—-]\s*/i, '').trim();
}
