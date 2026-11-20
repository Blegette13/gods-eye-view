import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createRestrictedRoleSmokeSql,
  runRestrictedRpcDisposableSmoke,
  PARCEL_RPC_SMOKE_IMAGE,
} from '../../../scripts/bdp/parcel-rpc-disposable-smoke.mjs';

test('restricted RPC docker smoke is opt-in only', async () => {
  await assert.rejects(runRestrictedRpcDisposableSmoke([]), /Refusing to run/);
  await assert.rejects(runRestrictedRpcDisposableSmoke(['--production']), /Refusing to run/);
  assert.equal(PARCEL_RPC_SMOKE_IMAGE, 'postgis/postgis:17-3.5');
});

test('runtime test executes as restricted role before revoking fixture', () => {
  const sql = createRestrictedRoleSmokeSql();
  const roleAt = sql.indexOf('SET LOCAL ROLE ldos_parcel_rpc_client');
  const revokeAt = sql.indexOf("UPDATE bdp_parcel_index.source_registry SET rights_state='revoked'");
  assert.ok(roleAt > 0 && revokeAt > roleAt);
  assert.match(sql, /current_user <> 'ldos_parcel_rpc_client'/);
  assert.match(sql, /raw geometry table was readable/);
  assert.match(sql, /bdp_parcel_index\.approved_sources_rpc\('48453'\)/);
  assert.match(sql, /bdp_parcel_index\.parcel_viewport_probe_rpc\(/);
  assert.match(sql, /RESET ROLE;/);
  assert.match(sql, /ROLLBACK;/);
});

test('the runner rejects unexpected source fixture and does not accept custom DB connection', () => {
  assert.throws(() => createRestrictedRoleSmokeSql('SELECT 1'), TypeError);
  assert.throws(() => createRestrictedRoleSmokeSql('BEGIN; ROLLBACK;'), TypeError);
});

test('disposable container diagnostics survive early PostgreSQL exit and teardown removes anonymous volumes', () => {
  const runner = readFileSync(new URL('../../../scripts/bdp/parcel-rpc-disposable-smoke.mjs', import.meta.url), 'utf8');
  assert.match(runner, /'inspect', '--format'/);
  assert.match(runner, /'logs', '--tail', '60'/);
  assert.match(runner, /'rm', '--force', '--volumes', name/);
  assert.match(runner, /Disposable PostGIS container exited before full initialization/);
  assert.doesNotMatch(runner, /'run', '-d', '--rm'/);
});

test('PostGIS image initialization is complete before any SQL is sent', () => {
  const runner = readFileSync(new URL('../../../scripts/bdp/parcel-rpc-disposable-smoke.mjs', import.meta.url), 'utf8');
  assert.match(runner, /PostgreSQL init process complete; ready for start up/);
  assert.match(runner, /function postgisInitializationComplete\(name\)/);
  assert.ok(runner.indexOf('postgisInitializationComplete(name)', runner.indexOf('for (let tries')) <
    runner.indexOf("psql('SELECT PostGIS_Version();"));
  assert.doesNotMatch(runner, /psql\('CREATE EXTENSION IF NOT EXISTS postgis;/);
});
