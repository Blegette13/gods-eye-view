import { parseBoundedParcelPageRequest, checkTrustedParcelSource } from '../../src/bdp/ingestion/parcelPageContract.js';
import { stageParcelGeometrySnapshot } from '../../src/bdp/ingestion/parcelGeometrySnapshotPlan.js';

/**
 * Step 40C-21 — STAGED, UNROUTED, PRIVATE geometry orchestration.
 *
 * This is NOT an HTTP endpoint, cookie issuer, production authorization,
 * geometry publication decision, legal GIS license, or deployed DB service.
 * The trusted caller must inject:
 *   resolveAuthorizedSource: authoritative HMAC session / county entitlement
 *     AND current source-run rights resolver (Step 40C-6).
 *   readPublicationReview: independent authoritative redistributable-geometry
 *     rights lookup, NOT inferred from source caching or public CAD access.
 *   readSnapshot: isolated, least-privileged geometry-only RPC adapter
 *     (Step 40C-20), NOT the metadata-only DB principal.
 *   consumeQuota: distributed atomic fail-closed per-session/county limiter.
 *
 * The private candidate is deliberately marked publishAuthorized:false and
 * must NEVER be serialized to a browser by this or an existing HTTP handler.
 * The application still lacks a production rights store, real quotas,
 * vetted database LOGIN, active SQL cancellation and source-window coverage.
 */

const HANDLE = /^[A-Za-z0-9_-]{43}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9_./:-]{4,159}$/;
const INVALID = Object.freeze({ status: 'invalid-request', viewportCoverage: 'unknown', publishAuthorized: false });
const DENIED = Object.freeze({ status: 'denied', viewportCoverage: 'unknown', publishAuthorized: false });
const BUSY = Object.freeze({ status: 'busy', viewportCoverage: 'unknown', publishAuthorized: false });
const CANCELLED = Object.freeze({ status: 'cancelled', viewportCoverage: 'unknown', publishAuthorized: false });
const UNAVAILABLE = Object.freeze({ status: 'unavailable', viewportCoverage: 'unknown', publishAuthorized: false });

function canonicalHandle(handle) {
  if (typeof handle !== 'string' || !HANDLE.test(handle)) return false;
  const decoded = Buffer.from(handle, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === handle;
}

function validSource(value, plan, nowMs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Number.isSafeInteger(value.runId) || value.runId <= 0) return null;
  const source = {
    sourceId: value.sourceId,
    countyFips: value.countyFips,
    rightsState: value.rightsState,
    approvedCachingUntilMs: value.approvedCachingUntilMs,
  };
  if (!checkTrustedParcelSource({ plan, trustedSource: source, nowMs })) return null;
  return Object.freeze({ ...source, runId: value.runId });
}

function validReview(value, trustedSource, nowMs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.sourceId !== trustedSource.sourceId
    || value.countyFips !== trustedSource.countyFips
    || value.reviewState !== 'approved'
    || value.allowGeometryRedistribution !== true
    || typeof value.reviewReference !== 'string'
    || !REF.test(value.reviewReference)
    || !Number.isSafeInteger(value.reviewedAtMs)
    || value.reviewedAtMs <= 0 || value.reviewedAtMs > nowMs
    || !Number.isSafeInteger(value.expiresAtMs)
    || value.expiresAtMs <= nowMs
    || value.expiresAtMs > trustedSource.approvedCachingUntilMs
    || value.expiresAtMs <= value.reviewedAtMs) return null;
  return Object.freeze({
    sourceId: value.sourceId, countyFips: value.countyFips,
    reviewState: 'approved', allowGeometryRedistribution: true,
    reviewReference: value.reviewReference,
    reviewedAtMs: value.reviewedAtMs,
    expiresAtMs: value.expiresAtMs,
  });
}

function sameSource(a, b) {
  return a.sourceId === b.sourceId && a.countyFips === b.countyFips
    && a.runId === b.runId && a.rightsState === b.rightsState
    && a.approvedCachingUntilMs === b.approvedCachingUntilMs;
}
function sameReview(a, b) {
  return a.sourceId === b.sourceId && a.countyFips === b.countyFips
    && a.reviewReference === b.reviewReference
    && a.reviewedAtMs === b.reviewedAtMs
    && a.expiresAtMs === b.expiresAtMs
    && a.allowGeometryRedistribution === b.allowGeometryRedistribution
    && a.reviewState === b.reviewState;
}

