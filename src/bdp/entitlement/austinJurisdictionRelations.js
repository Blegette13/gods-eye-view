/**
 * City of Austin jurisdiction boundary *screen* without downloading giant
 * citywide polygons. ArcGIS performs spatial relationships server-side using
 * the complete bounding ENVELOPE of a TCAD parcel; that is deliberately a
 * stricter footprint than the actual parcel, but not a boundary survey or a
 * legally validated municipal determination.
 *
 * Per Esri query semantics, 'Within' asks whether the INPUT ENVELOPE lies
 * within a source feature; 'Intersects' returns source features touching it.
 * Geometry is never returned, so no intersection percentage is claimed.
 */
import { AUSTIN_SOURCE_LAYERS, austinParcelBounds } from './austinSourceContract.js';

export const AUSTIN_JURISDICTION_RELATIONS = Object.freeze({
  touchesEnvelope: 'esriSpatialRelIntersects',
  containsEntireEnvelope: 'esriSpatialRelWithin',
});

export function buildAustinJurisdictionRelationUrl(geometry, relation) {
  const spatialRel = AUSTIN_JURISDICTION_RELATIONS[relation];
  if (!spatialRel) throw new Error('Unsupported jurisdiction relationship');
  const bounds = austinParcelBounds(geometry);
  const url = new URL(`${AUSTIN_SOURCE_LAYERS.jurisdiction.url}/query`);
  url.search = new URLSearchParams({
    where: '1=1',
    geometry: bounds.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel,
    outFields: 'OBJECTID,CITY_NAME,JURISDICTION_TYPE,JURISDICTION_TYPE_SPECIFICS',
    returnGeometry: 'false',
    resultRecordCount: '100',
    f: 'json',
  }).toString();
  return url;
}

export function validateAustinJurisdictionRelationResponse(response) {
  if (!response || response.error || !Array.isArray(response.features)
    || response.exceededTransferLimit === true || response.features.length >= 100) {
    throw new Error('Jurisdiction relationship response missing, capped or invalid');
  }
  const ids = new Set();
  const result = response.features.map((feature) => {
    const item = feature?.attributes;
    if (!item || !Number.isSafeInteger(item.OBJECTID) || item.OBJECTID < 0
      || typeof item.CITY_NAME !== 'string'
      || typeof item.JURISDICTION_TYPE !== 'string'
      || typeof item.JURISDICTION_TYPE_SPECIFICS !== 'string') {
      throw new Error('Jurisdiction relationship response missing required GIS fields');
    }
    if (ids.has(item.OBJECTID)) throw new Error('Duplicate jurisdiction GIS feature ID');
    ids.add(item.OBJECTID);
    return Object.freeze({
      id: item.OBJECTID,
      cityName: item.CITY_NAME,
      type: item.JURISDICTION_TYPE,
      specifics: item.JURISDICTION_TYPE_SPECIFICS,
    });
  });
  return Object.freeze(result);
}

export function summarizeAustinJurisdictionRelations(intersectsResponse, withinResponse) {
  const candidates = validateAustinJurisdictionRelationResponse(intersectsResponse);
  const containsEnvelope = validateAustinJurisdictionRelationResponse(withinResponse);
  const candidateIds = new Set(candidates.map((item) => item.id));
  if (containsEnvelope.some((feature) => !candidateIds.has(feature.id))) {
    throw new Error('Jurisdiction relationship queries returned inconsistent object IDs');
  }
  const singleConsistentFeature = candidates.length === 1
    && containsEnvelope.length === 1 && candidates[0].id === containsEnvelope[0].id;

  // A full envelope match says nothing about current source validity, legal
  // boundary surveys, regulations, ETJ development rights, or permits.
  const status = candidates.length === 0 ? 'unknown-no-candidates'
    : singleConsistentFeature ? 'single-gis-feature-contains-parcel-envelope'
    : candidates.length > 1 ? 'multiple-jurisdiction-features-boundary-review'
    : 'unknown-envelope-not-contained';

  return Object.freeze({
    status,
    intersectsCandidateCount: candidates.length,
    envelopeContainingCandidateCount: containsEnvelope.length,
    candidateJurisdictions: candidates,
    envelopeContainingJurisdictions: containsEnvelope,
    sourceGeometryDownloaded: false,
    parcelIntersectionAreaCalculated: false,
    exactParcelJurisdictionVerified: false,
    legalJurisdictionVerified: false,
    sourceCurrencyVerified: false,
    regulatoryEntitlementVerified: false,
    acquisitionRecommendation: null,
    note: 'ArcGIS geographic envelope relationship only. City/ETJ legal jurisdiction and regulatory authority must be verified with responsible agencies.',
  });
}
