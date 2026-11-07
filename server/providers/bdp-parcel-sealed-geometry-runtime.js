import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createTrustedParcelCountySessionVerifier } from './bdp-parcel-county-session.js';
import { createPrivateSealedGeometryReadBoundary } from '../../src/bdp/ingestion/parcelPrivateGeometryReadBoundary.js';
import { createFixedSealedGeometryRpcReader } from './bdp-parcel-sealed-geometry-rpc.js';

/**
 * Step 40C-33 — PRIVATE/UNROUTED trusted-dependency composition.
 *
 * NO login/cookie transport, production session store, GIS license, DB role,
 * connection configuration, migration, HTTP handler, or browser geometry.
 * The injected session lookup must be strongly consistent for revocation;
 * readSealedSource MUST be a independently DBA-reviewed source+immutable-seal
 * query, and readPublicationReview MUST use an independent legal rights store.
 * Synthetic callback values do not constitute authorization in production.
 *
 * Every private page re-verifies session/county, run seal, source-caching
 * rights and separate redistribution review before and after the fixed RPC.
 * No decoded geometry, rows or source policy are returned to the caller.
 */
const FIPS = /^48[0-9]{3}$/;
const SOURCE_ID = /^[a-z][a-z0-9_-]{2,79}$/;
const REVIEW_REF = /^[A-Za-z0-9][A-Za-z0-9_./:-]{4,159}$/;
const SOURCE_KEYS = [
  'sourceId', 'countyFips', 'rightsState', 'approvedCachingUntilMs',
  'runId', 'sourceVersion', 'sealedAtMs', 'indexedRecords', 'sealedRun',
];
const REVIEW_KEYS = [
  'sourceId', 'countyFips', 'reviewState', 'allowGeometryRedistribution',
  'reviewReference', 'reviewedAtMs', 'expiresAtMs',
];
const CONFIG_KEYS = new Set([
  'sessionHmacKey', 'cursorHmacKey', 'findSessionByDigest',
  'readSealedSource', 'readPublicationReview', 'consumeQuota', 'connect',
  'geometryLogin', 'now',
]);
const REFUSE = null;

function exact(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
  const proto = Object.getPrototypeOf(object);
  return (proto === Object.prototype || proto === null)
    && Object.keys(object).length === keys.length
    && keys.every((key) => Object.hasOwn(object, key));
}
function validSource(source, countyFips, nowMs) {
  return exact(source, SOURCE_KEYS)
    && source.countyFips === countyFips
    && typeof source.sourceId === 'string' && SOURCE_ID.test(source.sourceId)
    && source.rightsState === 'approved'
    && Number.isSafeInteger(source.approvedCachingUntilMs)
    && source.approvedCachingUntilMs > nowMs
    && Number.isSafeInteger(source.runId) && source.runId > 0
    && typeof source.sourceVersion === 'string'
    && source.sourceVersion.length >= 1 && source.sourceVersion.length <= 150
    && Number.isSafeInteger(source.sealedAtMs)
    && source.sealedAtMs > 0 && source.sealedAtMs <= nowMs
    && Number.isSafeInteger(source.indexedRecords) && source.indexedRecords >= 0
    && source.sealedRun === true;
}
function validReview(review, source, nowMs) {
  return exact(review, REVIEW_KEYS)
    && review.sourceId === source.sourceId
    && review.countyFips === source.countyFips
    && review.reviewState === 'approved'
    && review.allowGeometryRedistribution === true
    && typeof review.reviewReference === 'string'
    && REVIEW_REF.test(review.reviewReference)
    && Number.isSafeInteger(review.reviewedAtMs)
    && review.reviewedAtMs > 0 && review.reviewedAtMs <= nowMs
    && Number.isSafeInteger(review.expiresAtMs)
    && review.expiresAtMs > nowMs
    && review.expiresAtMs > review.reviewedAtMs
    && review.expiresAtMs <= source.approvedCachingUntilMs;
}

/**
 * The only public method on this factory returns private counts/position.
 * connect MUST yield a pinned, least-privileged, geometry-only pg client.
 * consumeQuota MUST atomically charge in a server-controlled shared store
 * and return exactly true; an in-process counter is insufficient.
 */
