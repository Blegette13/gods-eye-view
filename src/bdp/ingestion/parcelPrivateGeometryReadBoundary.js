import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import {
  createPrivateParcelKeysetPagination,
  PRIVATE_PARCEL_KEYSET_RPC_SQL,
} from './parcelKeysetPagination.js';
import {
  PRIVATE_SEALED_INITIAL_RPC_SQL,
  buildPrivateSealedInitialRpcStatement,
} from './parcelSealedInitialPagePlan.js';
import { validatePrivateSealedGeometryPage } from './parcelSealedGeometryPageValidator.js';

/**
 * Step 40C-32: UNROUTED, PRIVATE-ONLY composition for synthetic integration.
 *
 * This is NOT an HTTP endpoint, a data-access approval, a PostGIS connection,
 * an authenticated cookie reader, a database schema migration, or a geometry
 * publishing service. Real implementations of every injected collaborator
 * require security and GIS-license review before they could be connected.
 *
 * loadCurrentAuthority must re-read a trusted server session and county/source
 * entitlement, approved caching policy, independent geometry redistribution
 * review and immutable run binding EVERY time it is called (before AND after
 * the SQL query). Quota must be atomically enforced by a trusted server.
 * querySealedRpc must be wired ONLY to a least-privileged reviewed connection
 * that can execute the two fixed, sealed RPCs, never an arbitrary SQL reader.
 *
 * Successful results return counts and a PRIVATE signed continuation position
 * only. NO geometry or legal/viewport-completeness claims ever leave here.
 */

