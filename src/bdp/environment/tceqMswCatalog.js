import { BDP_REFRESH_CLASS } from '../config/dataSources.js';

export const TCEQ_MSW_DATA_PAGE_URL =
  'https://www.tceq.texas.gov/permitting/waste_permits/msw_permits/msw-data';
export const TCEQ_MSW_FIELD_GUIDE_URL =
  'https://www.tceq.texas.gov/downloads/permitting/waste-permits/publications/gi-613-description-of-fields-msw-data-files.pdf';
export const TCEQ_MSW_VIEWER_URL =
  'https://www.tceq.texas.gov/gis/msw-viewer';

export const TCEQ_MSW_DATASETS = Object.freeze({
  facilities: Object.freeze({
    id: 'tceq-msw-facilities',
    dataset: 'facilities',
    filename: 'msw-facilities-texas.xls',
    url: 'https://www.tceq.texas.gov/assets/public/permitting/waste/msw/msw-facilities-texas.xls',
    format: 'xls',
    historical: false,
    refreshClass: BDP_REFRESH_CLASS.WEEKLY,
  }),
  closed: Object.freeze({
    id: 'tceq-msw-closed',
    dataset: 'closed',
    filename: 'msw-closed-facilities-texas.xls',
    url: 'https://www.tceq.texas.gov/assets/public/permitting/waste/msw/msw-closed-facilities-texas.xls',
    format: 'xls',
    historical: true,
    refreshClass: BDP_REFRESH_CLASS.WEEKLY,
  }),
  revoked: Object.freeze({
    id: 'tceq-msw-revoked',
    dataset: 'revoked',
    filename: 'msw-revoked-or-not-issued-texas.xls',
    url: 'https://www.tceq.texas.gov/assets/public/permitting/waste/msw/msw-revoked-or-not-issued-texas.xls',
    format: 'xls',
    historical: true,
    refreshClass: BDP_REFRESH_CLASS.WEEKLY,
  }),
  unnumbered: Object.freeze({
    id: 'tceq-msw-unnumbered',
    dataset: 'unnumbered',
    filename: 'msw-unum-texas.xlsx',
    url: 'https://www.tceq.texas.gov/downloads/permitting/waste-permits/msw/docs/msw-unum-texas.xlsx',
    format: 'xlsx',
    historical: true,
    refreshClass: BDP_REFRESH_CLASS.ON_DEMAND,
  }),
});

export function getTceqMswDataset(dataset) {
  const key = String(dataset || '').trim().toLowerCase();
  const spec = TCEQ_MSW_DATASETS[key];
  if (!spec) throw new Error(`Unsupported TCEQ MSW dataset: ${dataset}`);
  return spec;
}

export function createTceqMswIngestionPlan({
  datasets = ['facilities', 'closed', 'revoked', 'unnumbered'],
} = {}) {
  const requested = Array.isArray(datasets) ? datasets : [datasets];
  return [...new Set(requested.map((value) => String(value).trim().toLowerCase()))]
    .map((dataset) => {
      const spec = getTceqMswDataset(dataset);
      return Object.freeze({
        ...spec,
        sourcePageUrl: TCEQ_MSW_DATA_PAGE_URL,
        fieldGuideUrl: TCEQ_MSW_FIELD_GUIDE_URL,
        viewerUrl: TCEQ_MSW_VIEWER_URL,
        targetTable: 'bdp_tceq_msw_sites',
        provenanceRequired: true,
      });
    });
}
