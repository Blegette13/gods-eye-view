import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import {
  createPrivateParcelGeometryRpcReader, GEOMETRY_RPC_SQL,
  MAX_PRIVATE_GEOMETRY_BYTES,
} from '../../../server/providers/bdp-parcel-private-geometry-reader.js';

const plan = () => parseBoundedParcelPageRequest({
  countyFips: '48453',
  bounds: { west: -97.76, south: 30.24, east: -97.73, north: 30.27 },
  limit: 2,
});
const request = () => ({ plan: plan(), trustedSourceId: 'travis-cad', trustedRunId: 42 });
const polygon = () => ({
  type: 'MultiPolygon', coordinates: [[[
    [-97.75, 30.25], [-97.74, 30.25], [-97.74, 30.26],
    [-97.75, 30.26], [-97.75, 30.25],
  ]]],
});
const row = (id, geometry = polygon()) => ({
  parcel_version_id: '1', source_parcel_id: id,
  source_version: 'fixture-v1', source_geometry_sha256: 'a'.repeat(64),
  ingest_run_id: '42', source_id: 'travis-cad', county_fips: '48453',
  geometry_vertices: 5, geometry_memory_bytes: 240, geometry,
});
function fixture(onQuery = () => ({ rows: [row('SYNTHETIC-001')] })) {
  const calls = [], releases = [];
  let connects = 0;
  const client = {
    async query(sql) {
      calls.push(sql);
      return typeof sql === 'string' ? { rows: [] } : onQuery(sql);
    },
    release(err) { releases.push(err); },
  };
  return {
    calls, releases,
    get connects() { return connects; },
    reader: createPrivateParcelGeometryRpcReader({
      connect: async () => { connects++; return client; },
    }),
  };
}

test('private geometry reader requires a trusted injected pinned connection', () => {
  assert.throws(() => createPrivateParcelGeometryRpcReader(), TypeError);
  assert.throws(() => createPrivateParcelGeometryRpcReader({ connect: 'browser' }), TypeError);
});

test('fixed bounded function call uses canonical 8 bind values, never raw parcel tables', async () => {
  const f = fixture();
  const result = await f.reader.readSnapshot(request(), { statementTimeoutMs: 900 });
  assert.deepEqual(result.rows, [row('SYNTHETIC-001')]);
  assert.equal(result.publishAuthorized, false);
  assert.equal(result.viewportCoverage, 'unknown');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.rows));
  assert.equal(f.connects, 1);
  assert.deepEqual(f.calls.slice(0,4), [
    'BEGIN TRANSACTION READ ONLY', 'SET LOCAL statement_timeout = 900',
    'SET LOCAL lock_timeout = 900',
    'SET LOCAL idle_in_transaction_session_timeout = 1800',
  ]);
  assert.deepEqual(f.calls[4], {
    text: GEOMETRY_RPC_SQL,
    values: ['48453','travis-cad',42,-97.76,30.24,-97.73,30.27,3],
  });
  assert.doesNotMatch(GEOMETRY_RPC_SQL, /source_registry|parcel_versions|geometry_publication_reviews/);
  assert.equal(f.calls.at(-1), 'COMMIT');
  assert.deepEqual(f.releases, [undefined]);
});

test('unsupported, forged, excessive or unbounded requests refuse connection', async () => {
  const f = fixture();
  const bad = [
    null,
    { ...request(), role: 'owner' },
    { ...request(), trustedSourceId: 'travis-cad;DROP' },
    { ...request(), trustedRunId: '42' },
    { ...request(), plan: { ...plan(), probeLimit: 999 } },
    { ...request(), plan: { ...plan(), limit: 201 } },
  ];
  for (const r of bad) await assert.rejects(f.reader.readSnapshot(r), TypeError);
  for (const timeout of [0, 3001, '1000', 4.5]) {
    await assert.rejects(f.reader.readSnapshot(request(), { statementTimeoutMs: timeout }), TypeError);
  }
  assert.equal(f.connects, 0);
});

test('an already cancelled request performs no database work', async () => {
  const f = fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.reader.readSnapshot(request(), { signal: controller.signal }), /cancelled/);
  assert.equal(f.connects, 0);
});

test('overflow requires null geometry on the third sentinel record', async () => {
  const ok = fixture(() => ({ rows: [row('001'), row('002'), row('003', null)] }));
  const answer = await ok.reader.readSnapshot(request());
  assert.equal(answer.rows.length, 3);
  assert.equal(answer.rows[2].geometry, null);
  const invalid = fixture(() => ({ rows: [row('001'), row('002'), row('003')] }));
  await assert.rejects(invalid.reader.readSnapshot(request()), /unavailable/);
  assert.equal(invalid.calls.at(-1), 'ROLLBACK');
  assert.ok(invalid.releases[0] instanceof Error);
});

test('too many rows and unexpected owner attributes roll back and evict client', async () => {
  for (const rows of [
    [row('001'), row('002'), row('003', null), row('004', null)],
    [{ ...row('001'), owner_name: 'DO NOT DISCLOSE' }],
  ]) {
    const f = fixture(() => ({ rows }));
    await assert.rejects(f.reader.readSnapshot(request()), /unavailable/);
    assert.equal(f.calls.at(-1), 'ROLLBACK');
    assert.ok(f.releases[0] instanceof Error);
  }
});

test('oversized private driver responses never become published output', async () => {
  const tooLarge = fixture(() => ({ rows: [row('001', {
    ...polygon(), oversized: 'x'.repeat(MAX_PRIVATE_GEOMETRY_BYTES + 1),
  })] }));
  await assert.rejects(tooLarge.reader.readSnapshot(request()), /unavailable/);
  assert.equal(tooLarge.calls.at(-1), 'ROLLBACK');
  assert.ok(tooLarge.releases[0] instanceof Error);
});

test('driver error details are not exposed and failed transaction is rolled back', async () => {
  const f = fixture(() => { throw new Error('PRIVATE SQL CREDENTIAL'); });
  await assert.rejects(f.reader.readSnapshot(request()), (err) => {
    assert.equal(err.message, 'Private parcel geometry unavailable');
    return true;
  });
  assert.equal(f.calls.at(-1), 'ROLLBACK');
  assert.ok(f.releases[0] instanceof Error);
});

test('cancellation immediately after query triggers rollback and no stale result', async () => {
  const controller = new AbortController();
  const f = fixture(() => { controller.abort(); return { rows: [row('001')] }; });
  await assert.rejects(f.reader.readSnapshot(request(), { signal: controller.signal }), /unavailable/);
  assert.equal(f.calls.at(-1), 'ROLLBACK');
  assert.ok(f.releases[0] instanceof Error);
});
