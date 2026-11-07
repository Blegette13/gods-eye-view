import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { createTrustedEvidenceSessionLifecycle } from './bdp-evidence-lifecycle.js';
import { createTrustedEvidenceSessionResolver } from './bdp-evidence-auth.js';
import { createRegulatoryEvidenceGate } from '../../src/bdp/regulatory/evidenceAccessPolicy.js';

const nowMs = Date.UTC(2026, 9, 28, 20, 0, 0);
const key = Buffer.alloc(32, 0x53); // synthetic TEST key only
const subject = 'operator-123';
const scope = Object.freeze({ countyFips: '48453', parcelId: '302959' });
const verifiedIdpAssertion = Object.freeze({
  subject, mfaVerified: true, authTimeMs: nowMs - 60_000,
});
const account = Object.freeze({
  subject, accountStatus: 'active',
  roles: Object.freeze(['evidence-researcher']),
  parcelGrants: Object.freeze([scope]),
});

function makeFixture(overrides = {}) {
  const sessions = new Map();
  const observed = { verifications: 0, lookups: 0, insertions: 0, revocations: 0 };
  const inputs = {
    sessionHmacKey: key,
    now: () => nowMs,
    verifyTrustedSignIn: async () => {
      observed.verifications++;
      return verifiedIdpAssertion;
    },
    lookupActiveOperator: async () => {
      observed.lookups++;
      return account;
    },
    insertSession: async (record) => {
      observed.insertions++;
      if (sessions.has(record.sessionDigest)) return false;
      sessions.set(record.sessionDigest, record);
      return true;
    },
    revokeSessionByDigest: async (digest) => {
      observed.revocations++;
      const original = sessions.get(digest);
      if (!original) return false;
      sessions.set(digest, { ...original, revokedAtMs: nowMs });
      return true;
    },
    ...overrides,
  };
  return { lifecycle: createTrustedEvidenceSessionLifecycle(inputs), sessions, observed };
}

test('construction requires IdP verifier, active operator registry, private store and strong HMAC key', () => {
  assert.throws(() => createTrustedEvidenceSessionLifecycle(), /Trusted IdP verification/);
  const { lifecycle } = makeFixture();
  assert.equal(typeof lifecycle.issue, 'function');
  assert.equal(typeof lifecycle.revoke, 'function');
  for (const partial of [
    { sessionHmacKey: Buffer.alloc(8) },
    { verifyTrustedSignIn: null },
    { lookupActiveOperator: null },
    { insertSession: null },
    { revokeSessionByDigest: null },
  ]) {
    const complete = {
      sessionHmacKey: key, now: () => nowMs,
      verifyTrustedSignIn: async () => verifiedIdpAssertion,
      lookupActiveOperator: async () => account,
      insertSession: async () => true,
      revokeSessionByDigest: async () => true,
      ...partial,
    };
    assert.throws(() => createTrustedEvidenceSessionLifecycle(complete), /Trusted IdP verification/);
  }
});

test('issue stores only keyed digest and authoritative allowlisted fields, not bearer handle', async () => {
  const { lifecycle, sessions } = makeFixture();
  const { handle, expiresAtMs } = await lifecycle.issue('idp-proof-placeholder-for-mock-only');
  assert.match(handle, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(handle, 'base64url').length, 32);
  assert.equal(expiresAtMs, nowMs + 60 * 60 * 1000);
  assert.equal(sessions.size, 1);
  const [digest, record] = [...sessions.entries()][0];
  assert.equal(digest, createHmac('sha256', key).update(handle).digest('hex'));
  assert.equal(record.sessionDigest, digest);
  assert.equal(record.subject, subject);
  assert.equal(record.mfaVerified, true);
  assert.equal(record.accountStatus, 'active');
  assert.deepEqual(record.roles, ['evidence-researcher']);
  assert.deepEqual(record.parcelGrants, [scope]);
  assert.equal(record.issuedAtMs, nowMs);
  assert.equal(record.lastSeenAtMs, nowMs);
  assert.equal(record.revokedAtMs, null);
  assert.equal(record.expiresAtMs, expiresAtMs);
  assert.equal(JSON.stringify(record).includes(handle), false);
  assert.equal(Object.isFrozen(record), true);
});