export function createPrivateSealedGeometryRuntime(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some((key) => !CONFIG_KEYS.has(key))) {
    throw new TypeError('Unknown/private geometry runtime configuration');
  }
  const {
    sessionHmacKey, cursorHmacKey, findSessionByDigest,
    readSealedSource, readPublicationReview, consumeQuota, connect,
    geometryLogin, now = Date.now,
  } = config;
  if (!Buffer.isBuffer(sessionHmacKey) || sessionHmacKey.length < 32
    || !Buffer.isBuffer(cursorHmacKey) || cursorHmacKey.length < 32
    || (sessionHmacKey.length === cursorHmacKey.length
      && timingSafeEqual(sessionHmacKey, cursorHmacKey))
    || [findSessionByDigest, readSealedSource, readPublicationReview,
      consumeQuota, connect, now].some((value) => typeof value !== 'function')) {
    throw new TypeError('Distinct HMAC keys and verified private collaborators required');
  }
  const sessionKey = Buffer.from(sessionHmacKey);
  const verifyCountySession = createTrustedParcelCountySessionVerifier({
    sessionHmacKey: sessionKey, findSessionByDigest, now,
  });
  const rpc = createFixedSealedGeometryRpcReader({ connect, expectedLogin:geometryLogin });

  async function loadCurrentAuthority({ sessionHandle, countyFips, signal } = {}) {
    if (typeof countyFips !== 'string' || !FIPS.test(countyFips)
      || !(signal instanceof AbortSignal) || signal.aborted) return REFUSE;
    try {
      const proof = await verifyCountySession({ sessionHandle, countyFips, signal });
      if (!proof || proof.authenticated !== true || signal.aborted) return REFUSE;

      // The opaque handle's HMAC is never sent to a database or response.
      const sessionDigest = createHmac('sha256', sessionKey)
        .update(sessionHandle, 'utf8').digest('hex');
      // This must be a fresh, ONE-source, sealed-run authoritative lookup.
      const source = await readSealedSource(Object.freeze({ countyFips, signal }));
      if (signal.aborted) return REFUSE;
      let clock = now();
      if (!Number.isSafeInteger(clock) || clock <= 0
        || !validSource(source, countyFips, clock)) return REFUSE;

      // The independent legal review must not be inferred from caching rights.
      const review = await readPublicationReview(Object.freeze({
        countyFips, sourceId: source.sourceId, signal,
      }));
      if (signal.aborted) return REFUSE;
      clock = now();
      if (!Number.isSafeInteger(clock) || clock <= 0
        || !validSource(source, countyFips, clock)
        || !validReview(review, source, clock)) return REFUSE;

      // A change to ANY sealed-run, cache or publication fact invalidates
      // continuation tokens and post-query checks, even if the caller forgot
      // to bump a manually managed policy version number.
      const publicationRevision = createHash('sha256').update(JSON.stringify([
        'ldos-sealed-geometry-authority-v1',
        source.sourceId, source.countyFips, source.rightsState,
        source.approvedCachingUntilMs, source.runId, source.sourceVersion,
        source.sealedAtMs, source.indexedRecords, source.sealedRun,
        review.sourceId, review.countyFips, review.reviewState,
        review.allowGeometryRedistribution, review.reviewReference,
        review.reviewedAtMs, review.expiresAtMs,
      ])).digest('hex');
      return Object.freeze({
        allowed: true, countyFips,
        trustedSource: Object.freeze({
          sourceId: source.sourceId, countyFips: source.countyFips,
          rightsState: source.rightsState,
          approvedCachingUntilMs: source.approvedCachingUntilMs,
        }),
        trustedPublicationRights: Object.freeze({ ...review }),
        trustedRunId: source.runId,
        sessionDigest, publicationRevision,
      });
    } catch {
      // Do not reflect session, rights, database, or licensing exceptions.
      return REFUSE;
    }
  }

  const boundary = createPrivateSealedGeometryReadBoundary({
    hmacKey: Buffer.from(cursorHmacKey),
    loadCurrentAuthority, consumeQuota,
    querySealedRpc: rpc.querySealedRpc,
    now,
  });
  return Object.freeze({ readPrivatePage: boundary.readPrivatePage });
}
