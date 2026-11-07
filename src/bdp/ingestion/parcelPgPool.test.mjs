import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import {
  createParcelPgPoolConnector,
  PARCEL_PG_PRIVILEGE_ATTESTATION_SQL,
  PARCEL_PG_POOL_MAX,
  PARCEL_PG_CONNECT_TIMEOUT_MS,
} from '../../../server/providers/bdp-parcel-pg-pool.js';
import { createParcelMetadataRuntime } from '../../../server/providers/bdp-parcel-metadata-runtime.js';
import {
  RESTRICTED_PARCEL_SOURCE_RPC_SQL,
  RESTRICTED_PARCEL_VIEWPORT_RPC_SQL,
} from '../../../server/providers/bdp-parcel-restricted-rpc-readers.js';

const settings = () => ({
  host: '127.0.0.1', port: 54329, database: 'bdp_metadata_fixture',
  user: 'ldos_parcel_service', password: 'synthetic-only-password', ssl: false,
});
const passingProof = () => ({
  same_principal: true, safe_principal: true, no_schema_create: true,
  no_source_table_rights: true, no_run_table_rights: true,
  no_parcel_table_rights: true, no_coverage_table_rights: true,
  source_rpc_allowed: true, viewport_rpc_allowed: true,
});
function fakePoolFactory({ proof = () => ({ rows: [passingProof()] }), data = () => ({ rows: [] }),
  connectError, onQuery } = {}) {
  const seen = { configuration: null, instances: 0, checkouts: 0, closed: 0, releases: [], commands: [], listeners: [] };
  class Pool {
    constructor(config) {
      seen.configuration = config;
      seen.instances++;
    }
    on(name, listener) { seen.listeners.push({ name, listener }); }
    async connect() {
      seen.checkouts++;
      if (connectError) throw connectError;
      return {
        async query(command) {
          seen.commands.push(command);
          if (onQuery) return onQuery(command);
          if (command === PARCEL_PG_PRIVILEGE_ATTESTATION_SQL) return proof();
          return typeof command === 'string' ? { rows: [] } : data(command);
        },
        release(err) { seen.releases.push(err); },
      };
    }
    async end() { seen.closed++; }
  }
  return { Pool, seen };
}

test('pool factory rejects privileged roles, accidental environment fallback, and unexpected settings', () => {
  const { Pool } = fakePoolFactory();
  assert.throws(() => createParcelPgPoolConnector(), TypeError);
  assert.throws(() => createParcelPgPoolConnector({ Pool, settings: null }), TypeError);
  for (const candidate of [
    { ...settings(), user: 'postgres' },
    { ...settings(), user: 'bdp' },
    { ...settings(), user: 'ldos_parcel_rpc_client' },
    { ...settings(), password: '' },
    { ...settings(), database: 'bdp; DROP' },
    { ...settings(), port: '5432' },
    { ...settings(), connectionString: 'postgresql://owner@localhost/test' },
    { ...settings(), role: 'admin' },
    { ...settings(), host: '/tmp/.s.PGSQL.5432' },
    { ...settings(), host: 'prod.example.com', ssl: false },
    { ...settings(), ssl: { rejectUnauthorized: false } },
  ]) assert.throws(() => createParcelPgPoolConnector({ Pool, settings: candidate }), TypeError);
});

test('remote PostgreSQL requires verified TLS and never accepts SSL downgrade flags', () => {
  const { Pool, seen } = fakePoolFactory();
  const ca = 'SYNTHETIC-CA-CERTIFICATE-CONTENT';
  const connector = createParcelPgPoolConnector({
    Pool,
    settings: { ...settings(), host: 'db.example.com',
      ssl: { rejectUnauthorized: true, ca } },
  });
  assert.equal(seen.configuration.ssl.rejectUnauthorized, true);
  assert.equal(seen.configuration.ssl.ca, ca);
  assert.ok(!('connectionString' in seen.configuration));
  assert.equal(typeof connector.connect, 'function');
  for (const ssl of [
    false, true, { rejectUnauthorized: false },
    { rejectUnauthorized: true, servername: 'attacker.example.com' },
    { rejectUnauthorized: true, ca: '' },
  ]) assert.throws(() => createParcelPgPoolConnector({
    Pool, settings: { ...settings(), host: 'db.example.com', ssl },
  }), TypeError);
});

test('connector instantiation never opens a DB socket and limits pool resources', () => {
  const { Pool, seen } = fakePoolFactory();
  const connector = createParcelPgPoolConnector({ Pool, settings: settings() });
  assert.equal(seen.instances, 1);
  assert.equal(seen.checkouts, 0);
  assert.equal(seen.configuration.max, PARCEL_PG_POOL_MAX);
  assert.equal(seen.configuration.min, 0);
  assert.equal(seen.configuration.connectionTimeoutMillis, PARCEL_PG_CONNECT_TIMEOUT_MS);
  assert.equal(seen.configuration.statement_timeout, 2_000);
  assert.equal(seen.configuration.idle_in_transaction_session_timeout, 4_000);
  assert.equal(seen.configuration.ssl, false);
  assert.deepEqual(seen.listeners.map((x) => x.name), ['error']);
  assert.deepEqual(Object.keys(connector), ['connect', 'close']);
  assert.ok(Object.isFrozen(connector));
});

