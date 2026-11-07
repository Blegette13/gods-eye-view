import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createParcelMetadataRuntime } from '../../../server/providers/bdp-parcel-metadata-runtime.js';
import {
  RESTRICTED_PARCEL_SOURCE_RPC_SQL,
  RESTRICTED_PARCEL_VIEWPORT_RPC_SQL,
} from '../../../server/providers/bdp-parcel-restricted-rpc-readers.js';

const clock = 1_000_000;
const handle = randomBytes(32).toString('base64url');
const key = randomBytes(48);
const digest = createHmac('sha256', key).update(handle).digest('hex');
const request = () => ({
  countyFips: '48453',
  bounds: { west: -97.75, south: 30.25, east: -97.74, north: 30.26 },
  limit: 10,
});
const storedSession = () => ({
  sessionDigest: digest,
  subject: 'synthetic-operator',
  accountStatus: 'active',
  mfaVerified: true,
  revokedAtMs: null,
  issuedAtMs: clock - 10_000,
  lastSeenAtMs: clock - 1_000,
  expiresAtMs: clock + 100_000,
  countyGrants: [
    { countyFips: '48453', allowParcelDiscovery: true },
    { countyFips: '48029', allowParcelDiscovery: false },
  ],
});
const approved = () => ({
  source_id: 'travis-cad',
  county_fips: '48453',
  rights_state: 'approved',
  approved_caching_until_ms: clock + 100_000,
  run_id: '42',
});
const parcel = () => ({
  source_parcel_id: 'PRIVATE-FIXTURE-ID',
  geometry_vertices: 5,
  geometry_memory_bytes: 500,
});
function setup({
  session = async () => storedSession(),
  source = async () => ({ rows: [approved()] }),
  viewport = async () => ({ rows: [parcel()] }),
  now = () => clock,
} = {}) {
  const executed = [];
  const released = [];
  let connects = 0;
  const connect = async () => {
    connects++;
    return {
      async query(command) {
        executed.push(command);
        if (typeof command === 'string') return { rows: [] };
        if (command.text === RESTRICTED_PARCEL_SOURCE_RPC_SQL) return source(command);
        if (command.text === RESTRICTED_PARCEL_VIEWPORT_RPC_SQL) return viewport(command);
        throw new Error('The runtime must never execute unrestricted SQL');
      },
      release(error) { released.push(error); },
    };
  };
  const runtime = createParcelMetadataRuntime({
    connect, findSessionByDigest: session, sessionHmacKey: key, now,
  });
  return { runtime, executed, released, get connects() { return connects; } };
}
const check = (runtime, countyRequest = request()) =>
  runtime.readViewportMetadata({ sessionHandle: handle, request: countyRequest });

test('runtime requires trusted server-only dependencies and rejects client policy overrides', () => {
  assert.throws(() => createParcelMetadataRuntime(), TypeError);
  assert.throws(() => createParcelMetadataRuntime({}), TypeError);
  assert.throws(() => createParcelMetadataRuntime({ userRole: 'admin' }), TypeError);
  assert.throws(() => createParcelMetadataRuntime({ connect: () => {}, apiKey: 'browser-key' }), TypeError);
  assert.throws(() => createParcelMetadataRuntime({
    connect: async () => ({}),
    findSessionByDigest: async () => null,
    sessionHmacKey: randomBytes(12),
  }), TypeError);
});

test('constructing the runtime is inert and exports only a metadata operation', () => {
  const fixture = setup();
  assert.equal(fixture.connects, 0);
  assert.deepEqual(Object.keys(fixture.runtime), ['readViewportMetadata']);
  assert.ok(Object.isFrozen(fixture.runtime));
});

test('valid trusted HMAC session → source lookup → viewport RPC → source recheck returns only aggregate counts', async () => {
  let lookups = 0;
  const fixture = setup({ session: async (value) => {
    lookups++;
    assert.equal(value, digest);
    return storedSession();
  } });
  const answer = await check(fixture.runtime);
  assert.deepEqual(answer, {
    status: 'ok', parcelCount: 1, overflow: false,
    viewportCoverage: 'unknown', geometryDelivered: false,
  });
  assert.equal(lookups, 2);
  assert.equal(fixture.connects, 3);
  assert.equal(fixture.executed.filter((value) => typeof value === 'object'
    && value.text === RESTRICTED_PARCEL_SOURCE_RPC_SQL).length, 2);
  assert.equal(fixture.executed.filter((value) => typeof value === 'object'
    && value.text === RESTRICTED_PARCEL_VIEWPORT_RPC_SQL).length, 1);
  assert.equal(fixture.executed.filter((value) => typeof value === 'string'
    && value === 'BEGIN TRANSACTION READ ONLY').length, 3);
  assert.equal(fixture.released.length, 3);
  assert.ok(fixture.released.every((value) => value === undefined));
  assert.equal(JSON.stringify(answer).includes('PRIVATE-FIXTURE-ID'), false);
  assert.equal(JSON.stringify(answer).includes(handle), false);
});

test('a revoked session during the viewport query denies even aggregate metadata', async () => {
  let calls = 0;
  const fixture = setup({ session: async () => {
    calls++;
    return calls === 1 ? storedSession()
      : { ...storedSession(), revokedAtMs: clock };
  } });
  assert.deepEqual(await check(fixture.runtime), {
    status: 'denied', viewportCoverage: 'unknown',
  });
  assert.equal(calls, 2);
  assert.equal(fixture.connects, 2);
});

test('invalid cookie handle or wrong county grants cannot query the database', async () => {
  const fixture = setup();
  const wrongCounty = { ...request(), countyFips: '48029' };
  assert.deepEqual(await check(fixture.runtime, wrongCounty), {
    status: 'denied', viewportCoverage: 'unknown',
  });
  assert.equal(fixture.connects, 0);
  assert.deepEqual(await fixture.runtime.readViewportMetadata({
    sessionHandle: 'client-supplied-admin',
    request: request(),
  }), { status: 'denied', viewportCoverage: 'unknown' });
  assert.equal(fixture.connects, 0);
});

test('unapproved and expired source rights deny the viewport query', async () => {
  for (const sourceRow of [
    { ...approved(), rights_state: 'unreviewed' },
    { ...approved(), approved_caching_until_ms: clock },
    { ...approved(), county_fips: '48029' },
  ]) {
    const fixture = setup({ source: async () => ({ rows: [sourceRow] }) });
    assert.deepEqual(await check(fixture.runtime), {
      status: 'denied', viewportCoverage: 'unknown',
    });
    assert.equal(fixture.connects, 1);
  }
});

test('partial page overflow preserves unknown coverage and never returns parcel geometry', async () => {
  const fixture = setup({ viewport: async () => ({ rows: Array.from({ length: 11 },
    (_, i) => ({ ...parcel(), source_parcel_id: String(i + 1) })) }) });
  const answer = await check(fixture.runtime);
  assert.deepEqual(answer, {
    status: 'partial-page', parcelCount: 10, overflow: true,
    viewportCoverage: 'unknown', geometryDelivered: false,
  });
});

test('database exceptions fail closed and do not return SQL or credentials', async () => {
  const fixture = setup({ viewport: async () => {
    throw new Error('private DB credential: never expose');
  } });
  const answer = await check(fixture.runtime);
  assert.deepEqual(answer, { status: 'unavailable', viewportCoverage: 'unknown' });
  assert.equal(JSON.stringify(answer).includes('credential'), false);
  assert.ok(fixture.released.some((value) => value instanceof Error));
});
