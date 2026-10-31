import { normalizeParcel, validateParcel } from '../parcels/parcelSchema.js';

export const DALLAS_COUNTY_FIPS = '48113';
export const DALLAS_PARCEL_LAYER_URL = 'https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4';
const FIELDS = ['OBJECTID', 'PARCELID', 'LOWPARCELID', 'OWNERNME1', 'OWNERNME2',
  'PSTLADDRESS', 'SITEADDRESS', 'PRPRTYDSCRP', 'STATEDAREA', 'LNDVALUE',
  'IMPVALUE', 'CNTASSDVAL', 'LASTUPDATE', 'REVALYR'].join(',');
const clean = (value) => String(value ?? '').trim();
const numberOrNull = (value) => {
  if (value === null || value === undefined || typeof value === 'boolean' || clean(value) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
function identifier(value) {
  const raw = clean(value);
  if (!/^\d{1,30}$/.test(raw)) throw new Error('Invalid Dallas parcel ID');
  return raw;
}
function owner(value) {
  const raw = clean(value);
  if (raw.length < 2 || raw.length > 70 || !/^[A-Za-z0-9&.,'() -]+$/.test(raw)) throw new Error('Invalid Dallas owner search');
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

export function normalizeDallasFeature(feature) {
  const p = feature?.properties || {};
  const parcelId = clean(p.PARCELID);
  if (!/^\d{1,30}$/.test(parcelId) || !['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) return null;
  const acres = publishedAcres(p.STATEDAREA);
  const marketValue = numberOrNull(p.CNTASSDVAL);
  const ownerNames = [...new Set([clean(p.OWNERNME1), clean(p.OWNERNME2)].filter(Boolean))];
  const parcel = normalizeParcel({
    id: `${DALLAS_COUNTY_FIPS}:${parcelId}`, parcelId, county: 'Dallas', countyFips: DALLAS_COUNTY_FIPS,
    owner: { name: ownerNames.join('; '), mailingAddress: clean(p.PSTLADDRESS) },
    property: { situsAddress: clean(p.SITEADDRESS), legalDescription: clean(p.PRPRTYDSCRP), acres, geometry: feature.geometry },
    valuation: { landValue: numberOrNull(p.LNDVALUE), improvementValue: numberOrNull(p.IMPVALUE),
      marketValue, assessedValue: null },
    acquisition: { askingPrice: null, verifiedSalePrice: null, estimatedValue: marketValue,
      pricePerAcre: acres > 0 && marketValue !== null ? marketValue / acres : null },
    source: { cad: 'Dallas Central Appraisal District', provider: 'Dallas Central Appraisal District GIS',
      recordUrl: DALLAS_PARCEL_LAYER_URL, lastVerified: new Date().toISOString(), recordCurrency: 'unverified',
      sourceNotice: 'DCAD publishes a parcel query map with owner and appraisal observations. Reported acreage is not surveyed acreage. A revaluation year or GIS update date does not establish current vesting, deed status, surveyed boundaries, or a current asking price. Verify with DCAD and recorded title/survey evidence.' },
  });
  const updated = numberOrNull(p.LASTUPDATE);
  parcel.providerData = { objectId: numberOrNull(p.OBJECTID), lowestParcelId: clean(p.LOWPARCELID),
    revaluationYear: numberOrNull(p.REVALYR), sourceLastUpdate: updated && !Number.isNaN(new Date(updated).getTime())
      ? new Date(updated).toISOString() : null, statedArea: clean(p.STATEDAREA) };
  return validateParcel(parcel).length ? null : parcel;
}

function queryUrl(params) {
  return `${DALLAS_PARCEL_LAYER_URL}/query?${new URLSearchParams({ outFields: FIELDS,
    returnGeometry: 'true', outSR: '4326', f: 'geojson', ...params })}`;
}
export function buildDallasParcelLookupUrl(value) {
  return queryUrl({ where: `PARCELID='${identifier(value)}'`, resultRecordCount: '6', orderByFields: 'OBJECTID' });
}
export function buildDallasOwnerLookupUrl(value, { limit = 100 } = {}) {
  const term = owner(value).replaceAll("'", "''");
  return queryUrl({ where: `OWNERNME1 LIKE '%${term}%' OR OWNERNME2 LIKE '%${term}%'`,
    resultRecordCount: String(limitWithin(limit, 250, 100) + 1), orderByFields: 'OBJECTID' });
}
export function buildDallasBoundsUrl({ west, south, east, north, limit = 500 }) {
  const coords = [west, south, east, north].map(Number);
  if (coords.some((item) => !Number.isFinite(item)) || coords[0] >= coords[2] || coords[1] >= coords[3])
    throw new Error('Invalid WGS84 bounds');
  return queryUrl({ where: '1=1', geometry: coords.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', resultRecordCount: String(limitWithin(limit, 999, 500) + 1),
    orderByFields: 'OBJECTID' });
}
async function fetchFeatures(url, limit, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Dallas parcel service returned HTTP ${response.status}`);
  const data = await response.json();
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)
    || data.exceededTransferLimit === true || data.properties?.exceededTransferLimit === true)
    throw new Error('Dallas parcel service returned malformed or truncated GeoJSON');
  if (data.features.length > limit) throw new Error('Dallas parcel result exceeds bounded request; narrow the search');
  const parcels = data.features.map(normalizeDallasFeature);
  if (parcels.some((parcel) => !parcel) || new Set(parcels.map((parcel) => parcel.id)).size !== parcels.length)
    throw new Error('Dallas parcel result has missing geometry or repeated parcel IDs');
  return parcels;
}

export const dallasCadAdapter = Object.freeze({
  id: 'dallas-cad', county: 'Dallas', countyFips: DALLAS_COUNTY_FIPS,
  source: 'Dallas Central Appraisal District GIS', sourceUrl: DALLAS_PARCEL_LAYER_URL,
  async fetchParcel(value, options = {}) {
    const features = await fetchFeatures(buildDallasParcelLookupUrl(value), 5, options);
    return features.find((parcel) => parcel.parcelId === identifier(value)) || null;
  },
  async fetchParcelsByOwner(value, options = {}) {
    const limit = limitWithin(options.limit, 250, 100);
    return fetchFeatures(buildDallasOwnerLookupUrl(value, { limit }), limit, options);
  },
  async fetchParcelsInBounds(bounds, options = {}) {
    const limit = limitWithin(options.limit, 999, 500);
    return fetchFeatures(buildDallasBoundsUrl({ ...bounds, limit }), limit, options);
  },
});
export default dallasCadAdapter;
