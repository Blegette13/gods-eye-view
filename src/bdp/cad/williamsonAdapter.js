import { normalizeParcel, validateParcel } from '../parcels/parcelSchema.js';

export const WILLIAMSON_COUNTY_FIPS = '48491';
export const WILLIAMSON_PARCEL_LAYER_URL = 'https://gis.wilco.org/arcgis/rest/services/public/county_wcad_parcels/MapServer/0';
const FIELDS = ['OBJECTID', 'PropertyID', 'PropertyNumber', 'PARCELID', 'PrimaryOwner', 'MailingAddress', 'PropertyAddress', 'LegalDesc', 'Acres', 'TotalPropMktValue', 'TotalLandMktValue', 'TotalImpMktValue', 'TotalAssessedValue', 'DataDate', 'DateLastChanged'].join(',');
const clean = (value) => String(value ?? '').trim();
const numberOrNull = (value) => {
  if (value === null || value === undefined || typeof value === 'boolean' || clean(value) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export function normalizeWilliamsonFeature(feature) {
  const p = feature?.properties || feature?.attributes || {};
  const parcelId = clean(p.PropertyID);
  if (!/^\d+$/.test(parcelId) || !['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) return null;
  const acres = numberOrNull(p.Acres);
  const marketValue = numberOrNull(p.TotalPropMktValue);
  const parcel = normalizeParcel({
    id: `${WILLIAMSON_COUNTY_FIPS}:${parcelId}`, parcelId, county: 'Williamson', countyFips: WILLIAMSON_COUNTY_FIPS,
    owner: { name: clean(p.PrimaryOwner), mailingAddress: clean(p.MailingAddress) },
    property: { situsAddress: clean(p.PropertyAddress), legalDescription: clean(p.LegalDesc), acres, geometry: feature.geometry },
    valuation: { landValue: numberOrNull(p.TotalLandMktValue), improvementValue: numberOrNull(p.TotalImpMktValue),
      marketValue, assessedValue: numberOrNull(p.TotalAssessedValue) },
    acquisition: { askingPrice: null, verifiedSalePrice: null, estimatedValue: marketValue,
      pricePerAcre: acres > 0 && marketValue !== null ? marketValue / acres : null },
    source: { cad: 'Williamson Central Appraisal District', provider: 'Williamson County GIS / WCAD',
      recordUrl: WILLIAMSON_PARCEL_LAYER_URL, lastVerified: new Date().toISOString(), recordCurrency: 'unverified',
      sourceNotice: 'County GIS service description and update information conflict. Retrieval time and source dates do not establish current ownership, deed status, surveyed boundaries or appraisal currency. Verify with WCAD and recorded title/survey evidence.' },
  });
  parcel.providerData = { objectId: numberOrNull(p.OBJECTID), propertyNumber: clean(p.PropertyNumber),
    mapParcelId: clean(p.PARCELID), dataDate: clean(p.DataDate), dateLastChanged: clean(p.DateLastChanged) };
  return validateParcel(parcel).length ? null : parcel;
}

function queryUrl(params) {
  return `${WILLIAMSON_PARCEL_LAYER_URL}/query?${new URLSearchParams({ outFields: FIELDS, returnGeometry: 'true', outSR: '4326', f: 'geojson', ...params })}`;
}
function identifier(value) {
  const raw = clean(value);
  if (!/^\d{1,20}$/.test(raw)) throw new Error('Invalid Williamson property ID');
  return raw;
}
function owner(value) {
  const raw = clean(value);
  if (raw.length < 2 || raw.length > 70 || !/^[A-Za-z0-9&.,'() -]+$/.test(raw)) throw new Error('Invalid Williamson owner search');
  return raw;
}
function limitWithin(value, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, maximum) : fallback;
}
export function buildWilliamsonParcelLookupUrl(value) {
  return queryUrl({ where: `PropertyID='${identifier(value)}'`, resultRecordCount: '6', orderByFields: 'OBJECTID' });
}
export function buildWilliamsonOwnerLookupUrl(value, { limit = 100 } = {}) {
  return queryUrl({ where: `PrimaryOwner LIKE '%${owner(value).replaceAll("'", "''")}%'`,
    resultRecordCount: String(limitWithin(limit, 250, 100) + 1), orderByFields: 'OBJECTID' });
}
export function buildWilliamsonBoundsUrl({ west, south, east, north, limit = 500 }) {
  const coords = [west, south, east, north].map(Number);
  if (coords.some((item) => !Number.isFinite(item)) || coords[0] >= coords[2] || coords[1] >= coords[3]) throw new Error('Invalid WGS84 bounds');
  return queryUrl({ where: '1=1', geometry: coords.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', resultRecordCount: String(limitWithin(limit, 999, 500) + 1), orderByFields: 'OBJECTID' });
}
async function fetchFeatures(url, limit, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Williamson parcel service returned HTTP ${response.status}`);
  const data = await response.json();
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.exceededTransferLimit === true)
    throw new Error('Williamson parcel service returned malformed or truncated GeoJSON');
  if (data.features.length > limit) throw new Error('Williamson parcel result exceeds bounded request; narrow the search');
  if (data.features.some((item) => !['Polygon', 'MultiPolygon'].includes(item?.geometry?.type) || !/^\d+$/.test(clean(item?.properties?.PropertyID))))
    throw new Error('Williamson parcel result has missing geometry or property ID');
  const parcels = data.features.map(normalizeWilliamsonFeature);
  if (parcels.some((parcel) => !parcel) || new Set(parcels.map((parcel) => parcel.id)).size !== parcels.length)
    throw new Error('Williamson parcel result repeats a property ID or failed normalization');
  return parcels;
}

export const williamsonCadAdapter = Object.freeze({
  id: 'williamson-cad', county: 'Williamson', countyFips: WILLIAMSON_COUNTY_FIPS,
  source: 'Williamson County GIS / WCAD', sourceUrl: WILLIAMSON_PARCEL_LAYER_URL,
  async fetchParcel(value, options = {}) {
    const features = await fetchFeatures(buildWilliamsonParcelLookupUrl(value), 5, options);
    return features.find((parcel) => parcel.parcelId === identifier(value)) || null;
  },
  async fetchParcelsByOwner(value, options = {}) {
    const limit = limitWithin(options.limit, 250, 100);
    return fetchFeatures(buildWilliamsonOwnerLookupUrl(value, { limit }), limit, options);
  },
  async fetchParcelsInBounds(bounds, options = {}) {
    const limit = limitWithin(options.limit, 999, 500);
    return fetchFeatures(buildWilliamsonBoundsUrl({ ...bounds, limit }), limit, options);
  },
});
export default williamsonCadAdapter;
