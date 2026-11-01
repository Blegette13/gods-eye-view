import { createTrustedParcelCountySessionVerifier } from './bdp-parcel-county-session.js';
import { createAuthorizedParcelSourceResolver } from './bdp-parcel-source-resolver.js';
import { createRestrictedParcelRpcReaders } from './bdp-parcel-restricted-rpc-readers.js';
import { createParcelViewportMetadataService } from './bdp-parcel-viewport-metadata.js';

/**
 * Step 40C-11: secure-by-construction, UNROUTED metadata runtime composition.
 *
 * This composes the staged pieces without exposing raw source and parcel IDs
 * or a general SQL interface to any HTTP caller. Not an HTTP endpoint, login,
 * source license, connection pool, geometry API, or production deployment.
 *
 * Dependencies MUST be controlled by the trusted server entrypoint:
 * - connect: a pinned pg client factory with separately reviewed RESTRICTED
 *   database credentials, bounded acquisition, and no direct table grants;
 * - findSessionByDigest: a strongly current authoritative session store;
 * - sessionHmacKey: server-secret 32+ byte key, never bundled or logged;
 * - now: trusted server clock (optional).
 *
 * Importing or calling this factory never opens a connection or starts a
 * listener. It never creates accounts, sessions, DB roles or GIS records.
 * Real authentication and per-user quotas must be reviewed before HTTP use.
 */
const CONFIG_KEYS = new Set([
  'connect', 'findSessionByDigest', 'sessionHmacKey', 'now',
  'maxConcurrent', 'statementTimeoutMs',
]);

export function createParcelMetadataRuntime(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Server-side parcel runtime configuration is required');
  }
  const proto = Object.getPrototypeOf(config);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError('Parcel runtime configuration must be a plain object');
  }
  if (Object.keys(config).some((key) => !CONFIG_KEYS.has(key))) {
    throw new TypeError('Unknown parcel runtime option; refuse browser or policy overrides');
  }
  const {
    connect, findSessionByDigest, sessionHmacKey,
    now = Date.now, maxConcurrent, statementTimeoutMs,
  } = config;

  const verifyCountySession = createTrustedParcelCountySessionVerifier({
    sessionHmacKey, findSessionByDigest, now,
  });
  const readers = createRestrictedParcelRpcReaders({ connect });
  const resolveAuthorizedSource = createAuthorizedParcelSourceResolver({
    verifyCountySession,
    readApprovedSources: readers.readApprovedSources,
    now,
  });
  const readViewportMetadata = createParcelViewportMetadataService({
    resolveAuthorizedSource,
    query: readers.queryViewport,
    now,
    ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
    ...(statementTimeoutMs === undefined ? {} : { statementTimeoutMs }),
  });

  // Deliberately do not return the raw database readers, trusted resolver,
  // session verifier, pooled connection, HMAC key, or credentials.
  return Object.freeze({ readViewportMetadata });
}
