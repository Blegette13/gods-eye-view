import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  createParcelViewportMetadataService,
  DEFAULT_PARCEL_PROBE_MAX_CONCURRENT,
  DEFAULT_PARCEL_PROBE_TIMEOUT_MS,
} from '../../../server/providers/bdp-parcel-viewport-metadata.js';

const sessionHandle = randomBytes(32).toString('base64url');
const request = () => ({
  countyFips: '48453', bounds: { west: -97.75, south: 30.25, east: -97.73, north: 30.27 }, limit: 2,
});
const approved = () => ({
  sourceId: 'travis-cad', countyFips: '48453', rightsState: 'approved',
  approvedCachingUntilMs: 100_000, runId: 29,
});
const record = (id) => ({ source_parcel_id: id, geometry_vertices: 5, geometry_memory_bytes: 250 });
const make = ({ rights = approved, execute = async () => ({ rows: [record('A')] }),
  time = () => 1000, ...opts } = {}) => createParcelViewportMetadataService({
  resolveAuthorizedSource: rights, query: execute, now: time, ...opts,
});
const call = (svc, extra = {}) => svc({ sessionHandle, request: request(), ...extra });

test('requires trusted resolver, DB adapter and bounded configuration', () => {
  assert.throws(() => createParcelViewportMetadataService(), TypeError);
  assert.throws(() => createParcelViewportMetadataService({ resolveAuthorizedSource: () => ({}) }), TypeError);
  assert.throws(() => make({ maxConcurrent: 0 }), TypeError);
  assert.throws(() => make({ maxConcurrent: 17 }), TypeError);
  assert.throws(() => make({ statementTimeoutMs: 40 }), TypeError);
  assert.equal(DEFAULT_PARCEL_PROBE_MAX_CONCURRENT, 4);
  assert.equal(DEFAULT_PARCEL_PROBE_TIMEOUT_MS, 2_000);
});

test('runs one bounded source-resolved read without exposing parcel IDs', async () => {
  let lookupCount = 0, queryCount = 0;
  const service = make({
    rights: async ({ sessionHandle: handle, countyFips }) => {
      assert.equal(handle, sessionHandle);
      assert.equal(countyFips, '48453');
      lookupCount++;
      return approved();
    },
    execute: async (statement, { statementTimeoutMs }) => {
      queryCount++;
      assert.deepEqual(statement.values, ['48453', 'travis-cad', 29, -97.75, 30.25, -97.73, 30.27, 3]);
      assert.match(statement.text, /sr\.rights_state = 'approved'/);
      assert.equal(statementTimeoutMs, 2_000);
      return { rows: [record('PRIVATE-PARCEL-ID')] };
    },
  });
  const result = await call(service);
  assert.deepEqual(result, {
    status: 'ok', parcelCount: 1, overflow: false,
    viewportCoverage: 'unknown', geometryDelivered: false,
  });
  assert.equal(JSON.stringify(result).includes('PRIVATE-PARCEL-ID'), false);
  assert.equal(lookupCount, 2);
  assert.equal(queryCount, 1);
});

test('rejects invalid request and unverified handles before touching DB', async () => {
  let invoked = 0;
  const service = make({ rights: () => { invoked++; return approved(); }, execute: () => { invoked++; return { rows: [] }; } });
  for (const extra of [
    { request: { ...request(), sourceId: 'travis-cad' } },
    { request: { ...request(), role: 'admin' } },
    { request: { ...request(), bounds: { west: -97, south: 30, east: -96, north: 31 } } },
    { sessionHandle: 'not-a-real-session' },
    { sessionHandle: 'a'.repeat(43) },
    { signal: {} },
  ]) {
    const result = await call(service, extra);
    assert.ok(['invalid-request', 'denied'].includes(result.status));
  }
  assert.equal(invoked, 0);
});

test('unreviewed, revoked, expired, cross-county and absent runs deny DB access', async () => {
  for (const ref of [
    null, { ...approved(), rightsState: 'unreviewed' },
    { ...approved(), rightsState: 'revoked' },
    { ...approved(), approvedCachingUntilMs: 1_000 },
    { ...approved(), countyFips: '48029' },
    { ...approved(), runId: null },
    { ...approved(), sourceId: '../../fake' },
  ]) {
    let called = 0;
    const service = make({ rights: async () => ref, execute: async () => { called++; return { rows: [] }; } });
    assert.equal((await call(service)).status, 'denied');
    assert.equal(called, 0);
  }
});

test('post-read rights revocation and ingestion run rotation fail closed', async () => {
  for (const second of [{ ...approved(), rightsState: 'revoked' }, { ...approved(), runId: 30 }, null]) {
    let count = 0;
    const service = make({ rights: async () => (++count === 1 ? approved() : second) });
    assert.equal((await call(service)).status, 'denied');
    assert.equal(count, 2);
  }
});

test('reports overflow as partial-page without claiming evaluated coverage', async () => {
  const service = make({ execute: async () => ({ rows: [record('1'), record('2'), record('3')] }) });
  assert.deepEqual(await call(service), {
    status: 'partial-page', parcelCount: 2, overflow: true,
    viewportCoverage: 'unknown', geometryDelivered: false,
  });
});

test('invalid result rows and excessive geometry budgets fail closed', async () => {
  for (const rows of [
    'unexpected', [record('1'), record('1')],
    [record('1'), record('2'), record('3'), record('4')],
    [{ ...record('1'), geometry_vertices: 999999 }],
    [{ ...record('1'), geometry_memory_bytes: 999999999 }],
  ]) {
    let rightsCalls = 0;
    const service = make({ execute: async () => ({ rows }), rights: async () => { rightsCalls++; return approved(); } });
    assert.equal((await call(service)).status, 'unavailable');
    assert.equal(rightsCalls, 1);
  }
});

test('database failures return generic response without secret SQL details', async () => {
  const service = make({ execute: async () => { throw new Error('SQL SECRET SOURCE DATA'); } });
  assert.deepEqual(await call(service), { status: 'unavailable', viewportCoverage: 'unknown' });
});

test('preemptive and mid-flight cancellation never return source coverage', async () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal((await call(make(), { signal: controller.signal })).status, 'cancelled');

  const during = new AbortController();
  const active = make({ execute: async () => { during.abort(); return { rows: [record('1')] }; } });
  assert.equal((await call(active, { signal: during.signal })).status, 'cancelled');
});

test('per-instance concurrency budget refuses excess work without queuing', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const service = make({ maxConcurrent: 1, execute: async () => { await blocked; return { rows: [record('1')] }; } });
  const first = call(service);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await call(service)).status, 'busy');
  release();
  assert.equal((await first).status, 'ok');
});
