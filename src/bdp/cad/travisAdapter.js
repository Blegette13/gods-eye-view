import { normalizeParcel, validateParcel } from '../parcels/parcelSchema.js';

export const TRAVIS_COUNTY_FIPS = '48453';
export const TRAVIS_PARCEL_LAYER_URL = 'https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_Travis_County_Property/MapServer/3';
const QUERY_URL = `${TRAVIS_PARCEL_LAYER_URL}/query`;
const FIELDS = ['OBJECTID', 'PROP_ID', 'geo_id', 'py_owner_name', 'py_address', 'situs_address', 'legal_desc', 'tcad_acres', 'GIS_acres', 'market_value', 'assessed_val', 'appraised_val', 'imprv_homesite_val', 'imprv_non_homesite_val', 'land_homesite_val', 'land_non_homesite_val', 'deed_num', 'deed_date'].join(',');

const clean = (value) => String(value ?? '').trim();
function numberOrNull(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || clean(value) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeTravisFeature(feature) {
  const p = feature?.properties || feature?.attributes || {};
  const parcelId = clean(p.PROP_ID);
  if (!/^\d+$/.test(parcelId) || !['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) return null;
  const acres = numberOrNull(p.tcad_acres) ?? numberOrNull(p.GIS_acres);
  const marketValue = numberOrNull(p.market_value);
  const improvementHome = numberOrNull(p.imprv_homesite_val);
  const improvementOther = numberOrNull(p.imprv_non_homesite_val);
  const improvement = improvementHome === null && improvementOther === null ? null : (improvementHome ?? 0) + (improvementOther ?? 0);
  const landHome = numberOrNull(p.land_homesite_val);
  const landOther = numberOrNull(p.land_non_homesite_val);
  const landValue = landHome === null && landOther === null ? null : (landHome ?? 0) + (landOther ?? 0);
  const parcel = normalizeParcel({
    id: `${TRAVIS_COUNTY_FIPS}:${parcelId}`, parcelId, county: 'Travis', countyFips: TRAVIS_COUNTY_FIPS,
    owner: { name: clean(p.py_owner_name), mailingAddress: clean(p.py_address) },
    property: { situsAddress: clean(p.situs_address), legalDescription: clean(p.legal_desc), acres, geometry: feature.geometry },
    valuation: { landValue, improvementValue: improvement, marketValue, assessedValue: numberOrNull(p.assessed_val) },
    acquisition: { askingPrice: null, verifiedSalePrice: null, estimatedValue: marketValue,
      pricePerAcre: acres > 0 && marketValue !== null ? marketValue / acres : null },
    source: { cad: 'Travis Central Appraisal District', provider: 'Travis County GIS / TCAD', recordUrl: TRAVIS_PARCEL_LAYER_URL,
      lastVerified: new Date().toISOString(), recordCurrency: 'unverified',
      sourceNotice: 'County GIS reflects TCAD data. Retrieval time does not establish current ownership, deed status, boundaries or appraisal currency. Verify against TCAD and recorded title/survey evidence.' },
  });
  parcel.providerData = { objectId: numberOrNull(p.OBJECTID), geoId: clean(p.geo_id), deedNumber: clean(p.deed_num),
    deedDate: numberOrNull(p.deed_date) }; // Reference fields are not verified title evidence.
  return validateParcel(parcel).length ? null : parcel;
}

function queryUrl(params) {
  return `${QUERY_URL}?${new URLSearchParams({ outFields: FIELDS, returnGeometry: 'true', outSR: '4326', f: 'geojson', ...params })}`;
}

function identifier(value) {
  const raw = clean(value);
  if (!raw || raw.length > 64 || !/^[A-Za-z0-9._ -]+$/.test(raw)) throw new Error('Invalid Travis parcel/property ID');
  return raw;
}

function owner(value) {
  const raw = clean(value);
  if (raw.length < 2 || raw.length > 70 || !/^[A-Za-z0-9&.,'() -]+$/.test(raw)) throw new Error('Invalid Travis owner search');
  return raw;
}

function limitWithin(value, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, maximum) : fallback;
}

export function buildTravisParcelLookupUrl(value) {
  const raw = identifier(value);
  const escaped = raw.replaceAll("'", "''");
  const clauses = [`geo_id='${escaped}'`];
  if (/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) clauses.unshift(`PROP_ID=${Number(raw)}`);
  return queryUrl({ where: clauses.join(' OR '), resultRecordCount: '6', orderByFields: 'OBJECTID' });
}

export function buildTravisOwnerLookupUrl(value, { limit = 100 } = {}) {
  const raw = owner(value).replaceAll("'", "''");
  return queryUrl({ where: `py_owner_name LIKE '%${raw}%'`, resultRecordCount: String(limitWithin(limit, 250, 100) + 1), orderByFields: 'OBJECTID' });
}

export function buildTravisBoundsUrl({ west, south, east, north, limit = 500 }) {
  const coords = [west, south, east, north].map(Number);
  if (coords.some((item) => !Number.isFinite(item)) || coords[0] >= coords[2] || coords[1] >= coords[3]) throw new Error('Invalid WGS84 bounds');
  return queryUrl({ where: '1=1', geometry: coords.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', resultRecordCount: String(limitWithin(limit, 999, 500) + 1), orderByFields: 'OBJECTID' });
}

async function fetchFeatures(url, limit, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Travis parcel service returned HTTP ${response.status}`);
  const data = await response.json();
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.exceededTransferLimit === true)
    throw new Error('Travis parcel service returned malformed or truncated GeoJSON');
  if (data.features.length > limit) throw new Error('Travis parcel result exceeds bounded request; narrow the search');
  if (data.features.some((item) => !['Polygon', 'MultiPolygon'].includes(item?.geometry?.type) || !/^\d+$/.test(clean(item?.properties?.PROP_ID))))
    throw new Error('Travis parcel result has missing geometry or property ID');
  const parcels = data.features.map(normalizeTravisFeature);
  if (new Set(parcels.map((parcel) => parcel.id)).size !== parcels.length)
    throw new Error('Travis parcel result repeats a property ID; geometry may be incomplete');
  return parcels;
}

export const travisCadAdapter = Object.freeze({
  id: 'travis-cad', county: 'Travis', countyFips: TRAVIS_COUNTY_FIPS,
  source: 'Travis County GIS / TCAD', sourceUrl: TRAVIS_PARCEL_LAYER_URL,
  async fetchParcel(value, options = {}) {
    const features = await fetchFeatures(buildTravisParcelLookupUrl(value), 5, options);
    const raw = identifier(value);
    const exactProperty = /^\d+$/.test(raw) ? features.find((parcel) => parcel.parcelId === String(Number(raw))) : null;
    return exactProperty || features.find((parcel) => parcel.providerData.geoId === raw) || null;
  },
  async fetchParcelsByOwner(value, options = {}) {
    const limit = limitWithin(options.limit, 250, 100);
    return fetchFeatures(buildTravisOwnerLookupUrl(value, { limit }), limit, options);
  },
  async fetchParcelsInBounds(bounds, options = {}) {
    const limit = limitWithin(options.limit, 999, 500);
    return fetchFeatures(buildTravisBoundsUrl({ ...bounds, limit }), limit, options);
  },
});

export default travisCadAdapter;