test('every pool checkout validates the authenticated database role before returning a pinned client', async () => {
  const { Pool, seen } = fakePoolFactory();
  const connector = createParcelPgPoolConnector({ Pool, settings: settings() });
  const first = await connector.connect();
  const second = await connector.connect();
  assert.equal(seen.checkouts, 2);
  assert.deepEqual(seen.commands, [
    PARCEL_PG_PRIVILEGE_ATTESTATION_SQL, PARCEL_PG_PRIVILEGE_ATTESTATION_SQL,
  ]);
  first.release();
  second.release();
  assert.deepEqual(seen.releases, [undefined, undefined]);
  await connector.close();
  assert.equal(seen.closed, 1);
});

test('superuser, inherited raw grants, schema CREATE, or missing RPC EXECUTE rejects checkout', async () => {
  for (const key of Object.keys(passingProof())) {
    const { Pool, seen } = fakePoolFactory({
      proof: () => ({ rows: [{ ...passingProof(), [key]: false }] }),
    });
    const connector = createParcelPgPoolConnector({ Pool, settings: settings() });
    await assert.rejects(connector.connect(), /privilege check failed/);
    assert.equal(seen.checkouts, 1);
    assert.equal(seen.releases.length, 1);
    assert.ok(seen.releases[0] instanceof Error);
    await connector.close();
  }
});

test('missing attestation rows, query errors, and connection failures are generic and evict clients', async () => {
  for (const proof of [() => ({ rows: [] }), () => ({ rows: [{}] })]) {
    const { Pool, seen } = fakePoolFactory({ proof });
    const connector = createParcelPgPoolConnector({ Pool, settings: settings() });
    await assert.rejects(connector.connect(), /^Error: Parcel metadata database connection or privilege check failed$/);
    assert.ok(seen.releases[0] instanceof Error);
    await connector.close();
  }
  const failure = fakePoolFactory({ connectError: new Error('SENSITIVE connection host and password') });
  const connector = createParcelPgPoolConnector({ Pool: failure.Pool, settings: settings() });
  await assert.rejects(connector.connect(), (error) => {
    assert.equal(error.message, 'Parcel metadata database connection or privilege check failed');
    assert.doesNotMatch(error.message, /SENSITIVE/);
    return true;
  });
  await connector.close();
});

test('close is idempotent and blocks subsequent acquisition', async () => {
  const { Pool, seen } = fakePoolFactory();
  const connector = createParcelPgPoolConnector({ Pool, settings: settings() });
  await connector.close();
  await connector.close();
  assert.equal(seen.closed, 1);
  await assert.rejects(connector.connect(), /pool is closed/);
  assert.equal(seen.checkouts, 0);
});

test('driver-ready pool composes with HMAC and both fixed RPCs without exposing parcel identifiers', async () => {
  const clock = 1_000_000;
  const key = randomBytes(48);
  const handle = randomBytes(32).toString('base64url');
  const digest = createHmac('sha256', key).update(handle).digest('hex');
  let sourceCalls = 0;
  let viewportCalls = 0;
  const data = (command) => {
    if (command.text === RESTRICTED_PARCEL_SOURCE_RPC_SQL) {
      sourceCalls++;
      return { rows: [{
        source_id: 'travis-cad', county_fips: '48453', rights_state: 'approved',
        approved_caching_until_ms: clock + 100_000, run_id: '42',
      }] };
    }
    if (command.text === RESTRICTED_PARCEL_VIEWPORT_RPC_SQL) {
      viewportCalls++;
      return { rows: [{
        source_parcel_id: 'PRIVATE-FIXTURE-PARCEL',
        geometry_vertices: 5, geometry_memory_bytes: 240,
      }] };
    }
    throw new Error('Unrecognized SQL');
  };
  const { Pool, seen } = fakePoolFactory({ data });
  const connector = createParcelPgPoolConnector({ Pool, settings: settings() });
  const runtime = createParcelMetadataRuntime({
    connect: connector.connect,
    now: () => clock,
    sessionHmacKey: key,
    findSessionByDigest: async () => ({
      sessionDigest: digest, subject: 'fixture-operator',
      accountStatus: 'active', mfaVerified: true, revokedAtMs: null,
      issuedAtMs: clock - 10_000, lastSeenAtMs: clock - 1_000,
      expiresAtMs: clock + 100_000,
      countyGrants: [{ countyFips: '48453', allowParcelDiscovery: true }],
    }),
  });
  const result = await runtime.readViewportMetadata({
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
  assert.equal(sourceCalls, 2);
  assert.equal(viewportCalls, 1);
  assert.equal(seen.commands.filter((x) => x === PARCEL_PG_PRIVILEGE_ATTESTATION_SQL).length, 3);
  assert.ok(!JSON.stringify(result).includes('PRIVATE-FIXTURE-PARCEL'));
  assert.equal(seen.releases.length, 3);
  await connector.close();
});
