/**
 * Step 36: read-only official City of Austin ArcGIS jurisdiction relationship
 * diagnostic for a TCAD parcel. No massive city polygon downloads.
 *
 * node scripts/bdp/diagnose-austin-jurisdiction.mjs 302959
 *
 * The results are preliminary GIS candidate evidence, not a legal jurisdiction
 * determination. Never use them to infer zoning/ETJ legal entitlements.
 */
import { travisCadAdapter } from '../../src/bdp/cad/travisAdapter.js';
import {
  buildAustinJurisdictionRelationUrl,
  summarizeAustinJurisdictionRelations,
} from '../../src/bdp/entitlement/austinJurisdictionRelations.js';

const parcelId = process.argv[2] || '302959';
if (!/^\d{1,18}$/.test(parcelId)) throw new Error('Provide numeric Travis TCAD parcel ID');

async function getResponse(url, label) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > 1_000_000) {
    throw new Error(`${label}: attributes-only response too large`);
  }
  let parsed;
  try { parsed = JSON.parse(body); } catch {
    throw new Error(`${label}: non-JSON ArcGIS response`);
  }
  if (parsed?.error) {
    throw new Error(`${label}: ArcGIS error ${parsed.error.code ?? 'unknown'}`);
  }
  return parsed;
}

console.log('BDP · Austin mapped jurisdiction envelope relationships · READ ONLY');
console.log('Geographic screen only; official legal jurisdiction remains UNVERIFIED.');
try {
  const parcel = await travisCadAdapter.fetchParcel(parcelId, {
    signal: AbortSignal.timeout(25_000),
  });
  if (!parcel?.property?.geometry) throw new Error('TCAD parcel polygon unavailable');
  console.log('PARCEL ' + JSON.stringify({
    county: parcel.county, parcelId: parcel.parcelId,
    situs: parcel.property.situsAddress, countyRecordCurrency: parcel.source.recordCurrency,
    geometrySource: 'Travis County GIS / TCAD (not a boundary survey)',
  }));
  const [intersectsResponse, withinResponse] = await Promise.all([
    getResponse(buildAustinJurisdictionRelationUrl(parcel.property.geometry, 'touchesEnvelope'), 'intersects'),
    getResponse(buildAustinJurisdictionRelationUrl(parcel.property.geometry, 'containsEntireEnvelope'), 'within'),
  ]);
  const result = summarizeAustinJurisdictionRelations(intersectsResponse, withinResponse);
  console.log('GIS_RELATIONSHIPS ' + JSON.stringify(result, null, 2));
} catch (error) {
  console.log('UNAVAILABLE ' + JSON.stringify({
    message: String(error?.message || error).slice(0, 220),
    legalJurisdictionVerified: false, acquisitionRecommendation: null,
  }));
  process.exitCode = 1;
}
console.log('No PostGIS area %, legally controlling jurisdiction, or permit authorization inferred.');
