import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { createTrustedEvidenceSessionResolver } from './bdp-evidence-auth.js';
import { createRegulatoryEvidenceGate } from '../../src/bdp/regulatory/evidenceAccessPolicy.js';
import {
  createSessionBoundEvidenceService, EVIDENCE_DB_SESSION_PROBE,
} from './bdp-evidence-session.js';

const key = Buffer.alloc(32, 0x56); // synthetic TEST key only
const handle = Buffer.alloc(32, 0x39).toString('base64url');
const digest = createHmac('sha256', key).update(handle).digest('hex');
const nowMs = Date.UTC(2026, 9, 28, 20, 0, 0);
const scope = { countyFips: '48453', parcelId: '302959' };

function record(overrides = {}) {
  return {
    sessionDigest: digest,
    subject: 'operator-123',
    accountStatus: 'active',
    mfaVerified: true,
    revokedAtMs: null,
    issuedAtMs: nowMs - 60 * 60 * 1000,
    lastSeenAtMs: nowMs - 2 * 60 * 1000,
    expiresAtMs: nowMs + 60 * 60 * 1000,
    roles: ['evidence-researcher'],
    parcelGrants: [scope],
    ...overrides,
  };
}
function resolver(value = record(), onLookup = () => {}) {
  return createTrustedEvidenceSessionResolver({
    sessionHmacKey: key,
    now: () => nowMs,
    findSessionByDigest: async (lookup) => {
      onLookup(lookup);
      return value;
    },
  });
}

test('requires server-side 32+ byte HMAC secret and trusted lookup', () => {
  assert.throws(() => createTrustedEvidenceSessionResolver(), /server HMAC key/);
  assert.throws(() => createTrustedEvidenceSessionResolver({
    sessionHmacKey: Buffer.alloc(16), findSessionByDigest: async () => null,
  }), /server HMAC key/);
  assert.throws(() => createTrustedEvidenceSessionResolver({
    sessionHmacKey: 'client-supplied-string', findSessionByDigest: async () => null,
  }), /server HMAC key/);
  assert.throws(() => createTrustedEvidenceSessionResolver({
    sessionHmacKey: key,
  }), /server HMAC key/);
});

test('malformed or missing 32-byte opaque handle cannot query session store', async () => {
  let queries = 0;
  const resolve = resolver(record(), () => { queries++; });
  for (const bad of [null, undefined, {}, [], '', 'bdp-owner',
    Buffer.alloc(31, 4).toString('base64url'),
    Buffer.alloc(33, 4).toString('base64url'),
    handle + '=', 'Bearer ' + handle]) {
    await assert.rejects(resolve(bad), /access denied/);
  }
  assert.equal(queries, 0);
});

test('only HMAC digest reaches trusted server lookup, never raw token', async () => {
  const seen = [];
  const resolved = await resolver(record(), (d) => seen.push(d))(handle);
  assert.deepEqual(seen, [digest]);
  assert.notEqual(digest, handle);
  assert.equal(resolved.authenticated, true);
  assert.equal(resolved.subject, 'operator-123');
  assert.deepEqual(resolved.roles, ['evidence-researcher']);
  assert.deepEqual(resolved.parcelGrants, [scope]);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.roles), true);
  assert.equal(Object.isFrozen(resolved.parcelGrants[0]), true);
  assert.equal('sessionDigest' in resolved, false);
  assert.equal('mfaVerified' in resolved, false);
  assert.equal('legalClearance' in resolved, false);
});

test('deleted, mismatched digest and store failure all deny access', async () => {
  for (const value of [null, [], {}, record({ sessionDigest: '00'.repeat(32) }),
    record({ sessionDigest: 'not-hex' })]) {
    await assert.rejects(resolver(value)(handle), /access denied/);
  }
  const resolve = createTrustedEvidenceSessionResolver({
    sessionHmacKey: key,
    now: () => nowMs,
    findSessionByDigest: async () => { throw new Error('DB disconnected'); },
  });
  await assert.rejects(resolve(handle), /access denied/);
});

