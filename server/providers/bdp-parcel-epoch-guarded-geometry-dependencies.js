import { createPrivateVerifiedGeometryDependencies } from
  './bdp-parcel-verified-geometry-dependencies.js';

/**
 * Step 40C-42: strict epoch-aware PRIVATE v2 composition.
 *
 * NEVER routes to HTTP/browser, creates a database pool, grants GIS licenses,
 * or publishes coordinates. A synthetic trusted epoch callback is NOT a
 * deployed session/county or sealed-run revision authority.
 *
 * All four SQL connection factories must be separately provisioned, and the
 * account/session + sealed-run epoch callbacks must be strongly current
 * independently controlled stores. Untrusted request data must NEVER supply
 * these dependencies. Pre/post checks are not an atomic delivery gate.
 */
const REQUIRED=[
  'sessionHmacKey','cursorHmacKey','findSessionByDigest','consumeQuota',
  'connectSourceAuthority','sourceAuthorityLogin',
  'connectPublicationReview','publicationReviewLogin',
  'connectSealedGeometry','geometryLogin',
  'connectPolicyEpoch','policyEpochLogin',
  'readSessionCountyEpoch','readSealedRunEpoch',
];
const ALLOWED=new Set([...REQUIRED,'now']);
export function createPrivateEpochGuardedGeometryDependencies(config={}) {
  if(!config||typeof config!=='object'||Array.isArray(config)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(config))
    ||Object.keys(config).some(k=>!ALLOWED.has(k))
    ||REQUIRED.some(k=>!Object.hasOwn(config,k))
    ||typeof config.readSessionCountyEpoch!=='function'
    ||typeof config.readSealedRunEpoch!=='function') {
    throw new TypeError('All four separate trusted SQL principals and independent session/run epochs required');
  }
  return createPrivateVerifiedGeometryDependencies(config);
}
