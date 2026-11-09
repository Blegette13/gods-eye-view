import { createPrivateSealedGeometryRuntime } from './bdp-parcel-sealed-geometry-runtime.js';
import { createPinnedSealedSourceAuthorityRpcExecutor } from './bdp-parcel-sealed-source-authority-db.js';
import { createPrivateSealedSourceAuthorityReader } from './bdp-parcel-sealed-source-authority.js';
import { createPinnedGeometryPublicationReviewRpcExecutor } from './bdp-parcel-geometry-publication-review-db.js';
import { createPrivateGeometryPublicationReviewReader } from './bdp-parcel-geometry-publication-review.js';
import { createPrivatePolicyEpochReader } from './bdp-parcel-policy-epoch-reader.js';
import { createPinnedPrivatePolicyEpochRpcExecutor } from './bdp-parcel-policy-epoch-db.js';

/**
 * Step 40C-37 — PRIVATE ONLY / UNROUTED cross-principal dependency composition.
 *
 * The session HMAC verifier, sealed-run source authority, INDEPENDENT geometry
 * publication review, quota gate and sealed geometry reader were introduced
 * in 40C-8/32/33/34/35/36. This factory wires their already-bounded PRIVATE
 * interfaces; it does NOT create actual authentication, cookie transport,
 * a rights grant, an ingest process, DB connections, login credentials, an
 * HTTP endpoint or a browser geometry service. All DB connections MUST be
 * independently provisioned, authenticated and reviewed by the operator.
 *
 * Trusted dependencies must be supplied exclusively by server startup config.
 * - findSessionByDigest MUST consult a strongly current store on EVERY
 *   pre/post check, including account, MFA, grants and logout revocation.
 * - connectSourceAuthority MUST be a pinned separate source-only SQL LOGIN.
 * - connectPublicationReview MUST be a pinned independent review-only LOGIN.
 * - connectSealedGeometry MUST be a different geometry-only SQL LOGIN.
 * - consumeQuota MUST be an atomic, multi-process durable quota gate.
 *
 * A passing isolated test/fake collaborator NEVER proves real GIS licenses,
 * commercial redistribution clearance or a complete viewport. A current
 * review and source seal are NECESSARY, not sufficient, for any future output.
 *
 * Pre/post independent lookups mitigate revoked policy, but are NOT atomic
 * with one another or with the geometry SQL transaction. DBA-reviewed
 * monotonic revocation versions and snapshot-coherence design are REQUIRED
 * before production or any public geometry publishing. NO output contains
 * polygon coordinates or verified legal/buildability/completeness claims.
 */
const REQUIRED=[
  'sessionHmacKey','cursorHmacKey','findSessionByDigest','consumeQuota',
  'connectSourceAuthority','sourceAuthorityLogin',
  'connectPublicationReview','publicationReviewLogin',
  'connectSealedGeometry','geometryLogin',
];
const EPOCH_KEYS=['connectPolicyEpoch','policyEpochLogin',
  'readSessionCountyEpoch','readSealedRunEpoch'];
const ALLOWED=new Set([...REQUIRED,'now',...EPOCH_KEYS]);

function plain(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);
  return prototype===Object.prototype||prototype===null;
}

/** For staged, synthetic, SERVER-ONLY use; never import this in the Vite UI. */
export function createPrivateVerifiedGeometryDependencies(config={}) {
  if(!plain(config)||Object.keys(config).some(k=>!ALLOWED.has(k))
    ||REQUIRED.some(k=>!Object.hasOwn(config,k))
    ||typeof config.findSessionByDigest!=='function'
    ||typeof config.consumeQuota!=='function'
    ||typeof config.connectSourceAuthority!=='function'
    ||typeof config.connectPublicationReview!=='function'
    ||typeof config.connectSealedGeometry!=='function'
    ||(config.now!==undefined&&typeof config.now!=='function')) {
    throw new TypeError('Explicit independently trusted server dependencies required');
  }
  // A strict v2 factory supplies ALL four additional fields. Partial
  // provisioning is rejected, never silently downgraded to v1.
  const epochNames=EPOCH_KEYS.filter(k=>Object.hasOwn(config,k));
  if(epochNames.length!==0&&epochNames.length!==EPOCH_KEYS.length
    ||epochNames.length===EPOCH_KEYS.length&&(
      typeof config.connectPolicyEpoch!=='function'
      ||typeof config.readSessionCountyEpoch!=='function'
      ||typeof config.readSealedRunEpoch!=='function')) {
    throw new TypeError('Independent epoch connection and session/run readers required together');
  }
  const epochMode=epochNames.length===EPOCH_KEYS.length;
  // Connection factories must not silently share a single metadata/owner
  // pool. Factory inequality is a guard, NOT proof of distinct SQL principals:
  // each SQL executor independently checks session_user and exact grants.
  const {connectSourceAuthority,connectPublicationReview,connectSealedGeometry}=config;
  if(connectSourceAuthority===connectPublicationReview
    ||connectSourceAuthority===connectSealedGeometry
    ||connectPublicationReview===connectSealedGeometry
    ||epochMode&&[
      connectSourceAuthority,connectPublicationReview,connectSealedGeometry,
    ].some(fn=>fn===config.connectPolicyEpoch)) {
    throw new TypeError('Separate SQL connection factories are mandatory');
  }
  const now=config.now??Date.now;
  const authorityDb=createPinnedSealedSourceAuthorityRpcExecutor({
    connect:connectSourceAuthority,expectedLogin:config.sourceAuthorityLogin,
  });
  const reviewDb=createPinnedGeometryPublicationReviewRpcExecutor({
    connect:connectPublicationReview,expectedLogin:config.publicationReviewLogin,
  });
  const authority=createPrivateSealedSourceAuthorityReader({
    queryFixedAuthorityRpc:authorityDb.queryFixedAuthorityRpc,now,
  });
  const review=createPrivateGeometryPublicationReviewReader({
    queryFixedPublicationRpc:reviewDb.queryFixedPublicationRpc,now,
  });
  const epoch=epochMode?createPrivatePolicyEpochReader({
    queryFixedEpochRpc:createPinnedPrivatePolicyEpochRpcExecutor({
      connect:config.connectPolicyEpoch,expectedLogin:config.policyEpochLogin,
    }).queryFixedEpochRpc,
  }):null;
  const geometry=createPrivateSealedGeometryRuntime({
    sessionHmacKey:config.sessionHmacKey,cursorHmacKey:config.cursorHmacKey,
    findSessionByDigest:config.findSessionByDigest,
    consumeQuota:config.consumeQuota,
    readSealedSource:authority.readSealedSource,
    readPublicationReview:review.readPublicationReview,
    connect:connectSealedGeometry,geometryLogin:config.geometryLogin,now,
    ...(epochMode?{
      readPolicyEpochSnapshot:epoch.readPolicyEpochSnapshot,
      readSessionCountyEpoch:config.readSessionCountyEpoch,
      readSealedRunEpoch:config.readSealedRunEpoch,
    }:{}),
  });

  // Expose ONLY the already validated private result (counts and a signed
  // server-side cursor). Not an HTTP transport and not publish authorization.
  return Object.freeze({readPrivatePage:geometry.readPrivatePage});
}
