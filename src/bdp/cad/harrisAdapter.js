import { normalizeParcel, validateParcel } from '../parcels/parcelSchema.js';

export const HARRIS_COUNTY_FIPS = '48201';
export const HARRIS_PARCEL_LAYER_URL = 'https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0';
export const HARRIS_PARCEL_FIELDS = ['OBJECTID', 'HCAD_NUM', 'LOWPARCELID', 'acct_num', 'tax_year',
  'owner_name_1', 'owner_name_2', 'owner_name_3', 'mail_addr_1', 'mail_addr_2',
  'mail_city', 'mail_state', 'mail_zip', 'site_str_pfx', 'site_str_num', 'site_str_num_sfx',
  'site_str_name', 'site_str_sfx', 'site_str_sfx_dir', 'site_city', 'site_county', 'site_zip',
  'legal_dscr_1', 'legal_dscr_2', 'legal_dscr_3', 'legal_dscr_4', 'Acreage',
  'land_value', 'total_market_val', 'total_appraised_val', 'state_class', 'Stacked', 'CONDO_FLAG'].join(',');
const clean = (value) => String(value ?? '').trim();
const numberOrNull = (value) => {
  if (!['number', 'string'].includes(typeof value) || !clean(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
function identifier(value) {
  const raw = clean(value);
  if (!/^\d{13}$/.test(raw)) throw new Error('Harris parcel/account ID must contain 13 digits');
  return raw;
}
function owner(value) {
  const raw = clean(value);
  if (raw.length < 2 || raw.length > 70 || !/^[A-Za-z0-9&.,'() -]+$/.test(raw)) throw new Error('Invalid Harris owner search');
  return raw;
}
function limitWithin(value, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, maximum) : fallback;
}
function publishedAcres(value) {
  const match = clean(value).match(/^([\d,]+(?:\.\d+)?)\s*(?:AC|ACRE|ACRES)\.?$/i);
  return match ? numberOrNull(match[1].replaceAll(',', '')) : null;
}
const join = (values) => values.map(clean).filter(Boolean).join(' ');

export function normalizeHarrisFeature(feature) {
  const p = feature?.properties || {};
  const parcelId = clean(p.HCAD_NUM);
  if (!/^\d{13}$/.test(parcelId) || !['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
    || (clean(p.acct_num) && clean(p.acct_num) !== parcelId)
    || (clean(p.site_county) && clean(p.site_county).toUpperCase() !== 'HARRIS')) return null;
  const acres = publishedAcres(p.Acreage);
  const marketValue = numberOrNull(p.total_market_val);
  const parcel = normalizeParcel({
    id: `${HARRIS_COUNTY_FIPS}:${parcelId}`, parcelId, county: 'Harris', countyFips: HARRIS_COUNTY_FIPS,
    owner: { name: [...new Set([p.owner_name_1, p.owner_name_2, p.owner_name_3].map(clean).filter(Boolean))].join('; '),
      mailingAddress: join([p.mail_addr_1, p.mail_addr_2, p.mail_city, p.mail_state, p.mail_zip]) },
    property: { situsAddress: join([p.site_str_pfx, numberOrNull(p.site_str_num) > 0 ? p.site_str_num : '',
      p.site_str_num_sfx, p.site_str_name, p.site_str_sfx, p.site_str_sfx_dir, p.site_city, p.site_zip]),
      legalDescription: join([p.legal_dscr_1, p.legal_dscr_2, p.legal_dscr_3, p.legal_dscr_4]),
      acres, geometry: feature.geometry },
    valuation: { landValue: numberOrNull(p.land_value), marketValue, improvementValue: null, assessedValue: null },
    acquisition: { askingPrice: null, verifiedSalePrice: null, estimatedValue: marketValue,
      pricePerAcre: acres > 0 && marketValue !== null ? marketValue / acres : null },
    source: { cad: 'Harris Central Appraisal District', provider: 'Harris County GIS / HCAD',
      recordUrl: HARRIS_PARCEL_LAYER_URL, lastVerified: new Date().toISOString(), recordCurrency: 'unverified',
      sourceNotice: 'County-hosted HCAD geometry, owner names, tax year, acreage and appraisal values are source observations. Tax year is not record currency or verified title. Stacked/condominium accounts can share geometry; do not sum account acreage as distinct land. Verify with current HCAD records and title/survey evidence.' },
  });
  parcel.providerData = { objectId: numberOrNull(p.OBJECTID), accountNumber: clean(p.acct_num),
    lowestParcelId: clean(p.LOWPARCELID), taxYear: /^\d{4}$/.test(clean(p.tax_year)) ? Number(p.tax_year) : null,
    propertyUse: clean(p.state_class), statedArea: clean(p.Acreage),
    publishedAppraisedValue: numberOrNull(p.total_appraised_val), stacked: p.Stacked ?? null,
    condoFlag: clean(p.CONDO_FLAG) };
  return validateParcel(parcel).length ? null : parcel;
}

function queryUrl(params) {
  return `${HARRIS_PARCEL_LAYER_URL}/query?${new URLSearchParams({ outFields: HARRIS_PARCEL_FIELDS,
    returnGeometry: 'true', outSR: '4326', f: 'geojson', ...params })}`;
}
export function buildHarrisParcelLookupUrl(value) {
  return queryUrl({ where: `HCAD_NUM='${identifier(value)}'`, resultRecordCount: '6', orderByFields: 'OBJECTID' });
}
export function buildHarrisOwnerLookupUrl(value, { limit = 100 } = {}) {
  const term = owner(value).replaceAll("'", "''");
  return queryUrl({ where: ['owner_name_1', 'owner_name_2', 'owner_name_3']
    .map((field) => `${field} LIKE '%${term}%'`).join(' OR '),
    resultRecordCount: String(limitWithin(limit, 250, 100) + 1), orderByFields: 'OBJECTID' });
}
export function buildHarrisBoundsUrl({ west, south, east, north, limit = 500 }) {
  const values = [west, south, east, north];
  const coords = values.map(Number);
  if (values.some((value) => !['string', 'number'].includes(typeof value) || clean(value) === '')
    || coords.some((value) => !Number.isFinite(value)) || coords[0] >= coords[2] || coords[1] >= coords[3]
    || Math.abs(coords[0]) > 180 || Math.abs(coords[2]) > 180 || Math.abs(coords[1]) > 90 || Math.abs(coords[3]) > 90)
    throw new Error('Invalid WGS84 bounds');
  return queryUrl({ where: '1=1', geometry: coords.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', resultRecordCount: String(limitWithin(limit, 999, 500) + 1),
    orderByFields: 'OBJECTID' });
}
async function fetchFeatures(url, limit, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Harris parcel service returned HTTP ${response.status}`);
  const data = await response.json();
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)
    || data.exceededTransferLimit === true || data.properties?.exceededTransferLimit === true
    || data.data?.properties?.exceededTransferLimit === true)
    throw new Error('Harris parcel service returned malformed or truncated GeoJSON');
  if (data.features.length > limit) throw new Error('Harris parcel result exceeds bounded request; narrow the search');
  const parcels = data.features.map(normalizeHarrisFeature);
  if (parcels.some((parcel) => !parcel) || new Set(parcels.map((parcel) => parcel.id)).size !== parcels.length)
    throw new Error('Harris parcel result has invalid geometry, conflicting identifiers or repeated parcel IDs');
  return parcels;
}
export const harrisCadAdapter = Object.freeze({
  id: 'harris-cad', county: 'Harris', countyFips: HARRIS_COUNTY_FIPS,
  source: 'Harris County GIS / HCAD', sourceUrl: HARRIS_PARCEL_LAYER_URL,
  async fetchParcel(value, options = {}) {
    const parcels = await fetchFeatures(buildHarrisParcelLookupUrl(value), 5, options);
    return parcels.find((parcel) => parcel.parcelId === identifier(value)) || null;
  },
  async fetchParcelsByOwner(value, options = {}) {
    const limit = limitWithin(options.limit, 250, 100);
    return fetchFeatures(buildHarrisOwnerLookupUrl(value, { limit }), limit, options);
  },
  async fetchParcelsInBounds(bounds, options = {}) {
    const limit = limitWithin(options.limit, 999, 500);
    return fetchFeatures(buildHarrisBoundsUrl({ ...bounds, limit }), limit, options);
  },
});
export default harrisCadAdapter;