test('independent issuance creates unique opaque handles for the same trusted operator', async () => {
  const { lifecycle, sessions } = makeFixture();
  const a = await lifecycle.issue('verified-idp-proof');
  const b = await lifecycle.issue('verified-idp-proof');
  assert.notEqual(a.handle, b.handle);
  assert.equal(sessions.size, 2);
});

test('missing, stale, future or non-MFA IdP assertions fail without recording a session', async () => {
  for (const idpResult of [
    null, {}, { ...verifiedIdpAssertion, mfaVerified: false },
    { ...verifiedIdpAssertion, authTimeMs: nowMs - 11 * 60 * 1000 },
    { ...verifiedIdpAssertion, authTimeMs: nowMs + 1 },
    { ...verifiedIdpAssertion, authTimeMs: 'today' },
    { ...verifiedIdpAssertion, subject: 'bad;subject' },
  ]) {
    const { lifecycle, observed } = makeFixture({
      verifyTrustedSignIn: async () => idpResult,
    });
    await assert.rejects(lifecycle.issue('untrusted-payload'), /access denied/);
    assert.equal(observed.insertions, 0);
  }
});

test('forged client roles cannot override authoritative operator status or parcel grants', async () => {
  const proof = {
    subject: 'operator-123', roles: ['superuser'],
    parcelGrants: [{ countyFips: '48029', parcelId: '*' }],
    legalClearance: true,
  };
  const { lifecycle, sessions } = makeFixture();
  const issued = await lifecycle.issue(proof);
  const [stored] = sessions.values();
  assert.deepEqual(stored.roles, account.roles);
  assert.deepEqual(stored.parcelGrants, account.parcelGrants);
  assert.equal('legalClearance' in stored, false);
  assert.match(issued.handle, /^[A-Za-z0-9_-]{43}$/);
  // Actual IdP verification remains mandatory; the mock verifier above
  // represents a future cryptographic provider, not the caller's proof.
});

test('inactive account, mismatched subject and malformed grants fail closed', async () => {
  for (const changed of [
    { subject: 'another-operator' },
    { accountStatus: 'suspended' },
    { roles: ['admin'] },
    { roles: ['evidence-reader', 'evidence-reader'] },
    { roles: [] },
    { parcelGrants: [] },
    { parcelGrants: [scope, scope] },
    { parcelGrants: [{ countyFips: '48453', parcelId: '*' }] },
    { parcelGrants: [{ countyFips: '06037', parcelId: '302959' }] },
    { parcelGrants: [{ ...scope, legalClearance: true }] },
  ]) {
    const { lifecycle, observed } = makeFixture({
      lookupActiveOperator: async () => ({ ...account, ...changed }),
    });
    await assert.rejects(lifecycle.issue('verified-idp-proof'), /access denied/);
    assert.equal(observed.insertions, 0);
  }
});

test('failed store insert and revocation never return a usable bearer', async () => {
  const { lifecycle, observed } = makeFixture({
    insertSession: async () => false,
    revokeSessionByDigest: async () => false,
  });
  await assert.rejects(lifecycle.issue('verified-idp-proof'), /access denied/);
  await assert.rejects(lifecycle.revoke('untrusted-browser-flag'), /access denied/);
  assert.equal(observed.revocations, 0);
  // Even a correctly shaped nonexisting token cannot report success.
  const fake = Buffer.alloc(32, 9).toString('base64url');
  await assert.rejects(lifecycle.revoke(fake), /access denied/);
});

test('successful revoke propagates to Step 50 resolver and Step 45 parcel gate', async () => {
  const { lifecycle, sessions } = makeFixture();
  const resolve = createTrustedEvidenceSessionResolver({
    sessionHmacKey: key,
    now: () => nowMs,
    findSessionByDigest: async (digest) => sessions.get(digest) || null,
  });
  const gate = createRegulatoryEvidenceGate(resolve);
  const issued = await lifecycle.issue('verified-idp-proof');
  assert.equal((await gate(issued.handle, 'read-index', scope)).subject, subject);
  await assert.rejects(gate(issued.handle, 'read-index', {
    countyFips: '48453', parcelId: '302960',
  }), /access denied/);
  assert.equal(await lifecycle.revoke(issued.handle), true);
  await assert.rejects(gate(issued.handle, 'read-index', scope), /access denied/);
});
