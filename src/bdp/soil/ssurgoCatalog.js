import { BDP_REFRESH_CLASS } from '../config/dataSources.js';

export const SSURGO_PAGE_URL =
  'https://www.nrcs.usda.gov/resources/data-and-reports/soil-survey-geographic-database-ssurgo';
export const SDA_HELP_URL = 'https://sdmdataaccess.nrcs.usda.gov/WebServiceHelp.aspx';
export const SDA_WMS_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Spatial/SDM.wms';
export const SDA_WGS84_WFS_URL =
  'https://sdmdataaccess.sc.egov.usda.gov/Spatial/SDMWGS84Geographic.wfs';
export const SDA_TABULAR_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
export const SSURGO_MAPUNIT_LAYER = 'MapunitPoly';

export const SSURGO_SOURCE = Object.freeze({
  id: 'usda-ssurgo',
  label: 'USDA NRCS SSURGO / Soil Data Access',
  refreshClass: BDP_REFRESH_CLASS.ANNUAL,
  sourcePageUrl: SSURGO_PAGE_URL,
  helpUrl: SDA_HELP_URL,
  wmsUrl: SDA_WMS_URL,
  wfsUrl: SDA_WGS84_WFS_URL,
  tabularUrl: SDA_TABULAR_URL,
  mapunitLayer: SSURGO_MAPUNIT_LAYER,
  provenanceRequired: true,
});

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

export function normalizeSsurgoBounds(input = {}, { maxSpanDegrees = 0.75 } = {}) {
  const bounds = {
    west: finiteNumber(input.west, 'west'),
    south: finiteNumber(input.south, 'south'),
    east: finiteNumber(input.east, 'east'),
    north: finiteNumber(input.north, 'north'),
  };
  if (bounds.west < -180 || bounds.east > 180 || bounds.south < -90 || bounds.north > 90) {
    throw new Error('SSURGO bounds must be valid WGS84 coordinates');
  }
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new Error('SSURGO bounds must have positive width and height');
  }
  if (
    bounds.east - bounds.west > maxSpanDegrees
    || bounds.north - bounds.south > maxSpanDegrees
  ) {
    throw new Error(`SSURGO viewport must be ${maxSpanDegrees} degrees or smaller`);
  }
  return Object.freeze(bounds);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildSsurgoWfsUrl(boundsInput, { maxFeatures = 5000 } = {}) {
  const bounds = normalizeSsurgoBounds(boundsInput);
  const limit = Math.max(1, Math.min(25_000, Math.floor(Number(maxFeatures) || 5000)));
  const filter = `<Filter><BBOX><PropertyName>Geometry</PropertyName><Box srsName='EPSG:4326'><coordinates>${bounds.west},${bounds.south} ${bounds.east},${bounds.north}</coordinates></Box></BBOX></Filter>`;
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '1.1.0',
    REQUEST: 'GetFeature',
    TYPENAME: SSURGO_MAPUNIT_LAYER,
    SRSNAME: 'EPSG:4326',
    OUTPUTFORMAT: 'GML3',
    MAXFEATURES: String(limit),
    FILTER: filter,
  });
  return `${SDA_WGS84_WFS_URL}?${params.toString()}`;
}

export function buildSsurgoMapunitQuery(mukeys) {
  const values = [...new Set((Array.isArray(mukeys) ? mukeys : [mukeys])
    .map((value) => String(value ?? '').trim())
    .filter((value) => /^\d+$/.test(value)))];
  if (!values.length) throw new Error('At least one numeric SSURGO mukey is required');
  if (values.length > 1000) throw new Error('SSURGO mapunit enrichment is limited to 1000 mukeys per request');
  const list = values.map((value) => `'${value}'`).join(',');
  return `SELECT mukey, musym, muname FROM mapunit WHERE mukey IN (${list}) ORDER BY mukey`;
}

export function buildSdaTabularRequest(query) {
  const sql = String(query || '').trim();
  if (!sql) throw new Error('Soil Data Access query is required');
  return Object.freeze({
    url: SDA_TABULAR_URL,
    init: Object.freeze({
      method: 'POST',
      headers: Object.freeze({ 'content-type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({
        SERVICE: 'query',
        REQUEST: 'query',
        QUERY: sql,
        FORMAT: 'JSON+COLUMNNAME',
      }).toString(),
    }),
  });
}

export function buildSsurgoBboxFilterXml(boundsInput) {
  const bounds = normalizeSsurgoBounds(boundsInput);
  return `<Filter><BBOX><PropertyName>Geometry</PropertyName><Box srsName='EPSG:4326'><coordinates>${xmlEscape(bounds.west)},${xmlEscape(bounds.south)} ${xmlEscape(bounds.east)},${xmlEscape(bounds.north)}</coordinates></Box></BBOX></Filter>`;
}
