import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRestrictedParcelRpcReaders, RESTRICTED_PARCEL_SOURCE_RPC_SQL, RESTRICTED_PARCEL_VIEWPORT_RPC_SQL } from '../../../server/providers/bdp-parcel-restricted-rpc-readers.js';
import { APPROVED_PARCEL_SOURCE_SQL, createAuthorizedParcelSourceResolver } from '../../../server/providers/bdp-parcel-source-resolver.js';
import { PARCEL_VIEWPORT_PROBE_SQL, buildParcelViewportProbeStatement } from './parcelViewportReadPlan.js';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import { createParcelViewportMetadataService } from '../../../server/providers/bdp-parcel-viewport-metadata.js';

const source = () => ({ text: APPROVED_PARCEL_SOURCE_SQL, values: ['48453'] });
const viewport = () => buildParcelViewportProbeStatement({
  plan: parseBoundedParcelPageRequest({
    countyFips: '48453', bounds: { west: -97.75, south: 30.25, east: -97.74, north: 30.26 }, limit: 10,
  }),
  trustedSourceId: 'travis-cad', trustedRunId: 42,
});
const srcRow = () => ({ source_id: 'travis-cad', county_fips: '48453', rights_state: 'approved',
  approved_caching_until_ms: 200000, run_id: '42' });
const row = () => ({ source_parcel_id: 'private-parcel-id', geometry_vertices: 5, geometry_memory_bytes: 512 });
function mock({ respond = () => ({ rows: [srcRow()] }), fail = false } = {}) {
  const calls = []; const releases = [];
  return {
    calls, releases,
    async query(command) {
      calls.push(command);
      if (fail && typeof command === 'object') throw new Error('synthetic DB failure');
      return typeof command === 'object' ? respond(command) : { rows: [] };
    },
    release(error) { releases.push(error); },
  };
}

test('requires a trusted pinned connection factory', () => {
  assert.throws(() => createRestrictedParcelRpcReaders(), TypeError);
  assert.throws(() => createRestrictedParcelRpcReaders({ connect: null }), TypeError);
});

test('source RPC uses fixed call, bound parameters, transaction and timeouts', async () => {
  const db = mock();
  const readers = createRestrictedParcelRpcReaders({ connect: async () => db });
  assert.deepEqual((await readers.readApprovedSources(source(), { statementTimeoutMs: 900 })).rows, [srcRow()]);
  assert.deepEqual(db.calls.slice(0, 4), ['BEGIN TRANSACTION READ ONLY',
    'SET LOCAL statement_timeout = 900', 'SET LOCAL lock_timeout = 900',
    'SET LOCAL idle_in_transaction_session_timeout = 1800']);
  assert.deepEqual(db.calls[4], { text: RESTRICTED_PARCEL_SOURCE_RPC_SQL, values: ['48453'] });
  assert.equal(db.calls.at(-1), 'COMMIT');
  assert.deepEqual(db.releases, [undefined]);
});

test('viewport RPC routes only canonical parameters, never raw table queries', async () => {
  const db = mock({ respond: () => ({ rows: [row()] }) });
  const readers = createRestrictedParcelRpcReaders({ connect: async () => db });
  assert.deepEqual((await readers.queryViewport(viewport())).rows, [row()]);
  assert.deepEqual(db.calls[4], {
    text: RESTRICTED_PARCEL_VIEWPORT_RPC_SQL,
    values: ['48453', 'travis-cad', 42, -97.75, 30.25, -97.74, 30.26, 11],
  });
  assert.doesNotMatch(RESTRICTED_PARCEL_VIEWPORT_RPC_SQL, /source_registry|parcel_versions/);
});

test('malformed county, spoofed roles, changed query, invalid cap or run refuse DB acquisition', async () => {
  let hits = 0;
  const readers = createRestrictedParcelRpcReaders({
    connect: async () => { hits++; return mock(); },
  });
  const s = source();
  const v = viewport();
  for (const input of [
    { ...s, values: ['06037'] }, { ...s, role: 'admin' },
    { ...s, text: 'NOT_A_SUPPORTED_QUERY' },
  ]) await assert.rejects(readers.readApprovedSources(input), TypeError);
  for (const input of [
    { ...v, text: 'NOT_A_SUPPORTED_QUERY' }, { ...v, values: [...v.values.slice(0, 7), 202] },
    { ...v, values: [...v.values.slice(0, 2), '42', ...v.values.slice(3)] },
    { ...v, values: [...v.values.slice(0, 3), -99, ...v.values.slice(4)] },
  ]) await assert.rejects(readers.queryViewport(input), TypeError);
  assert.equal(hits, 0);
});

test('timeout, cancellation and oversized results fail closed', async () => {
  let hits = 0;
  const readers = createRestrictedParcelRpcReaders({
    connect: async () => { hits++; return mock(); },
  });
  await assert.rejects(readers.readApprovedSources(source(), { statementTimeoutMs: 6000 }), TypeError);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(readers.queryViewport(viewport(), { signal: ac.signal }), /cancelled/);
  assert.equal(hits, 0);
  const db = mock({ respond: () => ({ rows: [srcRow(), srcRow(), srcRow()] }) });
  const limited = createRestrictedParcelRpcReaders({ connect: async () => db });
  await assert.rejects(limited.readApprovedSources(source()), /Unbounded/);
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(db.releases[0] instanceof Error);
});

test('query errors roll back and discard the pinned connection', async () => {
  const db = mock({ fail: true });
  const readers = createRestrictedParcelRpcReaders({ connect: async () => db });
  await assert.rejects(readers.readApprovedSources(source()), /synthetic DB failure/);
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(db.releases[0] instanceof Error);
});

test('unrouted composition double-checks session rights and never delivers parcel IDs', async () => {
  const handle = randomBytes(32).toString('base64url');
  let authCount = 0, sourceCount = 0, viewportCount = 0;
  const readers = createRestrictedParcelRpcReaders({ connect: async () => mock({
    respond(command) {
      if (command.text === RESTRICTED_PARCEL_SOURCE_RPC_SQL) {
        sourceCount++; return { rows: [srcRow()] };
      }
      if (command.text === RESTRICTED_PARCEL_VIEWPORT_RPC_SQL) {
        viewportCount++; return { rows: [row()] };
      }
      throw new Error('unknown RPC');
    },
  }) });
  const resolver = createAuthorizedParcelSourceResolver({
    verifyCountySession: async () => {
      authCount++;
      return { authenticated: true, accountStatus: 'active', mfaVerified: true, revokedAtMs: null,
        countyFips: '48453', allowParcelDiscovery: true, subject: 'fixture' };
    },
    readApprovedSources: readers.readApprovedSources, now: () => 1000,
  });
  const svc = createParcelViewportMetadataService({
    resolveAuthorizedSource: resolver, query: readers.queryViewport, now: () => 1000,
  });
  const result = await svc({ sessionHandle: handle,
    request: { countyFips: '48453', bounds: { west: -97.75, south: 30.25, east: -97.74, north: 30.26 }, limit: 10 } });
  assert.deepEqual(result, { status: 'ok', parcelCount: 1, overflow: false,
    viewportCoverage: 'unknown', geometryDelivered: false });
  assert.equal(authCount, 2);
  assert.equal(sourceCount, 2);
  assert.equal(viewportCount, 1);
  assert.equal(JSON.stringify(result).includes('private-parcel-id'), false);
});
