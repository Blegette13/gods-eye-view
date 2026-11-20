import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Step 40C-8: UNROUTED trusted county-session verification boundary.
 *
 * This is NOT a login, token issuer, cookie parser, database session store,
 * HTTP endpoint, or authorization for county GIS redistribution.
 *
 * Only a trusted server-side HTTP-only cookie transport may supply the opaque
 * 32-byte handle. The HMAC key and session store must be strictly server-only;
 * never accept caller/browser roles, status, MFA claims, grants, or digests.
 *
 * findSessionByDigest MUST read an authoritative, non-stale session/account
 * record, including revocation changes. An eventually consistent cache cannot
 * reliably enforce immediate session revocation.
 */
const HANDLE = /^[A-Za-z0-9_-]{43}$/;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,119}$/;
const COUNTY = /^48[0-9]{3}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_IDLE_MS = 30 * 60 * 1000;
const MAX_COUNTY_GRANTS = 254;

function canonicalHandle(handle) {
  if (typeof handle !== 'string' || !HANDLE.test(handle)) return false;
  const bytes = Buffer.from(handle, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === handle;
}

function validCountyGrants(grants, countyFips) {
  if (!Array.isArray(grants) || grants.length < 1
    || grants.length > MAX_COUNTY_GRANTS) return false;

  let granted = false;
  const unique = new Set();
  for (const grant of grants) {
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)
      || Object.keys(grant).length !== 2
      || typeof grant.countyFips !== 'string' || !COUNTY.test(grant.countyFips)
      || typeof grant.allowParcelDiscovery !== 'boolean'
      || !Object.prototype.hasOwnProperty.call(grant, 'countyFips')
      || !Object.prototype.hasOwnProperty.call(grant, 'allowParcelDiscovery')
      || unique.has(grant.countyFips)) return false;
    unique.add(grant.countyFips);
    if (grant.countyFips === countyFips && grant.allowParcelDiscovery) granted = true;
  }
  return granted;
}

function verifiedRecord(record, digest, countyFips, nowMs) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || typeof record.sessionDigest !== 'string' || !DIGEST.test(record.sessionDigest)
    || !timingSafeEqual(Buffer.from(record.sessionDigest, 'hex'), Buffer.from(digest, 'hex'))
    || typeof record.subject !== 'string' || !SUBJECT.test(record.subject)
    || record.accountStatus !== 'active' || record.mfaVerified !== true
    || record.revokedAtMs !== null
    || !Number.isSafeInteger(record.issuedAtMs)
    || !Number.isSafeInteger(record.lastSeenAtMs)
    || !Number.isSafeInteger(record.expiresAtMs)
    || record.issuedAtMs <= 0 || record.issuedAtMs > nowMs
    || record.lastSeenAtMs < record.issuedAtMs || record.lastSeenAtMs > nowMs
    || record.expiresAtMs <= nowMs || record.expiresAtMs <= record.issuedAtMs
    || record.expiresAtMs - record.issuedAtMs > MAX_SESSION_MS
    || nowMs - record.lastSeenAtMs > MAX_IDLE_MS
    || !validCountyGrants(record.countyGrants, countyFips)) return null;

  // Return exactly the minimal proof expected by the source/run resolver.
  // The record's browser-unsafe fields are never copied to the result.
  return Object.freeze({
    authenticated: true,
    accountStatus: 'active',
    mfaVerified: true,
    revokedAtMs: null,
    countyFips,
    allowParcelDiscovery: true,
    subject: record.subject,
  });
}

/**
 * The caller MUST supply a distinct 32+-byte HMAC key kept out of source
 * control, plus an authoritative lookup keyed ONLY by the HMAC digest.
 * Returned records must be checked against actual active account and MFA
 * state. Login issuance, rotation, idle-touch and logout are external.
 */
export function createTrustedParcelCountySessionVerifier({
  sessionHmacKey,
  findSessionByDigest,
  now = Date.now,
} = {}) {
  if (!(sessionHmacKey instanceof Uint8Array)
    || sessionHmacKey.byteLength < 32
    || typeof findSessionByDigest !== 'function'
    || typeof now !== 'function') {
    throw new TypeError('Server HMAC key, authoritative session lookup and trusted clock required');
  }

  const key = Buffer.from(sessionHmacKey);
  return async function verifyCountySession({ sessionHandle, countyFips, signal } = {}) {
    if (!canonicalHandle(sessionHandle)
      || typeof countyFips !== 'string' || !COUNTY.test(countyFips)
      || (signal !== undefined && !(signal instanceof AbortSignal))
      || signal?.aborted) return null;

    const digest = createHmac('sha256', key).update(sessionHandle, 'utf8').digest('hex');
    try {
      // No session identifiers or token metadata should ever be logged.
      const record = await findSessionByDigest(digest);
      if (signal?.aborted) return null;
      const nowMs = now(); // Recheck time after potentially slow session lookup.
      if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return null;
      return verifiedRecord(record, digest, countyFips, nowMs);
    } catch {
      // Generic deny: never disclose account, source, or cookie existence.
      return null;
    }
  };
}
