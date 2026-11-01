import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  APPROVED_PARCEL_SOURCE_SQL,
  MAX_RESOLVED_SOURCES,
  SOURCE_RESOLVER_TIMEOUT_MS,
  createAuthorizedParcelSourceResolver,
} from '../../../server/providers/bdp-parcel-source-resolver.js';
import { createParcelViewportMetadataService } from '../../../server/providers/bdp-parcel-viewport-metadata.js';

const handle = randomBytes(32).toString('base64url');
const approved = () => ({
  authenticated: true, accountStatus: 'active', mfaVerified: true,
  revokedAtMs: null, countyFips: '48453', allowParcelDiscovery: true,
  subject: 'operator-test',
});
const source = () => ({
  source_id: 'travis-cad', county_fips: '48453', rights_state: 'approved',
  approved_caching_until_ms: 100_000, run_id: '42',
});
const make = ({
  authenticate = async () => approved(),
  read = async () => ({ rows: [source()] }),
  now = () => 1_000,
} = {}) => createAuthorizedParcelSourceResolver({
  verifyCountySession: authenticate, readApprovedSources: read, now,
});
const resolve = (resolver, overrides = {}) => resolver({
  sessionHandle: handle, countyFips: '48453', ...overrides,
});

test('requires independent trusted identity and database source readers', () => {
  assert.throws(() => createAuthorizedParcelSourceResolver(), TypeError);
  assert.throws(() => createAuthorizedParcelSourceResolver({ verifyCountySession: () => {} }), TypeError);
  assert.throws(() => createAuthorizedParcelSourceResolver({ readApprovedSources: () => {} }), TypeError);
  assert.equal(MAX_RESOLVED_SOURCES, 2);
  assert.equal(SOURCE_RESOLVER_TIMEOUT_MS, 1_000);
});

test('retrieves one rights-approved, finished versioned run with parameterized SQL', async () => {
  let proofChecks = 0, sourceQueries = 0;
  const resolver = make({
    authenticate: async ({ sessionHandle, countyFips }) => {
      assert.equal(sessionHandle, handle);
      assert.equal(countyFips, '48453');
      proofChecks++;
      return approved();
    },
    read: async ({ text, values }, { statementTimeoutMs }) => {
      sourceQueries++;
      assert.equal(text, APPROVED_PARCEL_SOURCE_SQL);
      assert.deepEqual(values, ['48453']);
      assert.equal(statementTimeoutMs, 1_000);
      return { rows: [source()] };
    },
  });
  assert.deepEqual(await resolve(resolver), {
    sourceId: 'travis-cad', countyFips: '48453', rightsState: 'approved',
    approvedCachingUntilMs: 100_000, runId: 42,
  });
  assert.equal(proofChecks, 1);
  assert.equal(sourceQueries, 1);
});

test('SQL checks rights at read time and never selects geometry or raw ownership data', () => {
  assert.match(APPROVED_PARCEL_SOURCE_SQL, /sr\.rights_state = 'approved'/);
  assert.match(APPROVED_PARCEL_SOURCE_SQL, /sr\.approved_caching_until > clock_timestamp\(\)/);
  assert.match(APPROVED_PARCEL_SOURCE_SQL, /sr\.county_fips = \$1::char\(5\)/);
  assert.match(APPROVED_PARCEL_SOURCE_SQL, /ir\.finished_at IS NOT NULL/);
  assert.match(APPROVED_PARCEL_SOURCE_SQL, /ir\.outcome IN \('complete', 'partial'\)/);
  assert.match(APPROVED_PARCEL_SOURCE_SQL, /ORDER BY ir\.finished_at DESC, ir\.id DESC/);
  assert.match(APPROVED_PARCEL_SOURCE_SQL, /LIMIT 2/);
  assert.doesNotMatch(APPROVED_PARCEL_SOURCE_SQL, /ST_AsGeoJSON|pv\.geometry|owner_name|contact|address|\bGRANT\b/i);
});

