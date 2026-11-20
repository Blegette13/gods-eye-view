import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { APPROVED_PARCEL_SOURCE_SQL, createAuthorizedParcelSourceResolver } from '../../../server/providers/bdp-parcel-source-resolver.js';
import { createParcelPostgisSourceReader } from '../../../server/providers/bdp-parcel-postgis-source-reader.js';
import { createParcelPostgisReadAdapter } from '../../../server/providers/bdp-parcel-postgis-read-adapter.js';
import { createParcelViewportMetadataService } from '../../../server/providers/bdp-parcel-viewport-metadata.js';
import { PARCEL_VIEWPORT_PROBE_SQL } from './parcelViewportReadPlan.js';

const statement = () => ({ text: APPROVED_PARCEL_SOURCE_SQL, values: ['48453'] });
const source = () => ({
  source_id: 'travis-cad', county_fips: '48453', rights_state: 'approved',
  approved_caching_until_ms: 200_000, run_id: '42',
});
function client({ onQuery } = {}) {
  const calls = [];
  const releases = [];
  return {
    calls, releases,
    async query(command) {
      calls.push(command);
      if (onQuery) return onQuery(command);
      if (typeof command === 'object') return { rows: [source()] };
      return { rows: [] };
    },
    release(error) { releases.push(error); },
  };
}

test('requires a separately injected trusted PostgreSQL client factory', () => {
  assert.throws(() => createParcelPostgisSourceReader(), TypeError);
  assert.throws(() => createParcelPostgisSourceReader({ connect: null }), TypeError);
});

test('approved-source lookup uses only parameterized fixed SQL inside a read-only transaction', async () => {
  const db = client();
  const read = createParcelPostgisSourceReader({ connect: async () => db });
  const result = await read(statement());
  assert.deepEqual(result.rows, [source()]);
  assert.deepEqual(db.calls.slice(0, 4), [
    'BEGIN TRANSACTION READ ONLY',
    'SET LOCAL statement_timeout = 1000',
    'SET LOCAL lock_timeout = 1000',
    'SET LOCAL idle_in_transaction_session_timeout = 2000',
  ]);
  assert.deepEqual(db.calls[4], { text: APPROVED_PARCEL_SOURCE_SQL, values: ['48453'] });
  assert.notStrictEqual(db.calls[4].values, statement().values);
  assert.equal(db.calls[5], 'COMMIT');
  assert.deepEqual(db.releases, [undefined]);
});

test('rejects arbitrary SQL, browser roles, malformed counties and modified queries before connecting', async () => {
  let connections = 0;
  const read = createParcelPostgisSourceReader({
    connect: async () => { connections++; return client(); },
  });
  const invalid = [
    { text: 'DELETE FROM bdp_parcel_index.source_registry', values: ['48453'] },
    { text: APPROVED_PARCEL_SOURCE_SQL + '; DROP TABLE x', values: ['48453'] },
    { text: APPROVED_PARCEL_SOURCE_SQL, values: ['06037'] },
    { text: APPROVED_PARCEL_SOURCE_SQL, values: ['4845'] },
    { text: APPROVED_PARCEL_SOURCE_SQL, values: [48453] },
    { text: APPROVED_PARCEL_SOURCE_SQL, values: ['48453', 'travis-cad'] },
    { ...statement(), role: 'owner' },
    { ...statement(), sourceId: 'travis-cad' },
    null,
  ];
  for (const request of invalid) await assert.rejects(read(request), TypeError);
  assert.equal(connections, 0);
});

test('rejects out-of-range timeout and malformed abort signals before connecting', async () => {
  let connections = 0;
  const read = createParcelPostgisSourceReader({
    connect: async () => { connections++; return client(); },
  });
  for (const options of [
    { statementTimeoutMs: 0 },
    { statementTimeoutMs: 5_001 },
    { statementTimeoutMs: '1000' },
    { signal: {} },
  ]) await assert.rejects(read(statement(), options), TypeError);
  assert.equal(connections, 0);
});

test('pre-cancelled signal prevents a database acquisition', async () => {
  const abort = new AbortController(); abort.abort();
  let connections = 0;
  const read = createParcelPostgisSourceReader({
    connect: async () => { connections++; return client(); },
  });
  await assert.rejects(read(statement(), { signal: abort.signal }), /cancelled/);
  assert.equal(connections, 0);
});

test('database error causes rollback and connection eviction', async () => {
  const db = client({ onQuery(command) {
    if (typeof command === 'object') throw new Error('private postgres exception');
    return { rows: [] };
  } });
  const read = createParcelPostgisSourceReader({ connect: async () => db });
  await assert.rejects(read(statement()), /private postgres exception/);
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.equal(db.releases.length, 1);
  assert.ok(db.releases[0] instanceof Error);
});

