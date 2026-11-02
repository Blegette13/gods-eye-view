import { parseBoundedParcelPageRequest, checkTrustedParcelSource } from './parcelPageContract.js';
import { assessParcelGeoJsonPage } from './parcelGeometryDeliveryBudget.js';

/**
 * Step 40C-15 — UNROUTED, UNPUBLISHED parcel geometry candidate assembly.
 *
 * Only for independently trusted, server-side PostGIS rows. This does not
 * query PostGIS, establish user authentication, grant GIS redistribution,
 * enable a public route, paginate, or modify Cesium. Any future delivery
 * path must obtain metadata + geometry from one consistent authorized source
 * snapshot, enforce rechecks after the query, and review actual source rights.
 *
 * CRITICAL: source_registry.rights_state='approved' currently grants only
 * reviewed caching, NOT redistribution. A separate explicit publication
 * rights record is required here and must originate from a fresh SERVER-side
 * rights authority rather than browser input. This pure check is NOT itself
 * evidence that any county's geometry may be legally published.
 *
 * source_geometry_sha256 equality below binds declared row identity between
 * the metadata and geometry query; it does NOT independently cryptographically
 * verify WKB versus GeoJSON, or prove a survey/legal boundary. Future queries
 * must be fixed, snapshot-consistent and rights-gated at execution time.
 */

const SOURCE_ID = /^[a-z][a-z0-9_-]{2,79}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REVIEW_REF = /^[A-Za-z0-9][A-Za-z0-9_./:-]{4,159}$/;
const SOURCE_VERSION = /^.{1,150}$/u;
const reject = () => Object.freeze({ ok: false, reason: 'unavailable', publishAuthorized: false });

function validPublicationReview({ plan, trustedSource, trustedPublicationRights, nowMs }) {
  const rights = trustedPublicationRights;
  return rights && typeof rights === 'object' && !Array.isArray(rights)
    && typeof rights.sourceId === 'string' && SOURCE_ID.test(rights.sourceId)
    && rights.sourceId === trustedSource.sourceId
    && rights.countyFips === plan.countyFips
    && rights.allowGeometryRedistribution === true
    && rights.reviewState === 'approved'
    && typeof rights.reviewReference === 'string'
    && REVIEW_REF.test(rights.reviewReference)
    && Number.isSafeInteger(rights.reviewedAtMs)
    && rights.reviewedAtMs > 0 && rights.reviewedAtMs <= nowMs
    && Number.isSafeInteger(rights.expiresAtMs)
    && rights.expiresAtMs > nowMs
    && rights.expiresAtMs > rights.reviewedAtMs
    && rights.expiresAtMs <= trustedSource.approvedCachingUntilMs;
}

function validRowIdentity(meta, geometry, trustedSource, plan, trustedRunId) {
  if (!meta || !geometry || typeof meta !== 'object' || typeof geometry !== 'object'
    || Array.isArray(meta) || Array.isArray(geometry)) return false;

  return typeof meta.source_parcel_id === 'string'
    && geometry.source_parcel_id === meta.source_parcel_id
    && typeof meta.source_geometry_sha256 === 'string'
    && SHA256.test(meta.source_geometry_sha256)
    && geometry.source_geometry_sha256 === meta.source_geometry_sha256
    && typeof meta.source_version === 'string'
    && SOURCE_VERSION.test(meta.source_version)
    && geometry.source_version === meta.source_version
    && Number.isSafeInteger(meta.ingest_run_id)
    && meta.ingest_run_id === trustedRunId
    && geometry.ingest_run_id === trustedRunId
    && geometry.source_id === trustedSource.sourceId
    && geometry.county_fips === plan.countyFips;
}

/**
 * Produces a private serialized GeoJSON candidate, NOT a publishable response.
 * - metadataRows are the SAME ordered, bounded viewport probe returned under
 *   one trusted run and source; a probe may contain one overflow row.
 * - geometryRows are the first acceptedCount aligned rows only, retrieved in
 *   the same snapshot/transaction and never from an arbitrary request.
 * - trustedPublicationRights must come from a separately checked *server*
 *   redistribution policy. Caching approval alone never allows output.
 *
 * Missing/incorrect evidence always means unavailable — never an empty/clear
 * county, a complete viewport, a title inference, or a publication grant.
 */
export function stageParcelGeometryCandidate({
  plan, metadataRows, geometryRows, trustedSource, trustedRunId,
  trustedPublicationRights, nowMs,
} = {}) {
  const checked = plan && parseBoundedParcelPageRequest({
    countyFips: plan.countyFips, bounds: plan.bounds, limit: plan.limit,
  });
  if (!checked || plan.probeLimit !== checked.probeLimit
    || !checkTrustedParcelSource({ plan: checked, trustedSource, nowMs })
    || !Number.isSafeInteger(trustedRunId) || trustedRunId <= 0
    || !validPublicationReview({ plan: checked, trustedSource, trustedPublicationRights, nowMs })
    || !Array.isArray(metadataRows) || !Array.isArray(geometryRows)
    || metadataRows.length > checked.probeLimit
    || geometryRows.length !== Math.min(metadataRows.length, checked.limit)) return reject();

  // Construct a strict, map-safe allowlist of properties. Never spread
  // PostGIS source records or additional personal/ownership attributes.
  const features = [];
  for (let index = 0; index < geometryRows.length; index++) {
    const meta = metadataRows[index];
    const geo = geometryRows[index];
    if (!validRowIdentity(meta, geo, trustedSource, checked, trustedRunId)) return reject();
    features.push({
      type: 'Feature',
      id: meta.source_parcel_id,
      properties: { sourceParcelId: meta.source_parcel_id },
      geometry: geo.geometry,
    });
  }
  const collection = { type: 'FeatureCollection', features };
  const result = assessParcelGeoJsonPage({
    plan: checked, rows: metadataRows, collection,
  });
  if (!result.ok) return reject();
  try {
    // Store immutable wire text; avoid keeping references to mutable rows.
    const geojson = JSON.stringify(collection);
    if (Buffer.byteLength(geojson, 'utf8') !== result.geoJsonBytes) return reject();
    return Object.freeze({
      ok: true,
      candidateGeoJson: geojson,
      featureCount: result.acceptedCount,
      overflow: result.overflow,
      bytes: result.geoJsonBytes,
      viewportCoverage: 'unknown',
      // A separate fully authenticated, current-rights transport is REQUIRED.
      publishAuthorized: false,
    });
  } catch {
    return reject();
  }
}
