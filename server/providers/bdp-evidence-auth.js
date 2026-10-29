/**
 * Step 50: UNROUTED trusted-session resolution boundary.
 *
 * This is NOT a login endpoint, token issuer, user directory or HTTP cookie
 * parser. A future trusted authentication system must issue cryptographically
 * random, unpredictable 32-byte opaque handles and persist authoritative
 * server-side session records keyed only by an HMAC digest.
 *
 * The caller supplies the opaque handle from a trusted HTTP-only cookie
 * transport, a server-only HMAC key, and a server-only record lookup.
 * Browser-provided roles, scopes, names and "authenticated" flags are NEVER
 * accepted. Do not log handles, digests, or source research data.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { denyEvidenceAccess } from '../../src/bdp/regulatory/evidenceAccessPolicy.js';

const HANDLE = /^[A-Za-z0-9_-]{43}$/;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,119}$/;
const PARCEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const COUNTY = /^48[0-9]{3}$/;
const ROLE_NAMES = new Set(['evidence-reader', 'evidence-researcher']);
const MAX_AGE_MS = 8 * 60 * 60 * 1000;
const MAX_IDLE_MS = 30 * 60 * 1000;

function validOpaqueHandle(handle) {
  if (typeof handle !== 'string' || !HANDLE.test(handle)) return false;
  try {
    const bytes = Buffer.from(handle, 'base64url');
    return bytes.length === 32 && bytes.toString('base64url') === handle;
  } catch {
    return false;
  }
}

function getVerifiedIdentity(record, digestHex, nowMs) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || typeof record.sessionDigest !== 'string'
    || !/^[0-9a-f]{64}$/.test(record.sessionDigest)
    || !timingSafeEqual(Buffer.from(record.sessionDigest, 'hex'), Buffer.from(digestHex, 'hex'))
    || typeof record.subject !== 'string' || !SUBJECT.test(record.subject)
    || record.accountStatus !== 'active'
    || record.mfaVerified !== true
    || record.revokedAtMs !== null
    || !Number.isSafeInteger(record.issuedAtMs)
    || !Number.isSafeInteger(record.lastSeenAtMs)
    || !Number.isSafeInteger(record.expiresAtMs)
    || record.issuedAtMs > nowMs
    || record.lastSeenAtMs < record.issuedAtMs
    || record.lastSeenAtMs > nowMs
    || record.expiresAtMs <= nowMs
    || record.expiresAtMs <= record.issuedAtMs
    || record.expiresAtMs - record.issuedAtMs > MAX_AGE_MS
    || nowMs - record.lastSeenAtMs > MAX_IDLE_MS
    || !Array.isArray(record.roles) || record.roles.length < 1
    || record.roles.length > ROLE_NAMES.size
    || record.roles.some((role) => !ROLE_NAMES.has(role))
    || new Set(record.roles).size !== record.roles.length
    || !Array.isArray(record.parcelGrants)
    || record.parcelGrants.length === 0 || record.parcelGrants.length > 100) {
    return denyEvidenceAccess();
  }

  const grants = [];
  const deduplicated = new Set();
  for (const grant of record.parcelGrants) {
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)
      || typeof grant.countyFips !== 'string' || !COUNTY.test(grant.countyFips)
      || typeof grant.parcelId !== 'string' || !PARCEL.test(grant.parcelId)
      || Object.keys(grant).some((field) => !['countyFips', 'parcelId'].includes(field))) {
      return denyEvidenceAccess();
    }
    const key = `${grant.countyFips}:${grant.parcelId}`;
    if (deduplicated.has(key)) return denyEvidenceAccess();
    deduplicated.add(key);
    grants.push(Object.freeze({ countyFips: grant.countyFips, parcelId: grant.parcelId }));
  }

  return Object.freeze({
    authenticated: true,
    subject: record.subject,
    roles: Object.freeze([...record.roles]),
    parcelGrants: Object.freeze(grants),
  });
}

/**
 * findSessionByDigest(digestHex) MUST be a trusted unique lookup with the
 * actual active account / MFA / revocation state checked against the server
 * authority. Cached stale revocation data must fail closed.
 *
 * The key is a non-logged 32+ byte server secret separate from all tokens.
 * All session renewal and revocation are handled by a future identity system.
 */
export function createTrustedEvidenceSessionResolver({
  sessionHmacKey,
  findSessionByDigest,
  now = Date.now,
} = {}) {
  if (!(sessionHmacKey instanceof Uint8Array)
    || sessionHmacKey.byteLength < 32
    || typeof findSessionByDigest !== 'function'
    || typeof now !== 'function') {
    throw new TypeError('A 32-byte server HMAC key, trusted session store and clock are required');
  }
  const key = Buffer.from(sessionHmacKey);
  return async (sessionHandle) => {
    if (!validOpaqueHandle(sessionHandle)) return denyEvidenceAccess();
    const nowMs = now();
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return denyEvidenceAccess();
    const digestHex = createHmac('sha256', key).update(sessionHandle, 'utf8').digest('hex');
    let record;
    try {
      record = await findSessionByDigest(digestHex);
    } catch {
      return denyEvidenceAccess();
    }
    return getVerifiedIdentity(record, digestHex, nowMs);
  };
}
