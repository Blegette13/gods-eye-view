import { normalizeParcel, validateParcel } from '../parcels/parcelSchema.js';

export const BEXAR_COUNTY_FIPS = '48029';
export const BEXAR_PARCEL_LAYER_URL = 'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0';
export const BEXAR_PARCEL_QUERY_URL = `${BEXAR_PARCEL_LAYER_URL}/query`;

const OUT_FIELDS = [
  'OBJECTID',
  'PropID',
  'Situs',
  'Owner',
  'AddrLn1',
  'AddrLn2',
  'AddrLn3',
  'AddrCity',
  'AddrSt',
  'Country',
  'Zip',
  'Zip4',
  'AcctNumb',
  'LglDesc',
  'LandVal',
  'ImprVal',
  'TotVal',
  'LglAcres',
  'Acres',
  'TaxUnits',
  'Exempts',
  'PropUse',
].join(',');

function clean(value) {
  return String(value ?? '').trim();
}

function mailingAddress(properties = {}) {
  const street = [properties.AddrLn1, properties.AddrLn2, properties.AddrLn3]
    .map(clean)
    .filter(Boolean)
    .join(', ');
  const cityStateZip = [
    clean(properties.AddrCity),
    clean(properties.AddrSt),
    [clean(properties.Zip), clean(properties.Zip4)].filter(Boolean).join('-'),
  ].filter(Boolean).join(' ');
  return [street, cityStateZip].filter(Boolean).join(', ');
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeBexarFeature(feature) {
  const properties = feature?.properties || feature?.attributes || {};
  const parcelId = clean(properties.PropID || properties.AcctNumb);
  const acres = finite(properties.Acres) ?? finite(properties.LglAcres);
  const totalValue = finite(properties.TotVal);

  const parcel = normalizeParcel({
    id: `${BEXAR_COUNTY_FIPS}:${parcelId}`,
    parcelId,
    county: 'Bexar',
    countyFips: BEXAR_COUNTY_FIPS,
    owner: {
      name: clean(properties.Owner),
      mailingAddress: mailingAddress(properties),
    },
    property: {
      situsAddress: clean(properties.Situs),
      legalDescription: clean(properties.LglDesc),
      acres,
      geometry: feature?.geometry || null,
    },
    valuation: {
      landValue: finite(properties.LandVal),
      improvementValue: finite(properties.ImprVal),
      marketValue: totalValue,
      assessedValue: totalValue,
    },
    acquisition: {
      askingPrice: null,
      verifiedSalePrice: null,
      estimatedValue: totalValue,
      pricePerAcre: acres && totalValue ? totalValue / acres : null,
    },
    jurisdiction: {
      city: '',
      county: 'Bexar',
      etj: '',
      schoolDistrict: '',
    },
    source: {
      cad: 'Bexar County Appraisal District',
      provider: 'Bexar County ArcGIS REST',
      recordUrl: BEXAR_PARCEL_LAYER_URL,
      lastVerified: new Date().toISOString(),
      recordCurrency: 'unverified',
      sourceNotice: 'County GIS metadata contains legacy update text. Verify current ownership and valuation with BCAD/current deed records before acquisition decisions.',
    },
  });

  parcel.providerData = {
    objectId: finite(properties.OBJECTID),
    accountNumber: clean(properties.AcctNumb),
    taxUnits: clean(properties.TaxUnits),
    exemptions: clean(properties.Exempts),
    propertyUse: clean(properties.PropUse),
  };

  return parcel;
}

function queryUrl(params) {
  const search = new URLSearchParams({
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
    ...params,
  });
  return `${BEXAR_PARCEL_QUERY_URL}?${search.toString()}`;
}

function sanitizeParcelLookup(value) {
  const raw = clean(value);
  if (!raw || raw.length > 64) throw new Error('A valid Bexar parcel/account id is required');
  if (!/^[A-Za-z0-9._ -]+$/.test(raw)) throw new Error('Bexar parcel/account id contains unsupported characters');
  return raw;
}

function sanitizeOwnerLookup(value) {
  const raw = clean(value);
  if (raw.length < 2 || raw.length > 70) throw new Error('Bexar owner search must contain 2-70 characters');
  if (!/^[A-Za-z0-9&.,'() -]+$/.test(raw)) throw new Error('Bexar owner search contains unsupported characters');
  return raw;
}

export function buildBexarParcelLookupUrl(parcelOrAccountId) {
  const raw = sanitizeParcelLookup(parcelOrAccountId);
  const escaped = raw.replaceAll("'", "''");
  const numeric = /^\d+(?:\.0+)?$/.test(raw) ? Number(raw) : null;
  const clauses = [`AcctNumb='${escaped}'`];
  if (Number.isFinite(numeric)) clauses.unshift(`PropID=${numeric}`);
  return queryUrl({
    where: clauses.join(' OR '),
    resultRecordCount: '5',
  });
}

export function buildBexarOwnerLookupUrl(ownerName, { limit = 100 } = {}) {
  const raw = sanitizeOwnerLookup(ownerName);
  const escaped = raw.replaceAll("'", "''");
  const recordLimit = Math.max(1, Math.min(250, Math.floor(Number(limit) || 100)));
  return queryUrl({
    where: `Owner LIKE '%${escaped}%'`,
    orderByFields: 'Acres DESC',
    resultRecordCount: String(recordLimit),
  });
}

export function buildBexarBoundsUrl({ west, south, east, north, limit = 1000 }) {
  const values = [west, south, east, north].map(Number);
  if (values.some((value) => !Number.isFinite(value))) throw new Error('Finite WGS84 bounds are required');
  if (west >= east || south >= north) throw new Error('Invalid WGS84 bounds');
  const recordLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 1000)));
  return queryUrl({
    where: '1=1',
    geometry: `${west},${south},${east},${north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    orderByFields: 'OBJECTID',
    resultRecordCount: String(recordLimit),
  });
}

async function fetchGeoJson(url, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Bexar parcel service returned HTTP ${response.status}`);
  const data = await response.json();
  if (!data || !Array.isArray(data.features)) throw new Error('Bexar parcel service returned malformed GeoJSON');
  return data;
}

function normalizeFeatures(geojson) {
  return geojson.features
    .map(normalizeBexarFeature)
    .filter((parcel) => validateParcel(parcel).length === 0);
}

export const bexarCadAdapter = Object.freeze({
  id: 'bexar-cad',
  county: 'Bexar',
  countyFips: BEXAR_COUNTY_FIPS,
  source: 'Bexar County ArcGIS REST / BCAD',
  sourceUrl: BEXAR_PARCEL_LAYER_URL,

  async fetchParcel(parcelOrAccountId, options = {}) {
    const geojson = await fetchGeoJson(buildBexarParcelLookupUrl(parcelOrAccountId), options);
    return normalizeFeatures(geojson)[0] || null;
  },

  async fetchParcelsByOwner(ownerName, options = {}) {
    const geojson = await fetchGeoJson(buildBexarOwnerLookupUrl(ownerName, options), options);
    return normalizeFeatures(geojson);
  },

  async fetchParcelsInBounds(bounds, options = {}) {
    const geojson = await fetchGeoJson(buildBexarBoundsUrl({ ...bounds, limit: options.limit }), options);
    return normalizeFeatures(geojson);
  },
});

export default bexarCadAdapter;