test('invalid opaque handles, non-Texas counties and malformed signals never reach auth or DB', async () => {
  let calls = 0;
  const resolver = make({
    authenticate: async () => { calls++; return approved(); },
    read: async () => { calls++; return { rows: [source()] }; },
  });
  const invalid = [
    { sessionHandle: 'a'.repeat(43) },
    { sessionHandle: 'browser-claimed-admin' },
    { sessionHandle: undefined },
    { countyFips: '06037' },
    { countyFips: '4845' },
    { countyFips: 48453 },
    { signal: {} },
  ];
  for (const input of invalid) assert.equal(await resolve(resolver, input), null);
  assert.equal(calls, 0);
});

test('inactive, revoked, unsigned, wrong-county, or ungranted session cannot query registry', async () => {
  const bad = [
    null,
    { ...approved(), authenticated: false },
    { ...approved(), accountStatus: 'disabled' },
    { ...approved(), mfaVerified: false },
    { ...approved(), revokedAtMs: 50 },
    { ...approved(), countyFips: '48029' },
    { ...approved(), allowParcelDiscovery: false },
    { ...approved(), subject: null },
  ];
  for (const identity of bad) {
    let count = 0;
    const resolver = make({
      authenticate: async () => identity,
      read: async () => { count++; return { rows: [source()] }; },
    });
    assert.equal(await resolve(resolver), null);
    assert.equal(count, 0);
  }
});

test('multiple qualifying sources are ambiguous, never silently select first', async () => {
  const resolver = make({ read: async () => ({
    rows: [source(), { ...source(), source_id: 'another-cad', run_id: '43' }],
  }) });
  assert.equal(await resolve(resolver), null);
  assert.equal(await resolve(make({ read: async () => ({ rows: [] }) })), null);
});

test('invalid run versions, revoked rows and expired rights fail closed', async () => {
  const invalid = [
    { ...source(), rights_state: 'revoked' },
    { ...source(), rights_state: 'restricted' },
    { ...source(), approved_caching_until_ms: 1_000 },
    { ...source(), county_fips: '48029' },
    { ...source(), run_id: '0' },
    { ...source(), run_id: String(Number.MAX_SAFE_INTEGER + 1) },
    { ...source(), run_id: '42.1' },
    { ...source(), source_id: '../evil' },
    { ...source(), approved_caching_until_ms: '100000' },
    null,
  ];
  for (const record of invalid) {
    const resolver = make({ read: async () => ({ rows: [record] }) });
    assert.equal(await resolve(resolver), null);
  }
});

test('aborted, failed, and malformed source lookups never leak internal errors', async () => {
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  const resolver = make({ authenticate: async () => { calls++; return approved(); } });
  assert.equal(await resolve(resolver, { signal: abort.signal }), null);
  assert.equal(calls, 0);
  assert.equal(await resolve(make({ read: async () => { throw new Error('private SQL details'); } })), null);
  assert.equal(await resolve(make({ read: async () => ({ rows: null }) })), null);
  const lateAbort = new AbortController();
  const late = make({ read: async () => { lateAbort.abort(); return { rows: [source()] }; } });
  assert.equal(await resolve(late, { signal: lateAbort.signal }), null);
});

test('composed metadata service re-verifies authoritative county grant after query', async () => {
  let sessionChecks = 0, readCalls = 0, reads = 0;
  const resolver = make({
    authenticate: async () => {
      sessionChecks++;
      return sessionChecks === 1 ? approved() : { ...approved(), revokedAtMs: 7 };
    },
    read: async () => { readCalls++; return { rows: [source()] }; },
  });
  const service = createParcelViewportMetadataService({
    resolveAuthorizedSource: resolver, now: () => 1_000,
    query: async () => {
      reads++;
      return { rows: [{ source_parcel_id: 'PRIV-001', geometry_vertices: 5, geometry_memory_bytes: 256 }] };
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
  assert.equal(answer.status, 'denied');
  assert.equal(answer.viewportCoverage, 'unknown');
  assert.equal(sessionChecks, 2);
  assert.equal(readCalls, 1);
  assert.equal(reads, 1);
});