test('revoked, inactive, non-MFA, expired, too-old and idle sessions fail closed', async () => {
  const patches = [
    { accountStatus: 'disabled' },
    { mfaVerified: false },
    { revokedAtMs: nowMs - 1 },
    { revokedAtMs: undefined },
    { expiresAtMs: nowMs },
    { expiresAtMs: nowMs - 1000 },
    { expiresAtMs: nowMs + 9 * 60 * 60 * 1000 },
    { issuedAtMs: nowMs + 1000 },
    { lastSeenAtMs: nowMs + 1000 },
    { lastSeenAtMs: nowMs - 31 * 60 * 1000 },
    { lastSeenAtMs: nowMs - 2 * 60 * 60 * 1000 },
    { issuedAtMs: 'yesterday' },
  ];
  for (const patch of patches) {
    await assert.rejects(resolver(record(patch))(handle), /access denied/,
      JSON.stringify(patch));
  }
});

test('unknown roles, wildcard grants, duplicate or mixed-county scopes fail closed', async () => {
  const patches = [
    { roles: ['owner'] },
    { roles: [] },
    { roles: ['evidence-reader', 'evidence-reader'] },
    { roles: ['evidence-researcher', 'verify-legal'] },
    { parcelGrants: [] },
    { parcelGrants: [scope, scope] },
    { parcelGrants: [{ countyFips: '48029', parcelId: '*' }] },
    { parcelGrants: [{ countyFips: '06037', parcelId: '302959' }] },
    { parcelGrants: [{ ...scope, legalClearance: true }] },
    { subject: 'operator;DROP' },
  ];
  for (const patch of patches) {
    await assert.rejects(resolver(record(patch))(handle), /access denied/,
      JSON.stringify(patch));
  }
});

test('real Step 45 gate accepts authoritative identity but denies other parcels and forbidden actions', async () => {
  const gate = createRegulatoryEvidenceGate(resolver());
  const granted = await gate(handle, 'read-index', scope);
  assert.equal(granted.subject, 'operator-123');
  assert.equal(granted.legalClearance, null);
  await assert.rejects(gate(handle, 'read-index', {
    countyFips: '48453', parcelId: '302960',
  }), /access denied/);
  await assert.rejects(gate(handle, 'verify-legal-clearance', scope), /access denied/);
});

test('trusted session can feed Step 49 pinned DB contract without browser roles', async () => {
  let connectionCount = 0;
  let queryCount = 0;
  const service = createSessionBoundEvidenceService({
    resolveAuthenticatedIdentity: resolver(),
    resolveOperatorDbLogin: async ({ subject }) => {
      assert.equal(subject, 'operator-123');
      return 'bdp_operator_test123';
    },
    withOperatorDbConnection: async ({ login, operation, mustPinConnection }, task) => {
      assert.equal(login, 'bdp_operator_test123');
      assert.equal(operation, 'read-index');
      assert.equal(mustPinConnection, true);
      connectionCount++;
      return task({
        query: async (sql) => {
          queryCount++;
          if (sql === EVIDENCE_DB_SESSION_PROBE) return {
            sessionUser: login, currentUser: login, isSuperuser: false,
            bypassRls: false, canLogin: true,
            readerRoleUsable: true, appenderRoleUsable: false,
          };
          assert.match(sql, /parcel_id = '302959'/);
          return { ...scope, totalEvents: 0, returnedEvents: 0,
            truncated: false, events: [], verifiedTasks: 0,
            legalClearance: null, acquisitionRecommendation: null };
        },
      });
    },
  });
  const output = await service.readIndex(handle, scope);
  assert.equal(output.legalClearance, null);
  assert.equal(connectionCount, 1);
  assert.equal(queryCount, 2);
  await assert.rejects(service.readIndex('forged-bearer', scope), /access denied/);
  assert.equal(connectionCount, 1);
});
