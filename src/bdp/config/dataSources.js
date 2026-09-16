export const BDP_SOURCE_METHOD = Object.freeze({
  API: 'api',
  GIS_SERVICE: 'gis-service',
  BULK_DOWNLOAD: 'bulk-download',
  LICENSED_FEED: 'licensed-feed',
  DOCUMENT_FEED: 'document-feed',
  PERMITTED_FETCH: 'permitted-fetch',
  MANUAL: 'manual',
});

export const BDP_AUTHORITY = Object.freeze({
  AUTHORITATIVE: 'authoritative',
  PRIMARY: 'primary',
  LICENSED: 'licensed',
  SECONDARY: 'secondary',
  ADVISORY: 'advisory',
});

export const BDP_REFRESH_CLASS = Object.freeze({
  LIVE: 'live',
  HOURLY: 'hourly',
  DAILY: 'daily',
  TWICE_WEEKLY: 'twice-weekly',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  ANNUAL: 'annual',
  ON_DEMAND: 'on-demand',
});

/**
 * Initial BDP source policy. Cadences describe when BDP should check the
 * authoritative upstream source, not how often upstream itself changes.
 * Individual source adapters may override a cadence when the publisher exposes
 * a stronger update signal (ETag, Last-Modified, update timestamp, webhook,
 * ArcGIS edit metadata, etc.).
 */
export const BDP_DATA_SOURCES = Object.freeze({
  bexarParcels: Object.freeze({
    id: 'bexar-parcels',
    label: 'Bexar County Parcels / BCAD',
    method: BDP_SOURCE_METHOD.GIS_SERVICE,
    authority: BDP_AUTHORITY.PRIMARY,
    refreshClass: BDP_REFRESH_CLASS.ANNUAL,
    onDemandRefresh: true,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    url: 'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0',
    notes: 'Official Bexar County ArcGIS parcel service sourced from BCAD; query by viewport or parcel id instead of crawling records.',
  }),
  texasRailroadCommission: Object.freeze({
    id: 'texas-rrc',
    label: 'Railroad Commission of Texas GIS',
    method: BDP_SOURCE_METHOD.BULK_DOWNLOAD,
    authority: BDP_AUTHORITY.PRIMARY,
    refreshClass: BDP_REFRESH_CLASS.TWICE_WEEKLY,
    onDemandRefresh: true,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    url: 'https://www.rrc.texas.gov/resource-center/research/data-sets-available-for-download/',
    notes: 'RRC publishes county well and pipeline shapefile archives twice weekly. Prefer those official bulk products and targeted public GIS queries over automated crawling of the interactive viewer.',
  }),
  tceqWaterRights: Object.freeze({
    id: 'tceq-water-rights',
    label: 'TCEQ Surface Water Rights',
    method: BDP_SOURCE_METHOD.BULK_DOWNLOAD,
    authority: BDP_AUTHORITY.AUTHORITATIVE,
    refreshClass: BDP_REFRESH_CLASS.WEEKLY,
    onDemandRefresh: true,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    url: 'https://www.tceq.texas.gov/permitting/water_rights/wr-permitting/wrwud',
    notes: 'Check TCEQ structured active/inactive water-right files for changes and use the official Water Rights Viewer for spatial verification/context rather than scraping the viewer UI.',
  }),
  epaCleanups: Object.freeze({
    id: 'epa-cleanups',
    label: 'EPA Cleanups in My Community',
    method: BDP_SOURCE_METHOD.GIS_SERVICE,
    authority: BDP_AUTHORITY.AUTHORITATIVE,
    refreshClass: BDP_REFRESH_CLASS.WEEKLY,
    onDemandRefresh: true,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    url: 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Cleanups_in_my_Community_Sites/FeatureServer/0',
    notes: 'Use the modern EPA hosted feature layer for Superfund, RCRA corrective-action, Brownfields and response-site screening. Query by viewport/parcel vicinity; do not use the retired legacy CIMC MapServer.',
  }),
  txdotRoadways: Object.freeze({
    id: 'txdot-roadways',
    label: 'TxDOT Roadways / GRID',
    method: BDP_SOURCE_METHOD.GIS_SERVICE,
    authority: BDP_AUTHORITY.AUTHORITATIVE,
    refreshClass: BDP_REFRESH_CLASS.MONTHLY,
    onDemandRefresh: true,
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    url: 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/ArcGIS/rest/services/TxDOT_Roadways/FeatureServer/0',
    notes: 'Statewide TxDOT roadway network from GRID, including on-system and off-system public roads. Use for mapped road proximity/classification screening; mapped centerlines do not establish legal parcel access or frontage.',
  }),
  txdotAadt: Object.freeze({
    id: 'txdot-aadt',
    label: 'TxDOT Annual Average Daily Traffic',
    method: BDP_SOURCE_METHOD.GIS_SERVICE,
    authority: BDP_AUTHORITY.AUTHORITATIVE,
    refreshClass: BDP_REFRESH_CLASS.ANNUAL,
    onDemandRefresh: true,
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    url: 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_AADT/FeatureServer/0',
    notes: 'Current AADT stamped onto TxDOT roadway linework from GRID. Use as traffic-volume screening and preserve the published extract date.',
  }),
  txdotAadtHistory: Object.freeze({
    id: 'txdot-aadt-history',
    label: 'TxDOT Five-Year AADT Counts',
    method: BDP_SOURCE_METHOD.GIS_SERVICE,
    authority: BDP_AUTHORITY.AUTHORITATIVE,
    refreshClass: BDP_REFRESH_CLASS.ANNUAL,
    onDemandRefresh: true,
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    url: 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/ArcGIS/rest/services/TxDOT_5_Year_Statewide_AADT_Traffic_Counts/FeatureServer/0',
    notes: 'Five-year statewide TxDOT count-station history. Keep station trend separate from the nearest roadway segment unless the station/route relationship is explicitly verified.',
  }),
  usdaSsurgO: Object.freeze({
    id: 'usda-ssurgo',
    label: 'USDA NRCS SSURGO',
    method: BDP_SOURCE_METHOD.BULK_DOWNLOAD,
    authority: BDP_AUTHORITY.AUTHORITATIVE,
    refreshClass: BDP_REFRESH_CLASS.ANNUAL,
    onDemandRefresh: false,
    cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
    notes: 'Maintain a local Texas spatial copy and replace it on the official annual refresh.',
  }),
  localOrdinances: Object.freeze({
    id: 'local-ordinances',
    label: 'Local ordinances / comprehensive plans',
    method: BDP_SOURCE_METHOD.DOCUMENT_FEED,
    authority: BDP_AUTHORITY.AUTHORITATIVE,
    refreshClass: BDP_REFRESH_CLASS.WEEKLY,
    onDemandRefresh: true,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    notes: 'Use municipal code feeds, published agendas, plan repositories, and change checks; permitted page retrieval is a fallback only.',
  }),
});

export function getBdpSourcePolicy(id) {
  return Object.values(BDP_DATA_SOURCES).find((source) => source.id === id) || null;
}
