import {createPrivateFivePrincipalGeometryDependencies} from
  './bdp-parcel-five-principal-geometry-dependencies.js';
import {createPinnedPrivateSessionCountyEpochRpcExecutor} from
  './bdp-parcel-session-county-epoch-db.js';
import {createPrivateSessionCountyEpochReader} from
  './bdp-parcel-session-county-epoch.js';

/**
 * Step 40C-48 — SIX independently attested SQL principals, PRIVATE ONLY.
 *
 * The sixth reader checks SYNTHETIC server-side session/county grant rows
 * and their immutable epoch, using one dedicated SQL login; the other
 * five remain the fixed source, publication, sealed geometry, policy epoch
 * and latest sealed-run epoch readers. Caller-injected session/run epochs
 * are prohibited, not silently preferred or used as fallback.
 *
 * This staged composition is NOT an account issuer, authenticated identity,
 * actual MFA, actual county entitlement, GIS redistribution license,
 * polygon delivery, HTTP endpoint, or linearizable network release gate.
 * findSessionByDigest MUST later come from a real authoritative identity
 * source with account/MFA/logout/grant revocation. Until then the whole
 * six-principal factory is unrouted, synthetic and NOT production-ready.
 */
const REQUIRED=[
  'sessionHmacKey','cursorHmacKey','findSessionByDigest','consumeQuota',
  'connectSourceAuthority','sourceAuthorityLogin',
  'connectPublicationReview','publicationReviewLogin',
  'connectSealedGeometry','geometryLogin',
  'connectPolicyEpoch','policyEpochLogin',
  'connectRunEpoch','runEpochLogin',
  'connectSessionEpoch','sessionEpochLogin',
];
const SQL_CONNECTIONS=[
  'connectSourceAuthority','connectPublicationReview','connectSealedGeometry',
  'connectPolicyEpoch','connectRunEpoch','connectSessionEpoch',
];
const SQL_LOGINS=[
  'sourceAuthorityLogin','publicationReviewLogin','geometryLogin',
  'policyEpochLogin','runEpochLogin','sessionEpochLogin',
];
const ALLOWED=new Set([...REQUIRED,'now']);
function plain(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const p=Object.getPrototypeOf(value);
  return p===Object.prototype||p===null;
}
export function createPrivateSixPrincipalGeometryDependencies(config={}){
  if(!plain(config)
    ||Object.keys(config).some(k=>!ALLOWED.has(k))
    ||REQUIRED.some(k=>!Object.hasOwn(config,k))
    ||[...SQL_CONNECTIONS,'findSessionByDigest','consumeQuota']
      .some(k=>typeof config[k]!=='function')
    ||(config.now!==undefined&&typeof config.now!=='function')
    ||SQL_LOGINS.some(k=>typeof config[k]!=='string')
    ||new Set(SQL_CONNECTIONS.map(k=>config[k])).size!==SQL_CONNECTIONS.length
    ||new Set(SQL_LOGINS.map(k=>config[k])).size!==SQL_LOGINS.length){
    throw new TypeError('Six independently attested SQL principals required');
  }
  const sessionDb=createPinnedPrivateSessionCountyEpochRpcExecutor({
    connect:config.connectSessionEpoch,
    expectedLogin:config.sessionEpochLogin,
  });
  const sessionReader=createPrivateSessionCountyEpochReader({
    queryFixedSessionCountyEpochRpc:sessionDb.queryFixedSessionCountyEpochRpc,
  });
  // Forward ONLY allowed, explicit source/rights/epoch dependencies to the
  // already-tested five-identity private runtime; it independently attests
  // every other SQL role. Do not forward an untrusted reader from callers.
  const privateRuntime=createPrivateFivePrincipalGeometryDependencies({
    sessionHmacKey:config.sessionHmacKey,
    cursorHmacKey:config.cursorHmacKey,
    findSessionByDigest:config.findSessionByDigest,
    consumeQuota:config.consumeQuota,
    connectSourceAuthority:config.connectSourceAuthority,
    sourceAuthorityLogin:config.sourceAuthorityLogin,
    connectPublicationReview:config.connectPublicationReview,
    publicationReviewLogin:config.publicationReviewLogin,
    connectSealedGeometry:config.connectSealedGeometry,
    geometryLogin:config.geometryLogin,
    connectPolicyEpoch:config.connectPolicyEpoch,
    policyEpochLogin:config.policyEpochLogin,
    connectRunEpoch:config.connectRunEpoch,
    runEpochLogin:config.runEpochLogin,
    readSessionCountyEpoch:sessionReader.readSessionCountyEpoch,
    ...(config.now?{now:config.now}:{}),
  });
  return Object.freeze({readPrivatePage:privateRuntime.readPrivatePage});
}
