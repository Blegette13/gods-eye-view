/**
 * Step 51: server-only, UNROUTED evidence session lifecycle contract.
 *
 * Does not implement an IdP, database session store, HTTP login endpoint,
 * password authentication, or PostgreSQL operator provisioning.
 *
 * A future trusted IdP verifier must cryptographically verify an external
 * authentication proof and return a fresh MFA-verified subject. A separate
 * authoritative operator registry supplies active status and parcel grants.
 * Never pass a caller-provided "authenticated" flag or browser role claims
 * directly through these callbacks.
 *
 * Opaque session handles are created with Node's CSPRNG, returned ONCE,
 * and never persisted. Only their keyed HMAC-SHA256 digest is stored.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { denyEvidenceAccess } from '../../src/bdp/regulatory/evidenceAccessPolicy.js';

const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,119}$/;
const COUNTY = /^48[0-9]{3}$/;
const PARCEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const ALLOWED_ROLES = new Set(['evidence-reader', 'evidence-researcher']);

const SESSION_LIFETIME_MS = 60 * 60 * 1000;
const AUTH_FRESHNESS_MS = 10 * 60 * 1000;

function digestSession(key, opaqueHandle) {
  return createHmac('sha256', key).update(opaqueHandle, 'utf8').digest('hex');
}

function requireValidIdentityProof(result, nowMs) {
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || typeof result.subject !== 'string' || !SUBJECT.test(result.subject)
    || result.mfaVerified !== true
    || !Number.isSafeInteger(result.authTimeMs)
    || result.authTimeMs > nowMs
    || nowMs - result.authTimeMs > AUTH_FRESHNESS_MS) {
    return denyEvidenceAccess();
  }
  return result.subject;
}

function requireAuthoritativeOperator(operator, subject) {
  if (!operator || typeof operator !== 'object' || Array.isArray(operator)
    || operator.subject !== subject || operator.accountStatus !== 'active'
    || !Array.isArray(operator.roles) || operator.roles.length < 1
    || operator.roles.length > ALLOWED_ROLES.size
    || operator.roles.some((role) => !ALLOWED_ROLES.has(role))
    || new Set(operator.roles).size !== operator.roles.length
    || !Array.isArray(operator.parcelGrants)
    || operator.parcelGrants.length === 0 || operator.parcelGrants.length > 100) {
    return denyEvidenceAccess();
  }
  const grants = [];
  const seen = new Set();
  for (const grant of operator.parcelGrants) {
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)
      || !COUNTY.test(grant.countyFips)
      || !PARCEL.test(grant.parcelId)
      || Object.keys(grant).some((key) => !['countyFips', 'parcelId'].includes(key))) {
      return denyEvidenceAccess();
    }
    const id = `${grant.countyFips}:${grant.parcelId}`;
    if (seen.has(id)) return denyEvidenceAccess();
    seen.add(id);
    grants.push(Object.freeze({
      countyFips: grant.countyFips,
      parcelId: grant.parcelId,
    }));
  }
  return Object.freeze({
    roles: Object.freeze([...operator.roles]),
    parcelGrants: Object.freeze(grants),
  });
}

/**
 * All supplied functions are trusted server dependencies:
 *
 * verifyTrustedSignIn(signInProof) -> {subject, mfaVerified:true, authTimeMs}
 *   Must independently verify a real IdP's signed proof and MFA assurance.
 * lookupActiveOperator({subject}) -> {subject,accountStatus,roles,parcelGrants}
 *   Must query an authoritative, current registry; no client role claims.
 * insertSession(record) -> true
 *   Must atomically insert EXACTLY the supplied digest/record in durable,
 *   private server storage and return true only after commit.
 * revokeSessionByDigest(digest) -> true
 *   Must atomically revoke the matching record, after commit.
 *
 * The store must be consulted by the Step 50 resolver for every evidence
 * request, with prompt revocation when accounts or parcel grants change.
 * No callbacks may be implemented using the local bdp superuser for a web API.
 */
export function createTrustedEvidenceSessionLifecycle({
  sessionHmacKey,
  verifyTrustedSignIn,
  lookupActiveOperator,
  insertSession,
  revokeSessionByDigest,
  now = Date.now,
} = {}) {
  if (!(sessionHmacKey instanceof Uint8Array)
    || sessionHmacKey.byteLength < 32
    || typeof verifyTrustedSignIn !== 'function'
    || typeof lookupActiveOperator !== 'function'
    || typeof insertSession !== 'function'
    || typeof revokeSessionByDigest !== 'function'
    || typeof now !== 'function') {
    throw new TypeError('Trusted IdP verification, registry, session store, revocation and a 32-byte HMAC key are required');
  }
  const hmacKey = Buffer.from(sessionHmacKey);

  return Object.freeze({
    async issue(signInProof) {
      const nowMs = now();
      if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return denyEvidenceAccess();

      let assertion;
      try {
        assertion = await verifyTrustedSignIn(signInProof);
      } catch {
        return denyEvidenceAccess();
      }
      const subject = requireValidIdentityProof(assertion, nowMs);

      let account;
      try {
        account = await lookupActiveOperator({ subject });
      } catch {
        return denyEvidenceAccess();
      }
      const { roles, parcelGrants } = requireAuthoritativeOperator(account, subject);

      // Generate the secret only AFTER successful IdP and account checks.
      const handle = randomBytes(32).toString('base64url');
      const record = Object.freeze({
        sessionDigest: digestSession(hmacKey, handle),
        subject,
        accountStatus: 'active',
        mfaVerified: true,
        revokedAtMs: null,
        issuedAtMs: nowMs,
        lastSeenAtMs: nowMs,
        expiresAtMs: nowMs + SESSION_LIFETIME_MS,
        roles,
        parcelGrants,
      });

      try {
        const persisted = await insertSession(record);
        if (persisted !== true) return denyEvidenceAccess();
      } catch {
        return denyEvidenceAccess();
      }
      // The caller is a trusted server-only route. Never log or persist handle.
      return Object.freeze({ handle, expiresAtMs: record.expiresAtMs });
    },

    async revoke(handle) {
      if (typeof handle !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(handle)) {
        return denyEvidenceAccess();
      }
      const raw = Buffer.from(handle, 'base64url');
      if (raw.length !== 32 || raw.toString('base64url') !== handle) {
        return denyEvidenceAccess();
      }
      try {
        if (await revokeSessionByDigest(digestSession(hmacKey, handle)) !== true) {
          return denyEvidenceAccess();
        }
      } catch {
        return denyEvidenceAccess();
      }
      return true;
    },
  });
}
