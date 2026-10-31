import { BDP_REFRESH_CLASS } from '../config/dataSources.js';

export const TCEQ_WATER_RIGHTS_PAGE_URL =
  'https://www.tceq.texas.gov/permitting/water_rights/wr-permitting/wrwud';
export const TCEQ_WATER_RIGHTS_VIEWER_URL =
  'https://www.tceq.texas.gov/gis/water-rights-viewer';
export const TCEQ_WATER_RIGHTS_VIEWER_ITEM_ID = 'ccf87bc930604daca3c2148baa266434';

export const TCEQ_WATER_RIGHTS_DATASETS = Object.freeze({
  active: Object.freeze({
    id: 'tceq-water-rights-active',
    status: 'active',
    filename: 'wractive.xlsx',
    url: 'https://www.tceq.texas.gov/downloads/permitting/water-rights/pending/wractive.xlsx',
    format: 'xlsx',
    refreshClass: BDP_REFRESH_CLASS.WEEKLY,
    targetTable: 'bdp_tceq_water_rights',
  }),
  inactive: Object.freeze({
    id: 'tceq-water-rights-inactive',
    status: 'inactive',
    filename: 'wrinactive.xlsx',
    url: 'https://www.tceq.texas.gov/downloads/permitting/water-rights/pending/wrinactive.xlsx',
    format: 'xlsx',
    refreshClass: BDP_REFRESH_CLASS.WEEKLY,
    targetTable: 'bdp_tceq_water_rights',
  }),
});

export function getTceqWaterRightsDataset(dataset) {
  const key = String(dataset || '').trim().toLowerCase();
  const spec = TCEQ_WATER_RIGHTS_DATASETS[key];
  if (!spec) throw new Error(`Unsupported TCEQ water-rights dataset: ${dataset}`);
  return spec;
}

/**
 * Build source work for statewide TCEQ surface-water-right records.
 *
 * TCEQ publishes structured active/inactive data files separately from the GIS
 * viewer. BDP treats those files as the authoritative record feed and uses the
 * viewer for spatial verification/context rather than scraping its UI.
 */
export function createTceqWaterRightsIngestionPlan({
  datasets = ['active', 'inactive'],
} = {}) {
  const requested = Array.isArray(datasets) ? datasets : [datasets];
  return [...new Set(requested.map((value) => String(value).trim().toLowerCase()))]
    .map((dataset) => {
      const spec = getTceqWaterRightsDataset(dataset);
      return Object.freeze({
        sourceId: spec.id,
        dataset,
        status: spec.status,
        filename: spec.filename,
        url: spec.url,
        sourcePageUrl: TCEQ_WATER_RIGHTS_PAGE_URL,
        viewerUrl: TCEQ_WATER_RIGHTS_VIEWER_URL,
        viewerItemId: TCEQ_WATER_RIGHTS_VIEWER_ITEM_ID,
        format: spec.format,
        refreshClass: spec.refreshClass,
        targetTable: spec.targetTable,
        provenanceRequired: true,
      });
    });
}
