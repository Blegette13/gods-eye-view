import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import { buildParcelViewportProbeStatement, PARCEL_VIEWPORT_PROBE_SQL } from './parcelViewportReadPlan.js';
import {
  createParcelPostgisReadAdapter,
  POSTGIS_MIN_TIMEOUT_MS,
  POSTGIS_MAX_TIMEOUT_MS,
} from '../../../server/providers/bdp-parcel-postgis-read-adapter.js';

const statement = () => buildParcelViewportProbeStatement({
  plan: parseBoundedParcelPageRequest({
    countyFips: '48453',
    bounds: { west: -97.75, south: 30.25, east: -97.74, north: 30.26 },
    limit: 10,
  }),
  trustedSourceId: 'travis-cad', trustedRunId: 42,
});
function fakeClient({ failOn, onQuery } = {}) {
  const calls = [];
  const released = [];
  return {
    calls, released,
    async query(command) {
      calls.push(command);
      if (onQuery) onQuery(command);
      if ((typeof command === 'string' ? command : command.text)?.startsWith(failOn ?? 'NOT-MATCHING')) {
        throw new Error('synthetic database error: secret');
      }
      if (typeof command === 'object') return { rows: [{ source_parcel_id: 'FAKE', geometry_vertices: 5, geometry_memory_bytes: 200 }] };
      return { rows: [] };
    },
    release(error) { released.push(error); },
  };
}

test('requires trusted injected connection factory', () => {
  assert.throws(() => createParcelPostgisReadAdapter(), TypeError);
  assert.throws(() => createParcelPostgisReadAdapter({ connect: {} }), TypeError);
});

test('only the canonical eight-parameter rights-gated probe runs inside read-only transaction', async () => {
  const client = fakeClient();
  const query = createParcelPostgisReadAdapter({ connect: async () => client });
  const result = await query(statement(), { statementTimeoutMs: 1500 });
  assert.deepEqual(result.rows.map((row) => row.source_parcel_id), ['FAKE']);
  assert.deepEqual(client.calls.slice(0, 4), [
    'BEGIN TRANSACTION READ ONLY',
    'SET LOCAL statement_timeout = 1500',
    'SET LOCAL lock_timeout = 1000',
    'SET LOCAL idle_in_transaction_session_timeout = 3000',
  ]);
  const executed = client.calls[4];
  assert.equal(executed.text, PARCEL_VIEWPORT_PROBE_SQL);
  assert.deepEqual(executed.values, [...statement().values]);
  assert.notStrictEqual(executed.values, statement().values);
  assert.equal(client.calls[5], 'COMMIT');
  assert.deepEqual(client.released, [undefined]);
});

test('rejects arbitrary SQL, altered bounds, wrong counts and SQL injections before connecting', async () => {
  let connections = 0;
  const query = createParcelPostgisReadAdapter({ connect: async () => { connections++; return fakeClient(); } });
  const base = statement();
  for (const injected of [
    { ...base, text: 'DELETE FROM bdp_parcel_index.parcel_versions' },
    { ...base, values: [...base.values, 500] },
    { ...base, values: [...base.values.slice(0, 7), 1_000_000] },
    { ...base, values: [...base.values.slice(0, 3), -101, ...base.values.slice(4)] },
    { ...base, values: [...base.values.slice(0, 2), '42', ...base.values.slice(3)] },
    { ...base, values: [...base.values.slice(0, 1), "travis';DROP TABLE", ...base.values.slice(2)] },
    null,
  ]) await assert.rejects(query(injected), TypeError);
  assert.equal(connections, 0);
});

test('rejects unbounded timeouts and invalid signal without connecting', async () => {
  let connections = 0;
  const query = createParcelPostgisReadAdapter({ connect: async () => { connections++; return fakeClient(); } });
  for (const option of [
    { statementTimeoutMs: POSTGIS_MIN_TIMEOUT_MS - 1 },
    { statementTimeoutMs: POSTGIS_MAX_TIMEOUT_MS + 1 },
    { statementTimeoutMs: '2000' },
    { signal: {} },
  ]) await assert.rejects(query(statement(), option), TypeError);
  assert.equal(connections, 0);
});

test('a pre-cancelled request never acquires the connection', async () => {
  let called = 0;
  const controller = new AbortController(); controller.abort();
  const query = createParcelPostgisReadAdapter({ connect: async () => { called++; return fakeClient(); } });
  await assert.rejects(query(statement(), { signal: controller.signal }), /cancelled/);
  assert.equal(called, 0);
});

test('SQL failure rolls back the pinned connection and evicts it', async () => {
  const client = fakeClient({ failOn: 'WITH requested_bounds' });
  const query = createParcelPostgisReadAdapter({ connect: async () => client });
  await assert.rejects(query(statement()), /synthetic database error/);
  assert.equal(client.calls.at(-1), 'ROLLBACK');
  assert.equal(client.released.length, 1);
  assert.ok(client.released[0] instanceof Error);
  assert.ok(!client.calls.includes('COMMIT'));
});

test('aborting after the SQL returns prevents committing the data and discards connection', async () => {
  const controller = new AbortController();
  const client = fakeClient({ onQuery(command) {
    if (typeof command === 'object') controller.abort();
  }});
  const query = createParcelPostgisReadAdapter({ connect: async () => client });
  await assert.rejects(query(statement(), { signal: controller.signal }), /cancelled/);
  assert.equal(client.calls.at(-1), 'ROLLBACK');
  assert.ok(client.released[0] instanceof Error);
});

test('client startup failures cannot leak or commit a transaction', async () => {
  const client = fakeClient({ failOn: 'BEGIN' });
  const query = createParcelPostgisReadAdapter({ connect: async () => client });
  await assert.rejects(query(statement()), /synthetic database error/);
  assert.deepEqual(client.calls, ['BEGIN TRANSACTION READ ONLY']);
  assert.ok(client.released[0] instanceof Error);
});

test('non-driver result rejects and rolls back rather than claiming coverage', async () => {
  const client = fakeClient();
  client.query = async function (command) {
    this.calls.push(command);
    return typeof command === 'object' ? { rowCount: 3 } : { rows: [] };
  };
  const query = createParcelPostgisReadAdapter({ connect: async () => client });
  await assert.rejects(query(statement()), /Invalid PostgreSQL query result/);
  assert.equal(client.calls.at(-1), 'ROLLBACK');
  assert.ok(client.released[0] instanceof Error);
});
