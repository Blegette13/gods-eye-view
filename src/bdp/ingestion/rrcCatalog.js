import { BDP_REFRESH_CLASS } from '../config/dataSources.js';

export const RRC_DATASET_PAGE_URL =
  'https://www.rrc.texas.gov/resource-center/research/data-sets-available-for-download/';

export const RRC_NATIVE_CRS = Object.freeze({
  datum: 'NAD27',
  axisOrder: 'longitude-latitude',
  units: 'degrees',
});

export const RRC_COUNTY_DATASETS = Object.freeze({
  wells: Object.freeze({
    id: 'rrc-wells',
    filenamePrefix: 'well',
    archiveFormat: 'zip',
    payloadFormat: 'shapefile',
    refreshClass: BDP_REFRESH_CLASS.TWICE_WEEKLY,
    targetTable: 'bdp_rrc_wells',
  }),
  pipelines: Object.freeze({
    id: 'rrc-pipelines',
    filenamePrefix: 'pipeline',
    archiveFormat: 'zip',
    payloadFormat: 'shapefile',
    refreshClass: BDP_REFRESH_CLASS.TWICE_WEEKLY,
    targetTable: 'bdp_rrc_pipelines',
  }),
});

/**
 * Normalize a Texas county FIPS value to the three-digit county component.
 * Accepted examples: 29, '029', '48029'. Texas county FIPS codes are the odd
 * values from 001 through 507 under state FIPS 48.
 */
export function normalizeTexasCountyFips(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,5}$/.test(raw)) throw new Error('Texas county FIPS must be numeric');

  let countyCode;
  if (raw.length === 5) {
    if (!raw.startsWith('48')) throw new Error('Full FIPS must use Texas state code 48');
    countyCode = raw.slice(2);
  } else {
    countyCode = raw.padStart(3, '0');
  }

  const numeric = Number(countyCode);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 507 || numeric % 2 === 0) {
    throw new Error(`Invalid Texas county FIPS: ${value}`);
  }

  return countyCode;
}

export function getRrcCountyDataset(dataset) {
  const spec = RRC_COUNTY_DATASETS[String(dataset || '').trim().toLowerCase()];
  if (!spec) throw new Error(`Unsupported RRC county dataset: ${dataset}`);
  return spec;
}

export function buildRrcCountyArchiveName(dataset, countyFips) {
  const spec = getRrcCountyDataset(dataset);
  const countyCode = normalizeTexasCountyFips(countyFips);
  return `${spec.filenamePrefix}${countyCode}.${spec.archiveFormat}`;
}

/**
 * Build deterministic ingestion work without coupling the browser application
 * to RRC's file-transfer UI. A backend worker resolves each filename against
 * the official RRC bulk-download source, records checksum/modified metadata,
 * then imports the shapefile into PostGIS.
 */
export function createRrcCountyIngestionPlan({
  countyFips,
  datasets = ['wells', 'pipelines'],
} = {}) {
  const counties = Array.isArray(countyFips) ? countyFips : [countyFips];
  const normalizedCounties = [...new Set(counties.map(normalizeTexasCountyFips))];

  return normalizedCounties.flatMap((countyCode) => datasets.map((dataset) => {
    const spec = getRrcCountyDataset(dataset);
    return Object.freeze({
      sourceId: spec.id,
      dataset,
      countyFips: countyCode,
      fullFips: `48${countyCode}`,
      filename: buildRrcCountyArchiveName(dataset, countyCode),
      sourcePageUrl: RRC_DATASET_PAGE_URL,
      refreshClass: spec.refreshClass,
      archiveFormat: spec.archiveFormat,
      payloadFormat: spec.payloadFormat,
      nativeCrs: RRC_NATIVE_CRS,
      targetTable: spec.targetTable,
      provenanceRequired: true,
    });
  }));
}
