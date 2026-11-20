import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import { stageParcelGeometrySnapshot } from './parcelGeometrySnapshotPlan.js';

/**
 * Step 40C-31 — PRIVATE ONLY: validate the whole SQL result page returned by
 * the staged sealed-initial or sealed-keyset fixed RPC. NEVER use arbitrary
 * client-supplied rows or afterKey. Trusted callers must independently verify
 * current HMAC session/county entitlements, publication rights, quotas and
 * DB function ownership/EXECUTE BEFORE query and AFTER this validator.
 *
 * This is neither a connection, authentication system, HTTP route, SQL
 * migration, GIS publication authorization, nor evidence of full coverage.
 * In particular the word "validated" below means only structurally valid,
 * not "publishable". The source/run-seal must be enforced by the fixed RPC.
 */
const ROW_KEYS = [
  'parcel_version_id', 'source_parcel_id', 'source_version',
  'source_geometry_sha256', 'ingest_run_id', 'source_id', 'county_fips',
  'geometry_vertices', 'geometry_memory_bytes', 'geometry',
];
const PLAN_KEYS = ['countyFips', 'bounds', 'limit', 'probeLimit'];
const BOUNDS_KEYS = ['west','south','east','north'];
const AFTER_KEYS = ['sourceParcelId','parcelVersionId'];
const PARCEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const MAX_BIGINT = 9223372036854775807n;

function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null)
    && Object.keys(value).length === fields.length
    && fields.every(key => Object.hasOwn(value, key));
}

function bigintId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) return null;
  try {
    const n = BigInt(value);
    return n <= MAX_BIGINT && n.toString() === value ? n : null;
  } catch { return null; }
}
function compare(a, b) {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
}
const unavailable = () => Object.freeze({
  status: 'unavailable',
  publishAuthorized: false,
  viewportCoverage: 'unknown',
  geometryDelivered: false,
});

/**
 * Fail CLOSED for malformed DB rows, incorrectly ordered page keys, source
 * identity mismatches (including the overflow sentinel), missing reviewed
 * redistribution rights, invalid WGS84 rings or byte/vertex budget overruns.
 *
 * afterKey, when present, comes ONLY from an independently HMAC-verified,
 * short-lived server cursor. It is never a browser-request parameter.
 * The original fixed RPC must enforce the same cursor and run-seal gates.
 */
export function validatePrivateSealedGeometryPage({
  plan, rows, trustedSource, trustedRunId, trustedPublicationRights,
  nowMs, afterKey = null,
} = {}) {
  if (!exact(plan, PLAN_KEYS) || !exact(plan.bounds, BOUNDS_KEYS)
    || !Number.isSafeInteger(trustedRunId) || trustedRunId <= 0
    || !Number.isSafeInteger(nowMs) || nowMs <= 0) return unavailable();

  const checked = parseBoundedParcelPageRequest({
    countyFips: plan.countyFips, bounds: plan.bounds, limit: plan.limit,
  });
  if (!checked || checked.probeLimit !== plan.probeLimit
    || !Array.isArray(rows) || rows.length > checked.probeLimit) return unavailable();

  let previous = null;
  if (afterKey !== null) {
    if (!exact(afterKey, AFTER_KEYS)
      || typeof afterKey.sourceParcelId !== 'string'
      || !PARCEL_ID.test(afterKey.sourceParcelId)) return unavailable();
    const v = bigintId(afterKey.parcelVersionId);
    if (v === null) return unavailable();
    previous = { id: afterKey.sourceParcelId, version: v };
  }

  let version = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!exact(row, ROW_KEYS)
      || typeof row.source_parcel_id !== 'string'
      || !PARCEL_ID.test(row.source_parcel_id)
      || typeof row.source_version !== 'string'
      || row.source_id !== trustedSource?.sourceId
      || row.county_fips !== plan.countyFips
      || !(row.ingest_run_id === String(trustedRunId)
        || row.ingest_run_id === trustedRunId)) return unavailable();

    const id = bigintId(row.parcel_version_id);
    if (id === null) return unavailable();
    const current = { id: row.source_parcel_id, version: id };
    if (previous && compare(previous, current) >= 0) return unavailable();
    previous = current;

    // A sealed run represents one version; do not silently mix runs here.
    if (version !== null && row.source_version !== version) return unavailable();
    version = row.source_version;

    // Last record can be a limit+one sentinel ONLY if page is full.
    if (i === checked.limit && row.geometry !== null) return unavailable();
  }

  // The pre-existing single-result validator builds a tightly allowlisted
  // JSON candidate and rechecks both source-caching and *separately reviewed*
  // geometry-publication rights. Missing rights never become a success.
  const candidate = stageParcelGeometrySnapshot({
    plan: checked, rows, trustedSource, trustedRunId,
    trustedPublicationRights, nowMs,
  });
  if (!candidate.ok || candidate.publishAuthorized !== false
    || candidate.viewportCoverage !== 'unknown') return unavailable();

  return Object.freeze({
    status: 'validated-private',
    featureCount: candidate.featureCount,
    overflow: candidate.overflow,
    // Serialized candidate text is INTERNAL ONLY, never a client response.
    candidateGeoJson: candidate.candidateGeoJson,
    bytes: candidate.bytes,
    viewportCoverage: 'unknown',
    publishAuthorized: false,
    geometryDelivered: false,
  });
}
