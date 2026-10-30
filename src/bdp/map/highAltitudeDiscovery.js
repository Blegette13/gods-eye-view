import { normalizeTravisFeature, TRAVIS_PARCEL_LAYER_URL } from '../cad/travisAdapter.js';
import { reviewLandCriteria } from '../acquisition/session.js';
import { radiusEnvelope } from './discoveryGeography.js';
import { suggestViewportParcels } from './candidateHints.js';

/**
 * Guided SEARCH PREVIEW independent of zoom/viewport rendering.
 * Only Travis is connected in this pilot: queries the county source directly
 * with a server-side acre predicate + optionally a Census-centered envelope.
 * Deliberately capped; this is NOT an exhaustive county/radius inventory.
 */
export const HIGH_ALTITUDE_DISCOVERY_COUNTIES = Object.freeze(['Travis']);
export const COUNTY_SAMPLE_LIMIT = 80;

export function buildTravisDiscoveryUrl(criteria, center, limit = COUNTY_SAMPLE_LIMIT) {
  if (criteria?.county !== 'Travis') throw new Error('Travis high-altitude pilot only');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid query sample limit');
  const min = criteria.acresMin;
  const max = criteria.acresMax;
  const pred = ['PROP_ID IS NOT NULL'];
  if (min !== null && min !== undefined && min > 0) pred.push(`tcad_acres >= ${Number(min)}`);
  if (max !== null && max !== undefined && max > 0) pred.push(`tcad_acres <= ${Number(max)}`);
  const qs = new URLSearchParams({
    f: 'geojson',
    outFields: [
      'OBJECTID','PROP_ID','geo_id','py_owner_name','py_address','situs_address',
      'legal_desc','tcad_acres','GIS_acres','market_value','assessed_val',
      'appraised_val','imprv_homesite_val','imprv_non_homesite_val',
      'land_homesite_val','land_non_homesite_val','deed_num','deed_date',
    ].join(','),
    returnGeometry: 'true', outSR: '4326',
    where: pred.join(' AND '),
    orderByFields: 'OBJECTID',
    resultRecordCount: String(limit + 1),
  });
  if (criteria.radiusMiles > 0) {
    const box = radiusEnvelope(center, criteria.radiusMiles);
    if (!box) throw new Error('Census county internal point required for radius search');
    qs.set('geometry', [box.west, box.south, box.east, box.north].join(','));
    qs.set('geometryType', 'esriGeometryEnvelope');
    qs.set('inSR', '4326');
    qs.set('spatialRel', 'esriSpatialRelIntersects');
  }
  return `${TRAVIS_PARCEL_LAYER_URL}/query?${qs.toString()}`;
}

export async function fetchHighAltitudeDiscovery({
  criteria, center, signal, limit = COUNTY_SAMPLE_LIMIT, fetcher = fetch,
} = {}) {
  if (!HIGH_ALTITUDE_DISCOVERY_COUNTIES.includes(criteria?.county)) {
    return Object.freeze({ state: 'unsupported', county: criteria?.county || null, results: [],
      scanned: 0, complete: false, message: 'High-altitude source discovery is currently enabled for Travis County only; other pilots retain manual map-view parcel exploration.' });
  }
  const url = buildTravisDiscoveryUrl(criteria, center, limit);
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(`County discovery service returned HTTP ${response.status}`);
  const data = await response.json();
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.error) {
    throw new Error('County parcel discovery returned invalid GeoJSON; no complete candidate sample is available');
  }
  if (data.features.length > limit + 1) {
    throw new Error('County source exceeded the hard discovery sample response bound');
  }
  let unidentifiable = 0;
  const normalized = [];
  for (const feature of data.features.slice(0, limit)) {
    const parcel = normalizeTravisFeature(feature);
    if (parcel) normalized.push(parcel);
    else unidentifiable++;
  }
  // A query of this size is NEVER described as an exhaustive statewide/county
  // scan, even if a server returns fewer than the requested capped page.
  const seen = new Set();
  const results = [];
  const recordMatches = suggestViewportParcels({
    criteria, center, parcels: normalized, limit,
  });
  for (const item of recordMatches) {
    const key = item.county + ':' + item.parcelId;
    if (seen.has(key)) continue;
    seen.add(key);
    const record = normalized.find((parcel) => parcel.county === item.county && parcel.parcelId === item.parcelId);
    const evidence = reviewLandCriteria(criteria, {
      address: record?.property?.situsAddress, acresReported: record?.property?.acres,
    });
    results.push(Object.freeze({
      ...item,
      acresReported: record?.property?.acres ?? null,
      source: record?.source?.provider || 'Travis County GIS / TCAD',
      confirmedCriteria: evidence.filter((f) => f.status === 'reported-match').map((f) => f.field),
    }));
  }
  const possiblyMore = data.exceededTransferLimit === true || data.features.length > limit;
  const message = results.length
    ? `${results.length} provisional matches in ${data.features.length} source records sampled countywide${possiblyMore ? ' (additional source records may exist)' : ''}. Not an exhaustive inventory.`
    : `No provisional matches in ${data.features.length} sampled source records; more properties may exist outside this sample.`;
  return Object.freeze({
    state: 'sample', county: 'Travis', complete: false,
    returned: data.features.length, sampled: Math.min(data.features.length, limit),
    unidentifiable, possiblyMore, results: Object.freeze(results), message,
  });
}