/** In-process concurrency is ADDITIONAL to, not a replacement for, quota. */
export function createPrivateParcelGeometryService({
  resolveAuthorizedSource, readPublicationReview, readSnapshot, consumeQuota,
  now = Date.now, maxConcurrent = 2, statementTimeoutMs = 1000,
} = {}) {
  if ([resolveAuthorizedSource, readPublicationReview, readSnapshot,
    consumeQuota, now].some((x) => typeof x !== 'function')
    || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8
    || !Number.isSafeInteger(statementTimeoutMs)
    || statementTimeoutMs < 100 || statementTimeoutMs > 3000) {
    throw new TypeError('Trusted source/session, independent rights, geometry reader and quota required');
  }
  let active = 0;
  return async function preparePrivateParcelGeometry({ sessionHandle, request, signal } = {}) {
    const plan = parseBoundedParcelPageRequest(request);
    if (!plan || (signal !== undefined && !(signal instanceof AbortSignal))) return INVALID;
    if (!canonicalHandle(sessionHandle)) return DENIED;
    if (signal?.aborted) return CANCELLED;
    if (active >= maxConcurrent) return BUSY;

    active++;
    try {
      const context = Object.freeze({ sessionHandle, countyFips: plan.countyFips, signal });
      // Quota is an injected *real* distributed limiter in future deployments.
      if (await consumeQuota(context) !== true) return BUSY;
      if (signal?.aborted) return CANCELLED;

      const beforeSource = validSource(
        await resolveAuthorizedSource(context), plan, now());
      if (signal?.aborted) return CANCELLED;
      if (!beforeSource) return DENIED;
      const reviewArgs = Object.freeze({
        sourceId: beforeSource.sourceId, countyFips: plan.countyFips, signal,
      });
      const beforeRights = validReview(
        await readPublicationReview(reviewArgs), beforeSource, now());
      if (signal?.aborted) return CANCELLED;
      if (!beforeRights) return DENIED;

      const privateResult = await readSnapshot(Object.freeze({
        plan, trustedSourceId: beforeSource.sourceId, trustedRunId: beforeSource.runId,
      }), Object.freeze({ signal, statementTimeoutMs }));
      if (signal?.aborted) return CANCELLED;
      if (!privateResult || privateResult.publishAuthorized !== false
        || privateResult.viewportCoverage !== 'unknown'
        || !Array.isArray(privateResult.rows) || privateResult.rows.length > plan.probeLimit) {
        return UNAVAILABLE;
      }

      // Session/county/source/run and independently reviewed publication
      // rights must STILL be approved, current and unchanged after SQL.
      const afterSource = validSource(
        await resolveAuthorizedSource(context), plan, now());
      if (signal?.aborted) return CANCELLED;
      if (!afterSource || !sameSource(beforeSource, afterSource)) return DENIED;
      const afterRights = validReview(
        await readPublicationReview(reviewArgs), afterSource, now());
      if (signal?.aborted) return CANCELLED;
      if (!afterRights || !sameReview(beforeRights, afterRights)) return DENIED;

      const candidate = stageParcelGeometrySnapshot({
        plan, rows: privateResult.rows,
        trustedSource: afterSource, trustedRunId: afterSource.runId,
        trustedPublicationRights: afterRights, nowMs: now(),
      });
      if (signal?.aborted) return CANCELLED;
      if (!candidate.ok || candidate.publishAuthorized !== false
        || candidate.viewportCoverage !== 'unknown') return UNAVAILABLE;

      // DO NOT send this private string in the existing metadata HTTP route.
      // No code path in this module authorizes downstream publication.
      return Object.freeze({
        status: 'validated-private',
        privateCandidateGeoJson: candidate.candidateGeoJson,
        featureCount: candidate.featureCount,
        overflow: candidate.overflow,
        viewportCoverage: 'unknown',
        publishAuthorized: false,
      });
    } catch {
      return signal?.aborted ? CANCELLED : UNAVAILABLE;
    } finally {
      active--;
    }
  };
}
