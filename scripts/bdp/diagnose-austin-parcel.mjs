/**
 * Read-only preliminary Austin GIS candidate discovery for an actual TCAD
 * parcel. The county GIS geometry is not a boundary survey. Source matches are
 * only envelope candidates; exact intersections must be done in PostGIS before
 * parcel zoning can be presented to users.
 *
 * Usage: node scripts/bdp/diagnose-austin-parcel.mjs [numeric TCAD PROP_ID]
 */
import { travisCadAdapter } from '../../src/bdp/cad/travisAdapter.js';
import {
  AUSTIN_SOURCE_LAYERS,
  austinParcelBounds,
  buildAustinParcelCandidateQueryUrl,
  buildAustinJurisdictionAttributeQueryUrl,
  validateAustinCandidateCollection,
  summarizeAustinJurisdictionCandidates,
} from '../../src/bdp/entitlement/austinSourceContract.js';

const id = process.argv[2] || '302959'; // Travis test parcel: 611 W Annie St
if (!/^\d{1,18}$/.test(id)) throw new Error('Provide a numeric TCAD PROP_ID, not an address or owner name');

async function fetchLimitedJson(url, label) {
  const response = await fetch(url, {
    headers: { accept: 'application/geo+json,application/json' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > 8_000_000) throw new Error(`${label}: source response too large`);
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > 8_000_000) throw new Error(`${label}: source response too large`);
  const json = JSON.parse(body);
  if (json?.error) throw new Error(`${label}: ArcGIS error ${json.error.code ?? ''}`);
  return json;
}

console.log('BDP · TCAD parcel / Austin GIS envelope candidates · READ ONLY');
let parcel;
try {
  parcel = await travisCadAdapter.fetchParcel(id, { signal: AbortSignal.timeout(25_000) });
} catch (error) {
  console.log('UNAVAILABLE ' + JSON.stringify({
    source: 'Travis TCAD', message: String(error.message).slice(0, 180),
  }));
  process.exit(0);
}
if (!parcel?.property?.geometry) {
  console.log('UNKNOWN · parcel unavailable or lacks valid GIS polygon geometry');
  process.exit(0);
}
const bounds = austinParcelBounds(parcel.property.geometry);
console.log('PARCEL ' + JSON.stringify({
  county: parcel.county,
  parcelId: parcel.parcelId,
  situsAddress: parcel.property.situsAddress,
  countySourceRecordCurrency: parcel.source.recordCurrency,
  boundarySource: 'Travis County GIS / TCAD · NOT a boundary survey',
  boundsWGS84: bounds,
}));

for (const [sourceName, source] of Object.entries(AUSTIN_SOURCE_LAYERS)) {
  try {
    // Citywide jurisdiction polygons are huge; do not download or simplify
    // them for a preliminary envelope. Attributes-only preserves a source hint
    // but still cannot verify true parcel overlap or legal jurisdiction.
    const attributesOnly = sourceName === 'jurisdiction';
    const url = attributesOnly
      ? buildAustinJurisdictionAttributeQueryUrl(parcel.property.geometry)
      : buildAustinParcelCandidateQueryUrl(sourceName, parcel.property.geometry);
    const response = await fetchLimitedJson(url, sourceName);
    const candidates = attributesOnly
      ? summarizeAustinJurisdictionCandidates(response)
      : validateAustinCandidateCollection(sourceName, response);
    const keys = source.fields;
    const observations = candidates.features.map(({properties}) =>
      Object.fromEntries(keys.map((field) => [field, properties[field] ?? null])));
    // Distinct source values are evidence of *possible* partial intersections,
    // not a zoning designation, the total tract area or adopted ETOD status.
    const unique = [...new Map(observations.map((item) => [JSON.stringify(item), item])).values()];
    console.log('CANDIDATES ' + JSON.stringify({
      sourceName,
      status: candidates.status,
      candidateCount: candidates.candidateCount,
      distinctSourceAttributes: unique.slice(0, 12),
      attributesCappedForDisplay: unique.length > 12,
      exactParcelOverlapCalculated: false,
      geometryReturned: !attributesOnly,
      legalJurisdictionVerified: false,
      sourceLayer: source.url,
    }, null, 2));
  } catch (error) {
    console.log('UNAVAILABLE ' + JSON.stringify({
      sourceName,
      message: String(error?.message || error).slice(0, 200),
    }));
  }
}
console.log('DONE · Candidate polygons are NOT parcel zoning, title, legal land use or verified ETOD eligibility.');
console.log('Jurisdiction attributes are envelope candidates only. Full city polygons were NOT downloaded.');
console.log('Next: PostGIS exact area intersections, all overlays, zoning law, and source-date review.');
