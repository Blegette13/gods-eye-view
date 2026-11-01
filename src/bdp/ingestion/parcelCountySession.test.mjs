import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createTrustedParcelCountySessionVerifier } from '../../../server/providers/bdp-parcel-county-session.js';
import { createAuthorizedParcelSourceResolver } from '../../../server/providers/bdp-parcel-source-resolver.js';
import { createParcelViewportMetadataService } from '../../../server/providers/bdp-parcel-viewport-metadata.js';

const key = randomBytes(48);
const handle = randomBytes(32).toString('base64url');
const digest = createHmac('sha256', key).update(handle, 'utf8').digest('hex');
const nowMs = 10_000_000;
const validRecord = () => ({
  sessionDigest: digest,
  subject: 'test-operator',
  accountStatus: 'active',
  mfaVerified: true,
  revokedAtMs: null,
  issuedAtMs: nowMs - 10_000,
  lastSeenAtMs: nowMs - 5_000,
  expiresAtMs: nowMs + 100_000,
  countyGrants: [
    { countyFips: '48453', allowParcelDiscovery: true },
    { countyFips: '48029', allowParcelDiscovery: false },
  ],
  roles: ['irrelevant-browser-style-data'], // Must not be forwarded.
});
const make = ({ find = async () => validRecord(), now = () => nowMs, secret = key } = {}) =>
  createTrustedParcelCountySessionVerifier({
    sessionHmacKey: secret, findSessionByDigest: find, now,
  });
const check = (verifier, overrides = {}) => verifier({
  sessionHandle: handle, countyFips: '48453', ...overrides,
});

test('rejects absent/short secrets, missing authoritative store and invalid clock', () => {
  assert.throws(() => createTrustedParcelCountySessionVerifier(), TypeError);
  assert.throws(() => make({ secret: randomBytes(16) }), TypeError);
  assert.throws(() => make({ find: null }), TypeError);
  assert.throws(() => make({ now: 'client clock' }), TypeError);
});

test('accepts canonical 32-byte handle with HMAC-bound record; returns only minimal proof', async () => {
  let count = 0;
  const verifier = make({ find: async (lookupDigest) => {
    count++;
    assert.equal(lookupDigest, digest);
    assert.equal(lookupDigest.length, 64);
    assert.notEqual(lookupDigest, handle);
    return validRecord();
  } });
  const result = await check(verifier);
  assert.deepEqual(result, {
    authenticated: true, accountStatus: 'active', mfaVerified: true,
    revokedAtMs: null, countyFips: '48453',
    allowParcelDiscovery: true, subject: 'test-operator',
  });
  assert.ok(Object.isFrozen(result));
  assert.equal(count, 1);
  assert.ok(!JSON.stringify(result).includes(digest));
  assert.ok(!JSON.stringify(result).includes(handle));
  assert.ok(!JSON.stringify(result).includes('roles'));
});

test('browser-style handles, invalid FIPS and fake abort signals never query store', async () => {
  let count = 0;
  const verifier = make({ find: async () => { count++; return validRecord(); } });
  for (const params of [
    { sessionHandle: undefined },
    { sessionHandle: 'client-supplied-admin' },
    { sessionHandle: 'a'.repeat(43) },
    { sessionHandle: handle + 'a' },
    { countyFips: '06037' },
    { countyFips: 48453 },
    { countyFips: '4845' },
    { signal: { aborted: false } },
  ]) assert.equal(await check(verifier, params), null);
  assert.equal(count, 0);
});

test('wrong HMAC key, invalid digest, malformed subjects and missing record deny access', async () => {
  assert.equal(await check(make({ secret: randomBytes(48) })), null);
  for (const record of [
    null, { ...validRecord(), sessionDigest: 'not-a-digest' },
    { ...validRecord(), sessionDigest: digest.toUpperCase() },
    { ...validRecord(), subject: 'bad subject' },
    { ...validRecord(), subject: '' },
  ]) assert.equal(await check(make({ find: async () => record })), null);
});

test('revoked, inactive and unverified accounts are always rejected', async () => {
  for (const diff of [
    { accountStatus: 'disabled' }, { accountStatus: 'suspended' },
    { mfaVerified: false }, { revokedAtMs: nowMs - 1 },
    { revokedAtMs: undefined },
  ]) assert.equal(await check(make({ find: async () => ({ ...validRecord(), ...diff }) })), null);
});

