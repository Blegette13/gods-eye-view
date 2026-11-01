import { parseBoundedParcelPageRequest, checkTrustedParcelSource } from '../../src/bdp/ingestion/parcelPageContract.js';
import { buildParcelViewportProbeStatement } from '../../src/bdp/ingestion/parcelViewportReadPlan.js';
import { assessParcelGeometryMetadata } from '../../src/bdp/ingestion/parcelGeometryDeliveryBudget.js';

/**
 * Step 40C-4: UNROUTED, metadata-only server boundary for a future trusted
 * parcel delivery service. This is NOT an HTTP handler, authentication service,
 * PostGIS connection, public parcel endpoint, or approval to store county GIS.
 *
 * Integrator MUST supply a real server-side opaque-session validator and
 * a fresh, authoritative source/run resolver; NEVER derive these from a
 * browser role, county-wide entitlement, or user-supplied GIS source.
 * query MUST use a least-privileged read-only DB role, parameter binding,
 * server-enforced query timeout/cancellation, and SQL rights gates. The
 * in-process concurrency guard is NOT a substitute for a distributed quota.
 *
 * No parcel ID, polygon, owner, address, or session information is returned.
 */
const HANDLE = /^[A-Za-z0-9_-]{43}$/;
export const DEFAULT_PARCEL_PROBE_MAX_CONCURRENT = 4;
export const DEFAULT_PARCEL_PROBE_TIMEOUT_MS = 2_000;

const RESPONSE = Object.freeze({
  invalid: Object.freeze({ status: 'invalid-request', viewportCoverage: 'unknown' }),
  denied: Object.freeze({ status: 'denied', viewportCoverage: 'unknown' }),
  unavailable: Object.freeze({ status: 'unavailable', viewportCoverage: 'unknown' }),
  cancelled: Object.freeze({ status: 'cancelled', viewportCoverage: 'unknown' }),
  busy: Object.freeze({ status: 'busy', viewportCoverage: 'unknown' }),
});

function validHandle(value) {
  if (typeof value !== 'string' || !HANDLE.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === value;
}

function validatedTrustedRef(candidate, plan, nowMs) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
    || !Number.isSafeInteger(candidate.runId) || candidate.runId <= 0) return null;
  const trustedSource = {
    sourceId: candidate.sourceId,
    countyFips: candidate.countyFips,
    rightsState: candidate.rightsState,
    approvedCachingUntilMs: candidate.approvedCachingUntilMs,
  };
  if (!checkTrustedParcelSource({ plan, trustedSource, nowMs })) return null;
  return Object.freeze({ sourceId: trustedSource.sourceId, runId: candidate.runId });
}

/**
 * Session is separate from the strict geographic request body and must come
 * exclusively from trusted HTTP-only cookie handling in a future integration.
 * The resolver MUST re-check account status, county authorization, source
 * rights, run approval and revocation on EACH call, not trust stale caches.
 */
export function createParcelViewportMetadataService({
  resolveAuthorizedSource,
  query,
  now = Date.now,
  maxConcurrent = DEFAULT_PARCEL_PROBE_MAX_CONCURRENT,
  statementTimeoutMs = DEFAULT_PARCEL_PROBE_TIMEOUT_MS,
} = {}) {
  if (typeof resolveAuthorizedSource !== 'function' || typeof query !== 'function'
    || typeof now !== 'function'
    || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16
    || !Number.isSafeInteger(statementTimeoutMs)
    || statementTimeoutMs < 100 || statementTimeoutMs > 5_000) {
    throw new TypeError('Trusted resolver, DB read adapter and bounded budgets required');
  }
  let active = 0;
  return async function readParcelViewportMetadata({ sessionHandle, request, signal } = {}) {
    const plan = parseBoundedParcelPageRequest(request);
    if (!plan) return RESPONSE.invalid;
    if (!validHandle(sessionHandle)) return RESPONSE.denied;
    if (signal !== undefined && !(signal instanceof AbortSignal)) return RESPONSE.invalid;
    if (signal?.aborted) return RESPONSE.cancelled;
    if (active >= maxConcurrent) return RESPONSE.busy;
    active++;
    try {
      const rightsArgs = Object.freeze({ sessionHandle, countyFips: plan.countyFips, signal });
      const before = validatedTrustedRef(await resolveAuthorizedSource(rightsArgs), plan, now());
      if (signal?.aborted) return RESPONSE.cancelled;
      if (!before) return RESPONSE.denied;
      const statement = buildParcelViewportProbeStatement({
        plan, trustedSourceId: before.sourceId, trustedRunId: before.runId,
      });
      if (!statement) return RESPONSE.denied;
      const databaseResult = await query(statement, Object.freeze({
        signal, statementTimeoutMs,
      }));
      if (signal?.aborted) return RESPONSE.cancelled;
      const assessment = assessParcelGeometryMetadata({ plan, rows: databaseResult?.rows });
      if (!assessment.ok) return RESPONSE.unavailable;
      // Revalidate permission and the exact versioned run BEFORE returning
      // even metadata counts. A revoked/expired or rotated run must fail closed.
      const after = validatedTrustedRef(await resolveAuthorizedSource(rightsArgs), plan, now());
      if (signal?.aborted) return RESPONSE.cancelled;
      if (!after || after.sourceId !== before.sourceId || after.runId !== before.runId) {
        return RESPONSE.denied;
      }
      return Object.freeze({
        status: assessment.overflow ? 'partial-page' : 'ok',
        parcelCount: assessment.acceptedCount,
        overflow: assessment.overflow,
        viewportCoverage: 'unknown',
        geometryDelivered: false,
      });
    } catch {
      // Never leak SQL, source identifiers, session details or DB errors.
      return signal?.aborted ? RESPONSE.cancelled : RESPONSE.unavailable;
    } finally {
      active--;
    }
  };
}
