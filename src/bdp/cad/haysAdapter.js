import { normalizeParcel, validateParcel } from '../parcels/parcelSchema.js';

export const HAYS_COUNTY_FIPS = '48209';
export const HAYS_PARCEL_LAYER_URL = 'https://services6.arcgis.com/XnTA1N5QxtOFa9o8/ArcGIS/rest/services/CODS_Public_Map/FeatureServer/6';
const FIELDS = ['OBJECTID', 'Prop_ID', 'GEO_ID', 'OWNER_NAME', 'LEGAL_AREA', 'LGL_AREA_U',
  'LEGAL_DESC', 'LAND_VALUE', 'IMP_VALUE', 'MKT_VALUE', 'SITUS_ADDR', 'MAIL_ADDR',
  'SOURCE', 'DATE_ACQ', 'FIPS', 'COUNTY', 'TAX_YEAR'].join(',');
const clean = (value) => String(value ?? '').trim();
const numberOrNull = (value) => {
  if (value === null || value === undefined || typeof value === 'boolean' || clean(value) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
function identifier(value) {
  const raw = clean(value);
  if (!/^\d{1,10}$/.test(raw)) throw new Error('Invalid Hays property ID');
  return raw;
}
function owner(value) {
  const raw = clean(value);
  if (raw.length < 2 || raw.length > 70 || !/^[A-Za-z0-9&.,'() -]+$/.test(raw)) throw new Error('Invalid Hays owner search');
  return raw;
}
function limitWithin(value, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, maximum) : fallback;
}

export function normalizeHaysFeature(feature) {
  const p = feature?.properties || {};
  const parcelId = clean(p.Prop_ID);
  if (!/^\d{1,10}$/.test(parcelId) || !['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
    || (clean(p.FIPS) && clean(p.FIPS) !== HAYS_COUNTY_FIPS)) return null;
  const acres = clean(p.LGL_AREA_U).toLowerCase() === 'acres' ? numberOrNull(p.LEGAL_AREA) : null;
  const marketValue = numberOrNull(p.MKT_VALUE);
  const parcel = normalizeParcel({
    id: `${HAYS_COUNTY_FIPS}:${parcelId}`, parcelId, county: 'Hays', countyFips: HAYS_COUNTY_FIPS,
    owner: { name: clean(p.OWNER_NAME), mailingAddress: clean(p.MAIL_ADDR) },
    property: { situsAddress: clean(p.SITUS_ADDR), legalDescription: clean(p.LEGAL_DESC), acres, geometry: feature.geometry },
    valuation: { landValue: numberOrNull(p.LAND_VALUE), improvementValue: numberOrNull(p.IMP_VALUE),
      marketValue, assessedValue: null },
    acquisition: { askingPrice: null, verifiedSalePrice: null, estimatedValue: marketValue,
      pricePerAcre: acres > 0 && marketValue !== null ? marketValue / acres : null },
    source: { cad: 'Hays Central Appraisal District', provider: 'TNRIS / CODS public Hays CAD copy',
      recordUrl: HAYS_PARCEL_LAYER_URL, lastVerified: new Date().toISOString(), recordCurrency: 'stale',
      sourceNotice: 'This public Hays CAD copy was acquired by TNRIS in February 2022; its parcel tax year is historical. It supports map screening, but current owner, value, parcel geometry, deed and survey status must be checked against current Hays CAD and recorded documents.' },
  });
  parcel.providerData = { objectId: numberOrNull(p.OBJECTID), geoId: clean(p.GEO_ID),
    taxYear: numberOrNull(p.TAX_YEAR), dateAcquired: numberOrNull(p.DATE_ACQ), source: clean(p.SOURCE) };
  return validateParcel(parcel).length ? null : parcel;
}

function queryUrl(params) {
  return `${HAYS_PARCEL_LAYER_URL}/query?${new URLSearchParams({ outFields: FIELDS,
    returnGeometry: 'true', outSR: '4326', f: 'geojson', ...params })}`;
}
export function buildHaysParcelLookupUrl(value) {
  return queryUrl({ where: `Prop_ID='${identifier(value)}'`, resultRecordCount: '6', orderByFields: 'OBJECTID' });
}
export function buildHaysOwnerLookupUrl(value, { limit = 100 } = {}) {
  return queryUrl({ where: `OWNER_NAME LIKE '%${owner(value).replaceAll("'", "''")}%'`,
    resultRecordCount: String(limitWithin(limit, 250, 100) + 1), orderByFields: 'OBJECTID' });
}
export function buildHaysBoundsUrl({ west, south, east, north, limit = 500 }) {
  const coords = [west, south, east, north].map(Number);
  if (coords.some((item) => !Number.isFinite(item)) || coords[0] >= coords[2] || coords[1] >= coords[3])
    throw new Error('Invalid WGS84 bounds');
  return queryUrl({ where: '1=1', geometry: coords.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', resultRecordCount: String(limitWithin(limit, 999, 500) + 1),
    orderByFields: 'OBJECTID' });
}
async function fetchFeatures(url, limit, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Hays parcel service returned HTTP ${response.status}`);
  const data = await response.json();
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)
    || data.exceededTransferLimit === true || data.properties?.exceededTransferLimit === true)
    throw new Error('Hays parcel service returned malformed or truncated GeoJSON');
  if (data.features.length > limit) throw new Error('Hays parcel result exceeds bounded request; narrow the search');
  const parcels = data.features.map(normalizeHaysFeature);
  if (parcels.some((parcel) => !parcel) || new Set(parcels.map((parcel) => parcel.id)).size !== parcels.length)
    throw new Error('Hays parcel result has missing geometry, conflicting county ID, or repeated property ID');
  return parcels;
}

export const haysCadAdapter = Object.freeze({
  id: 'hays-cad', county: 'Hays', countyFips: HAYS_COUNTY_FIPS,
  source: 'TNRIS / CODS public Hays CAD copy', sourceUrl: HAYS_PARCEL_LAYER_URL,
  async fetchParcel(value, options = {}) {
    const features = await fetchFeatures(buildHaysParcelLookupUrl(value), 5, options);
    return features.find((parcel) => parcel.parcelId === identifier(value)) || null;
  },
  async fetchParcelsByOwner(value, options = {}) {
    const limit = limitWithin(options.limit, 250, 100);
    return fetchFeatures(buildHaysOwnerLookupUrl(value, { limit }), limit, options);
  },
  async fetchParcelsInBounds(bounds, options = {}) {
    const limit = limitWithin(options.limit, 999, 500);
    return fetchFeatures(buildHaysBoundsUrl({ ...bounds, limit }), limit, options);
  },
});
export default haysCadAdapter;