test('expired, idle, future-issued and overlong sessions fail closed', async () => {
  for (const diff of [
    { expiresAtMs: nowMs },
    { issuedAtMs: nowMs + 1 },
    { lastSeenAtMs: nowMs + 1 },
    { lastSeenAtMs: nowMs - 30 * 60 * 1000 - 1 },
    { issuedAtMs: nowMs - 8 * 60 * 60 * 1000 - 1,
      lastSeenAtMs: nowMs - 1, expiresAtMs: nowMs + 1 },
    { issuedAtMs: nowMs - 1, expiresAtMs: nowMs - 1 },
    { expiresAtMs: 'tomorrow' },
  ]) assert.equal(await check(make({ find: async () => ({ ...validRecord(), ...diff }) })), null);
});

test('exact county grant required; denied county is not a wildcard', async () => {
  const verifier = make();
  assert.equal(await check(verifier, { countyFips: '48029' }), null);
  assert.equal(await check(verifier, { countyFips: '48113' }), null);
  assert.equal((await check(verifier, { countyFips: '48453' }))?.countyFips, '48453');
});

test('duplicate, wildcard, malformed or unexpectedly broad grants are rejected as a whole', async () => {
  const records = [
    { countyGrants: [] },
    { countyGrants: [{ countyFips: '*', allowParcelDiscovery: true }] },
    { countyGrants: [{ countyFips: '48453', allowParcelDiscovery: true },
      { countyFips: '48453', allowParcelDiscovery: false }] },
    { countyGrants: [{ countyFips: '48453', allowParcelDiscovery: 'yes' }] },
    { countyGrants: [{ countyFips: '48453', allowParcelDiscovery: true, role: 'admin' }] },
    { countyGrants: [{ countyFips: '48453', allowParcelDiscovery: false }] },
    { countyGrants: Array.from({ length: 255 }, () =>
      ({ countyFips: '48453', allowParcelDiscovery: true })) },
  ];
  for (const diff of records) {
    assert.equal(await check(make({ find: async () => ({ ...validRecord(), ...diff }) })), null);
  }
});

test('failed lookup and aborted requests never leak session details', async () => {
  assert.equal(await check(make({ find: async () => { throw Error('secret session store failure'); } })), null);
  const abort = new AbortController(); abort.abort();
  let calls = 0;
  const verifier = make({ find: async () => { calls++; return validRecord(); } });
  assert.equal(await check(verifier, { signal: abort.signal }), null);
  assert.equal(calls, 0);
  const mid = new AbortController();
  const delayed = make({ find: async () => { mid.abort(); return validRecord(); } });
  assert.equal(await check(delayed, { signal: mid.signal }), null);
});

test('clock checked after session store read to reject expiry during lookup', async () => {
  let clock = nowMs - 1;
  const verifier = make({
    find: async () => { clock = nowMs + 100_000; return validRecord(); },
    now: () => clock,
  });
  assert.equal(await check(verifier), null);
});

test('end-to-end unexposed service denies metadata if county session revoked after database query', async () => {
  let sessionChecks = 0, sourceQueries = 0, viewportQueries = 0;
  const verifier = make({ find: async () => {
    sessionChecks++;
    return sessionChecks === 1 ? validRecord()
      : { ...validRecord(), revokedAtMs: nowMs };
  } });
  const resolver = createAuthorizedParcelSourceResolver({
    verifyCountySession: verifier,
    now: () => nowMs,
    readApprovedSources: async () => {
      sourceQueries++;
      return { rows: [{
        source_id: 'travis-cad', county_fips: '48453',
        rights_state: 'approved', approved_caching_until_ms: nowMs + 100_000, run_id: '42',
      }] };
    },
  });
  const service = createParcelViewportMetadataService({
    resolveAuthorizedSource: resolver, now: () => nowMs,
    query: async () => {
      viewportQueries++;
      return { rows: [{ source_parcel_id: 'SECRET-123', geometry_vertices: 5, geometry_memory_bytes: 300 }] };
    },
  });
  const answer = await service({
    sessionHandle: handle,
    request: {
      countyFips: '48453',
      bounds: { west: -97.75, south: 30.25, east: -97.74, north: 30.26 },
      limit: 10,
    },
  });
  assert.deepEqual(answer, { status: 'denied', viewportCoverage: 'unknown' });
  assert.equal(sessionChecks, 2);
  assert.equal(sourceQueries, 1);
  assert.equal(viewportQueries, 1);
});