const SHA256 = /^[0-9a-f]{64}$/;
const HANDLE = /^[A-Za-z0-9_-]{43}$/;
const AUTH_KEYS = [
  'allowed', 'countyFips', 'trustedSource', 'trustedPublicationRights',
  'trustedRunId', 'sessionDigest', 'publicationRevision',
];
const REQUEST_KEYS = ['countyFips', 'bounds', 'limit'];
const BOUNDS_KEYS = ['west', 'south', 'east', 'north'];
const INPUT_KEYS = ['sessionHandle','request','cursorToken','signal'];
const DENIED = Object.freeze({
  status:'unavailable', publishAuthorized:false, viewportCoverage:'unknown',
  geometryDelivered:false,
});
const CANCELLED = Object.freeze({
  status:'cancelled', publishAuthorized:false, viewportCoverage:'unknown',
  geometryDelivered:false,
});
function exact(v, keys) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto=Object.getPrototypeOf(v);
  return (proto === Object.prototype || proto === null)
    && Object.keys(v).length === keys.length
    && keys.every(k => Object.hasOwn(v,k));
}
function validHandle(v) {
  if (typeof v !== 'string' || !HANDLE.test(v)) return false;
  const bytes=Buffer.from(v,'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === v;
}
function trustedAuthorization(auth, plan) {
  return exact(auth, AUTH_KEYS) && auth.allowed === true
    && auth.countyFips === plan.countyFips
    && Number.isSafeInteger(auth.trustedRunId) && auth.trustedRunId > 0
    && typeof auth.sessionDigest === 'string' && SHA256.test(auth.sessionDigest)
    && typeof auth.publicationRevision === 'string'
    && SHA256.test(auth.publicationRevision);
}
function sameAuthority(before, after) {
  // A changed review or scope requires a fresh request, not a stale page.
  return before.sessionDigest === after.sessionDigest
    && before.publicationRevision === after.publicationRevision
    && before.countyFips === after.countyFips
    && before.trustedRunId === after.trustedRunId
    && before.trustedSource?.sourceId === after.trustedSource?.sourceId;
}
function context(auth, plan) {
  return {
    plan, trustedSourceId:auth.trustedSource.sourceId,
    trustedRunId:auth.trustedRunId,
    sessionDigest:auth.sessionDigest,
    publicationRevision:auth.publicationRevision,
  };
}
function validatePrivate(auth, plan, rows, nowMs, afterKey=null) {
  return validatePrivateSealedGeometryPage({
    plan, rows, trustedSource:auth.trustedSource,
    trustedRunId:auth.trustedRunId,
    trustedPublicationRights:auth.trustedPublicationRights,
    nowMs, afterKey,
  });
}

export function createPrivateSealedGeometryReadBoundary({
  hmacKey, loadCurrentAuthority, consumeQuota, querySealedRpc,
  now=Date.now,
}={}) {
  if (typeof loadCurrentAuthority !== 'function'
    || typeof consumeQuota !== 'function'
    || typeof querySealedRpc !== 'function'
    || typeof now !== 'function') {
    throw new TypeError('Private authority, quota, fixed-RPC query and clock are mandatory');
  }
  const paging=createPrivateParcelKeysetPagination({ hmacKey, now });

  return Object.freeze({
    async readPrivatePage(input) {
      // Neither the request nor its cursor is allowed to convey source IDs,
      // database roles, GIS approval flags or a session-store identity.
      if (!exact(input, INPUT_KEYS)
        || !exact(input.request, REQUEST_KEYS)
        || !exact(input.request.bounds, BOUNDS_KEYS)
        || !validHandle(input.sessionHandle)
        || !(input.signal instanceof AbortSignal)
        || (input.cursorToken !== null && typeof input.cursorToken !== 'string')) return DENIED;
      if (input.signal.aborted) return CANCELLED;
      const plan=parseBoundedParcelPageRequest(input.request);
      if (!plan) return DENIED;

      try {
        const auth=await loadCurrentAuthority(Object.freeze({
          sessionHandle:input.sessionHandle, countyFips:plan.countyFips,
          signal:input.signal,
        }));
        if (input.signal.aborted) return CANCELLED;
        const start=now();
        if (!Number.isSafeInteger(start) || start <= 0
          || !trustedAuthorization(auth,plan)
          || validatePrivate(auth,plan,[],start).status !== 'validated-private') {
          return DENIED;
        }

        // The caller must implement an atomic distributed budget. Absence
        // or a truthy nonboolean answer cannot authorize an expensive query.
        const quota=await consumeQuota(Object.freeze({
          sessionHandle:input.sessionHandle, countyFips:plan.countyFips,
          signal:input.signal,
        }));
        if (input.signal.aborted) return CANCELLED;
        if (quota !== true) return DENIED;

        const scope=context(auth,plan);
        const continuation=input.cursorToken !== null;
        const statement=continuation
          ? paging.planContinuation({context:scope,token:input.cursorToken})
          : buildPrivateSealedInitialRpcStatement({
            plan, trustedSourceId:auth.trustedSource.sourceId,
            trustedRunId:auth.trustedRunId,
          });
        if (!statement || !Object.isFrozen(statement.values)
          || statement.text !== (continuation
            ? PRIVATE_PARCEL_KEYSET_RPC_SQL
            : PRIVATE_SEALED_INITIAL_RPC_SQL)) return DENIED;

        const afterKey=continuation ? Object.freeze({
          sourceParcelId:statement.values[8],
          parcelVersionId:statement.values[9],
        }) : null;
        const rows=await querySealedRpc(Object.freeze({
          statement:Object.freeze({
            text:statement.text, values:statement.values,
          }),
          signal:input.signal,
        }));
        if (input.signal.aborted) return CANCELLED;
        // All SQL rows, including overflow, are validated as a whole.
        if (!Array.isArray(rows)) return DENIED;
        const staged=validatePrivate(auth,plan,rows,now(),afterKey);
        if (staged.status !== 'validated-private') return DENIED;

        // Re-read current user/county, caching and redistribution rights
        // AFTER the SQL read; a revoked/changed policy rejects all results.
        const fresh=await loadCurrentAuthority(Object.freeze({
          sessionHandle:input.sessionHandle, countyFips:plan.countyFips,
          signal:input.signal,
        }));
        if (input.signal.aborted) return CANCELLED;
        if (!trustedAuthorization(fresh,plan) || !sameAuthority(auth,fresh)
          || validatePrivate(fresh,plan,rows,now(),afterKey).status !== 'validated-private') {
          return DENIED;
        }

        // Only a token position, not polygons, metadata, SQL or source
        // authority, may be returned by this PRIVATE INTERNAL boundary.
        const validatedPage={
          status:'validated-private',featureCount:staged.featureCount,
          overflow:staged.overflow,viewportCoverage:'unknown',
          publishAuthorized:false,
        };
        const cursor=staged.overflow
          ? paging.issueContinuation({
            context:context(fresh,plan),rows,validatedPage,
          })
          : null;
        if (staged.overflow && cursor === null) return DENIED;
        if (input.signal.aborted) return CANCELLED;
        return Object.freeze({
          status:'validated-private',
          featureCount:staged.featureCount,overflow:staged.overflow,
          nextPrivateCursor:cursor,
          publishAuthorized:false,viewportCoverage:'unknown',
          geometryDelivered:false,
        });
      } catch {
        // Never reflect private SQL, cookies, GIS, JWT/HMAC or reviewer detail.
        return input.signal.aborted ? CANCELLED : DENIED;
      }
    },
  });
}