test('too many source records is rejected without partial silent selection', async () => {
  const db = client({ onQuery(command) {
    return typeof command === 'object'
      ? { rows: [source(), source(), source()] } : { rows: [] };
  } });
  const read = createParcelPostgisSourceReader({ connect: async () => db });
  await assert.rejects(read(statement()), /Invalid bounded/);
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(db.releases[0] instanceof Error);
});

test('mid-flight cancellation rolls back and rejects read', async () => {
  const abort = new AbortController();
  const db = client({ onQuery(command) {
    if (typeof command === 'object') abort.abort();
    return typeof command === 'object' ? { rows: [source()] } : { rows: [] };
  } });
  const read = createParcelPostgisSourceReader({ connect: async () => db });
  await assert.rejects(read(statement(), { signal: abort.signal }), /cancelled/);
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(db.releases[0] instanceof Error);
});

test('fully composed trusted flow reads registry twice, uses viewport once, and exposes no source parcel IDs', async () => {
  const handle = randomBytes(32).toString('base64url');
  let sourceReads = 0, viewportReads = 0, trustedSessions = 0;
  const dbConnect = async () => client({ onQuery(command) {
    if (typeof command !== 'object') return { rows: [] };
    if (command.text === APPROVED_PARCEL_SOURCE_SQL) {
      sourceReads++;
      return { rows: [source()] };
    }
    if (command.text === PARCEL_VIEWPORT_PROBE_SQL) {
      viewportReads++;
      return { rows: [{ source_parcel_id: 'SECRET-TEST-PARCEL', geometry_vertices: 5, geometry_memory_bytes: 256 }] };
    }
    throw new Error('unexpected SQL');
  } });
  const resolver = createAuthorizedParcelSourceResolver({
    verifyCountySession: async ({ sessionHandle, countyFips }) => {
      assert.equal(sessionHandle, handle);
      assert.equal(countyFips, '48453');
      trustedSessions++;
      return {
        authenticated: true, accountStatus: 'active', mfaVerified: true,
        revokedAtMs: null, countyFips: '48453', allowParcelDiscovery: true, subject: 'fixture-operator',
      };
    },
    readApprovedSources: createParcelPostgisSourceReader({ connect: dbConnect }),
    now: () => 1_000,
  });
  const service = createParcelViewportMetadataService({
    resolveAuthorizedSource: resolver,
    query: createParcelPostgisReadAdapter({ connect: dbConnect }),
    now: () => 1_000,
  });
  const result = await service({
    sessionHandle: handle,
    request: {
      countyFips: '48453',
      bounds: { west: -97.75, south: 30.25, east: -97.74, north: 30.26 },
      limit: 10,
    },
  });
  assert.deepEqual(result, {
    status: 'ok', parcelCount: 1, overflow: false,
    viewportCoverage: 'unknown', geometryDelivered: false,
  });
  assert.ok(!JSON.stringify(result).includes('SECRET-TEST-PARCEL'));
  assert.equal(trustedSessions, 2);
  assert.equal(sourceReads, 2);
  assert.equal(viewportReads, 1);
});

test('revoked session after viewport SQL denies aggregates even with valid source registry rows', async () => {
  const handle = randomBytes(32).toString('base64url');
  let authCalls = 0;
  const reader = createParcelPostgisSourceReader({
    connect: async () => client(),
  });
  const resolver = createAuthorizedParcelSourceResolver({
    verifyCountySession: async () => {
      authCalls++;
      return {
        authenticated: true, accountStatus: 'active', mfaVerified: true,
        revokedAtMs: authCalls === 1 ? null : 123,
        countyFips: '48453', allowParcelDiscovery: true, subject: 'fixture-operator',
      };
    },
    readApprovedSources: reader,
    now: () => 1_000,
  });
  const service = createParcelViewportMetadataService({
    resolveAuthorizedSource: resolver,
    query: async () => ({
      rows: [{ source_parcel_id: 'HIDDEN', geometry_vertices: 5, geometry_memory_bytes: 256 }],
    }),
    now: () => 1_000,
  });
  const result = await service({
    sessionHandle: handle,
    request: {
      countyFips: '48453',
      bounds: { west: -97.75, south: 30.25, east: -97.74, north: 30.26 },
      limit: 10,
    },
  });
  assert.deepEqual(result, { status: 'denied', viewportCoverage: 'unknown' });
  assert.equal(authCalls, 2);
});
