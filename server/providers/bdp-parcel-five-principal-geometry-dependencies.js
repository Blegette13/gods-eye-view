import {createPrivateVerifiedGeometryDependencies} from
  './bdp-parcel-verified-geometry-dependencies.js';
import {createPinnedPrivateCurrentRunEpochRpcExecutor} from
  './bdp-parcel-current-sealed-run-epoch-db.js';
import {createPrivateCurrentSealedRunEpochReader} from
  './bdp-parcel-current-sealed-run-epoch.js';

/**
 * Step 40C-46: STRICT FIVE-PRINCIPAL PRIVATE COMPOSITION. UNROUTED.
 *
 * The five independent SQL connection factories are source authority,
 * independent GIS publication review, geometry-only, policy epoch-only,
 * and latest finished sealed-run epoch-only. The latter MUST come from
 * a fixed independently attested SQL reader, NEVER caller/request data.
 *
 * The account/session/county epoch reader remains a trusted injected
 * *synthetic* collaborator: this is NOT real authentication, a real grant
 * store, licensing or geometry delivery. This is not an atomic response release gate.
 * Nothing creates credentials, DB roles, pools, migrations or HTTP routes.
 */
const REQUIRED=[
  'sessionHmacKey','cursorHmacKey','findSessionByDigest','consumeQuota',
  'connectSourceAuthority','sourceAuthorityLogin',
  'connectPublicationReview','publicationReviewLogin',
  'connectSealedGeometry','geometryLogin',
  'connectPolicyEpoch','policyEpochLogin',
  'connectRunEpoch','runEpochLogin','readSessionCountyEpoch',
];
const SQL_CONNECTIONS=[
  'connectSourceAuthority','connectPublicationReview',
  'connectSealedGeometry','connectPolicyEpoch','connectRunEpoch',
];
const SQL_LOGINS=[
  'sourceAuthorityLogin','publicationReviewLogin',
  'geometryLogin','policyEpochLogin','runEpochLogin',
];
const ALLOWED=new Set([...REQUIRED,'now']);
function plain(value) {
  return value&&typeof value==='object'&&!Array.isArray(value)
    &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
}
export function createPrivateFivePrincipalGeometryDependencies(config={}) {
  if(!plain(config)||Object.keys(config).some(k=>!ALLOWED.has(k))
    ||REQUIRED.some(k=>!Object.hasOwn(config,k))
    ||[...SQL_CONNECTIONS,'findSessionByDigest','consumeQuota',
      'readSessionCountyEpoch'].some(k=>typeof config[k]!=='function')
    ||(config.now!==undefined&&typeof config.now!=='function')
    ||SQL_LOGINS.some(k=>typeof config[k]!=='string')
    ||new Set(SQL_CONNECTIONS.map(k=>config[k])).size!==SQL_CONNECTIONS.length
    ||new Set(SQL_LOGINS.map(k=>config[k])).size!==SQL_LOGINS.length) {
    throw new TypeError('Five independent SQL principals and current session epoch required');
  }
  // Private fixed RPC — no arbitrary SQL, user-supplied sealed-run version
  // or fallback to a caller-attested run. The dedicated DB executor checks
  // the pinned login, privileges and exact four-column response on each read.
  const runSql=createPinnedPrivateCurrentRunEpochRpcExecutor({
    connect:config.connectRunEpoch,expectedLogin:config.runEpochLogin,
  });
  const runReader=createPrivateCurrentSealedRunEpochReader({
    queryFixedCurrentRunEpochRpc:runSql.queryFixedCurrentRunEpochRpc,
  });
  // Enumerate the trusted properties rather than forwarding unknown objects
  // to the older v1/v2 synthetic factories.
  const privateRuntime=createPrivateVerifiedGeometryDependencies({
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
    readSessionCountyEpoch:config.readSessionCountyEpoch,
    readSealedRunEpoch:runReader.readSealedRunEpoch,
    ...(config.now?{now:config.now}:{}),
  });
  // Do not expose privileged raw readers or SQL clients, only the existing
  // PRIVATE summary endpoint (no parcel rows and no polygon coordinates).
  return Object.freeze({readPrivatePage:privateRuntime.readPrivatePage});
}
