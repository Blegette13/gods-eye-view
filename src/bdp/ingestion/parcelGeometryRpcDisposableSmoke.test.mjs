import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GEOMETRY_RPC_SUCCESS, GEOMETRY_RPC_QUERY, GEOMETRY_RPC_NAME,
  GEOMETRY_RPC_TYPES, GEOMETRY_RPC_PROBE_ROLE, GEOMETRY_RPC_PROBE_GRANT,
  requireGeometryRpcDisposableOptIn,
  runGeometryRestrictedRpcDisposableSmoke,
} from '../../../scripts/bdp/parcel-geometry-rpc-disposable-smoke.mjs';

const runner = readFileSync(new URL(
  '../../../scripts/bdp/parcel-geometry-rpc-disposable-smoke.mjs', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  './sql/parcelGeometryRestrictedRpcFoundation.sql', import.meta.url), 'utf8');

test('only exact disposable-only flag allows geometry RPC Docker test', () => {
  assert.equal(requireGeometryRpcDisposableOptIn(['--disposable-only']), true);
  for (const args of [[], ['--live'], ['--disposable-only', '--reuse-db'],
    ['--host=production'], ['--disposable-only', '--disposable-only'], null]) {
    assert.throws(() => requireGeometryRpcDisposableOptIn(args), /Refusing geometry RPC/);
  }
});

test('invalid opt-in fails before attempting any Docker operation', async () => {
  await assert.rejects(runGeometryRestrictedRpcDisposableSmoke(['--production']),
    /Refusing geometry RPC test/);
});

test('isolated Docker startup uses no network, ports, mounts, volumes or trust auth', () => {
  const runArgs = runner.match(/docker\(\['run',[\s\S]*?DRIVER_SMOKE_IMAGE\]/)?.[0];
  assert.ok(runArgs, 'must find the disposable Docker run invocation');
  assert.match(runArgs, /'--network', 'none'/);
  assert.match(runArgs, /'POSTGRES_HOST_AUTH_METHOD=scram-sha-256'/);
  assert.doesNotMatch(runArgs,
    /'--(?:mount|volume|volumes|privileged|publish|publish-all)'|'-p'|'-P'|'--network', 'host'/);
  assert.match(runner, /\['rm', '--force', '--volumes', name\]/);
  assert.match(runner, /PostgreSQL init process complete; ready for start up/);
  assert.match(runner, /randomBytes\(32\)\.toString\('hex'\)/);
});

test('runtime loads only staged schema and synthetic fixtures, never an existing database', () => {
  for (const name of [
    'parcelIndexFoundation.sql',
    'parcelRestrictedRpcFoundation.sql',
    'parcelGeometryPublicationRightsFoundation.sql',
    'parcelGeometryRestrictedRpcFoundation.sql',
  ]) assert.ok(runner.includes(name), name);
  assert.match(runner, /SYNTHETIC_DRIVER_FIXTURE_SQL/);
  assert.match(runner, /EXTRA_SYNTHETIC_PARCELS_SQL/);
  assert.doesNotMatch(runner, /bdp-postgis|connectionString|\.listen\(|createServer\(/);
  assert.ok(!runner.includes('CREATE EXTENSION IF NOT EXISTS postgis'));
});

test('privileged fixture probes a NOLOGIN geometry-only role, not metadata role grants', () => {
  assert.equal(GEOMETRY_RPC_NAME, 'bdp_parcel_index.parcel_geometry_snapshot_rpc');
  assert.match(GEOMETRY_RPC_TYPES, /text,text,bigint/);
  assert.equal(GEOMETRY_RPC_PROBE_ROLE, 'ldos_geometry_probe_test');
  assert.match(GEOMETRY_RPC_PROBE_GRANT, /CREATE ROLE ldos_geometry_probe_test\s+NOLOGIN NOINHERIT/);
  assert.match(GEOMETRY_RPC_PROBE_GRANT, /GRANT EXECUTE ON FUNCTION/);
  assert.doesNotMatch(GEOMETRY_RPC_PROBE_GRANT, /GRANT SELECT|GRANT ALL|LOGIN NOINHERIT/);
  assert.doesNotMatch(migration, /^\s*GRANT\s/mi);
  assert.match(migration, /FROM PUBLIC;/);
  assert.match(migration, /FROM ldos_parcel_rpc_client;/);
});

test('fixed RPC probe is bounded and checks both default denial and explicit revocations', () => {
  assert.match(GEOMETRY_RPC_QUERY, /'48453','step40c13-synthetic',1/);
  assert.match(GEOMETRY_RPC_QUERY, /-97\.76,30\.24,-97\.71,30\.27,3/);
  for (const guard of [
    'Independent redistribution rights default to denied',
    'Publication revocation must deny subsequent fixed RPC calls',
    'Caching revocation must independently deny fixed RPC calls',
    'Fixed geometry RPC must return capped limit+1 rows',
    'has_table_privilege',
    'SET LOCAL ROLE ldos_parcel_rpc_client',
    'hasPolygon',
  ]) assert.ok(runner.includes(guard), guard);
  assert.match(runner, /replaceAll\(password, '\[redacted\]'\)/);
  assert.match(GEOMETRY_RPC_SUCCESS, /^PASS: disposable fixed geometry RPC/);
});
