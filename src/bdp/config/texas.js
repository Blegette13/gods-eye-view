export const TEXAS_FIPS = '48';
export const TEXAS_COUNTY_COUNT = 254;

export const BDP_SEARCH_DEFAULTS = Object.freeze({
  growthRadiusMiles: 25,
  parcelSearchLimit: 500,
  minimumAcres: null,
  maximumAcres: null,
});

export const BDP_SOURCE_PRIORITY = Object.freeze([
  'authoritative-api',
  'authoritative-gis',
  'authoritative-bulk-download',
  'licensed-provider',
  'permitted-web-retrieval',
]);

export const BDP_INITIAL_OVERLAYS = Object.freeze([
  'parcels',
  'flood',
  'wetlands',
  'soil',
  'oil-gas',
  'transmission',
  'environmental',
  'traffic',
  'growth',
]);
