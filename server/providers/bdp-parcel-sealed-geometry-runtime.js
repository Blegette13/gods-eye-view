import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createTrustedParcelCountySessionVerifier } from './bdp-parcel-county-session.js';
import { createPrivateSealedGeometryReadBoundary } from '../../src/bdp/ingestion/parcelPrivateGeometryReadBoundary.js';
import { createFixedSealedGeometryRpcReader } from './bdp-parcel-sealed-geometry-rpc.js';
import { isCanonicalPrivatePolicyEpochSnapshot } from './bdp-parcel-policy-epoch-reader.js';

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
  'geometryLogin', 'now', 'readPolicyEpochSnapshot',
  'readSessionCountyEpoch', 'readSealedRunEpoch',
]);
const REFUSE = null;
const PG_MAX=9223372036854775807n;
const EPOCH_CALLBACKS=['readPolicyEpochSnapshot','readSessionCountyEpoch','readSealedRunEpoch'];
function epochValue(value){
  if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/.test(value))return false;
  try{return BigInt(value)<=PG_MAX;}catch{return false;}
}

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
    readPolicyEpochSnapshot,readSessionCountyEpoch,readSealedRunEpoch,
  } = config;
  if (!Buffer.isBuffer(sessionHmacKey) || sessionHmacKey.length < 32
    || !Buffer.isBuffer(cursorHmacKey) || cursorHmacKey.length < 32
    || (sessionHmacKey.length === cursorHmacKey.length
      && timingSafeEqual(sessionHmacKey, cursorHmacKey))
    || [findSessionByDigest, readSealedSource, readPublicationReview,
      consumeQuota, connect, now].some((value) => typeof value !== 'function')) {
    throw new TypeError('Distinct HMAC keys and verified private collaborators required');
  }
  // v1 (no epoch callbacks) is retained for existing isolated tests only.
  // v2 rejects partial epoch provisioning. The strict v2 factory requires
  // all three callbacks and separately pinned epoch-only SQL credentials.
  const supplied=EPOCH_CALLBACKS.filter(k=>Object.hasOwn(config,k));
  if(supplied.length!==0&&supplied.length!==EPOCH_CALLBACKS.length
    ||supplied.length===EPOCH_CALLBACKS.length
      &&[readPolicyEpochSnapshot,readSessionCountyEpoch,readSealedRunEpoch]
        .some(fn=>typeof fn!=='function')) {
    throw new TypeError('All independently trusted epoch readers are mandatory together');
  }
  const epochMode=supplied.length===EPOCH_CALLBACKS.length;
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

      // Step 40C-42: do not infer epochs from the currently approved facts.
      // Epochs are supplied by separate, strongly current authoritative
      // stores. They remain necessary but NOT sufficient for delivery.
      let epochRevisions=null;
      if(epochMode) {
        const session=await readSessionCountyEpoch(Object.freeze({
          sessionDigest,countyFips,signal,
        }));
        if(signal.aborted||!exact(session,['sessionDigest','countyFips','epoch'])
          ||session.sessionDigest!==sessionDigest
          ||session.countyFips!==countyFips||!epochValue(session.epoch))return REFUSE;
        const run=await readSealedRunEpoch(Object.freeze({
          countyFips,sourceId:source.sourceId,runId:source.runId,signal,
        }));
        if(signal.aborted||!exact(run,['countyFips','sourceId','runId','epoch'])
          ||run.countyFips!==countyFips||run.sourceId!==source.sourceId
          ||run.runId!==source.runId||!epochValue(run.epoch))return REFUSE;
        const policy=await readPolicyEpochSnapshot(Object.freeze({
          countyFips,sourceId:source.sourceId,signal,
        }));
        if(signal.aborted||!isCanonicalPrivatePolicyEpochSnapshot(policy)
          ||policy.sourceId!==source.sourceId||policy.countyFips!==countyFips)
          return REFUSE;
        epochRevisions=Object.freeze([
          session.epoch,run.epoch,policy.sourceCacheEpoch,policy.publicationEpoch,
        ]);
        clock=now();
        if(!Number.isSafeInteger(clock)||clock<=0
          ||!validSource(source,countyFips,clock)
          ||!validReview(review,source,clock))return REFUSE;
      }

      // The v2 fingerprint includes transactionally maintained epochs so
      // A→B→A changes invalidate post-read pages AND HMAC-bound keyset cursors.
      // v1 remains unchanged for legacy synthetic regression fixtures.
      const publicationRevision = createHash('sha256').update(JSON.stringify([
        epochMode?'ldos-sealed-geometry-authority-v2':'ldos-sealed-geometry-authority-v1',
        source.sourceId, source.countyFips, source.rightsState,
        source.approvedCachingUntilMs, source.runId, source.sourceVersion,
        source.sealedAtMs, source.indexedRecords, source.sealedRun,
        review.sourceId, review.countyFips, review.reviewState,
        review.allowGeometryRedistribution, review.reviewReference,
        review.reviewedAtMs, review.expiresAtMs,
        ...(epochRevisions??[]),
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
