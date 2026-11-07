import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DRIVER_SMOKE_IMAGE,
  parseDisposableLoopbackPort,
  syntheticServiceRoleSql,
  SYNTHETIC_DRIVER_FIXTURE_SQL,
  runParcelPgDriverSmoke,
} from '../../../scripts/bdp/parcel-pg-driver-disposable-smoke.mjs';

test('manual real driver smoke refuses all invocations without exact opt-in', async () => {
  let driverLoads = 0;
  const loadPg = async () => { driverLoads++; throw Error('must not load'); };
  for (const args of [[], ['--production'], ['--disposable-only','--host=production'],
    ['--database=bdp'], ['--disposable-only','--disposable-only']]) {
    await assert.rejects(runParcelPgDriverSmoke(args,{loadPg}), /Refusing to connect/);
  }
  assert.equal(driverLoads,0);
});

test('missing actual pg dependency is reported before Docker starts', async () => {
  await assert.rejects(runParcelPgDriverSmoke(['--disposable-only'],{
    loadPg: async () => { throw Error('MODULE_NOT_FOUND'); },
  }),/real pg driver is not installed/);
});

test('port parser allows only explicit loopback-mapped ephemeral ports', () => {
  assert.equal(parseDisposableLoopbackPort('127.0.0.1:54329\n'),54329);
  for (const bad of ['0.0.0.0:54329','[::]:54329','::1:54329',
    'localhost:54329','127.0.0.1:0','127.0.0.1:65536',
    '127.0.0.1:54329\n0.0.0.0:54329','',null,53321]) {
    assert.equal(parseDisposableLoopbackPort(bad),null);
  }
});

test('service login SQL permits only a generated 32-byte hex password', () => {
  const synthetic = 'd'.repeat(64);
  const sql = syntheticServiceRoleSql(synthetic);
  assert.match(sql,/CREATE ROLE ldos_parcel_service LOGIN NOINHERIT NOSUPERUSER/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION bdp_parcel_index.approved_sources_rpc/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION bdp_parcel_index.parcel_viewport_probe_rpc/);
  assert.doesNotMatch(sql,/GRANT SELECT|GRANT ALL|GRANT .* ON ALL TABLES/i);
  for (const invalid of ['', 'password', 'd'.repeat(63), 'X'.repeat(64), null]) {
    assert.throws(() => syntheticServiceRoleSql(invalid), TypeError);
  }
});

test('fixture is synthetic and cannot import licensed county GIS', () => {
  assert.match(SYNTHETIC_DRIVER_FIXTURE_SQL,/example\.invalid\/fixture/);
  assert.match(SYNTHETIC_DRIVER_FIXTURE_SQL,/SYNTHETIC-PARCEL/);
  assert.match(SYNTHETIC_DRIVER_FIXTURE_SQL,/ST_Multi\(public.ST_MakeEnvelope/);
  assert.match(SYNTHETIC_DRIVER_FIXTURE_SQL,/DISPOSABLE ONLY/);
  assert.equal(DRIVER_SMOKE_IMAGE,'postgis/postgis:17-3.5');
});

test('runner uses real pg, synchronized init, randomized private password and loopback-only Docker port', () => {
  const code = readFileSync(new URL('../../../scripts/bdp/parcel-pg-driver-disposable-smoke.mjs',import.meta.url),'utf8');
  assert.match(code,/import\('pg'\)/);
  assert.match(code,/PostgreSQL init process complete; ready for start up/);
  assert.match(code,/127\.0\.0\.1::5432/);
  assert.match(code,/docker\(\['rm','--force','--volumes',name\]/);
  assert.match(code,/createParcelPgPoolConnector/);
  assert.match(code,/createParcelMetadataRuntime/);
  assert.match(code,/SELECT source_parcel_id FROM bdp_parcel_index.parcel_versions/);
  assert.match(code,/rights_state='revoked'/);
  assert.match(code,/PASS: disposable real pg Pool, restricted LOGIN, HMAC metadata and revocation/);
  // Inspect the Docker RUN arguments, not the entire source file:
  // '--volumes' is intentionally present on 'docker rm' for safe cleanup.
  const runArgs = code.match(/docker\(\['run',[\s\S]*?DRIVER_SMOKE_IMAGE\]/)?.[0];
  assert.ok(runArgs, 'Must find the disposable docker run invocation');
  assert.match(runArgs, /'--network','bridge'/);
  assert.match(runArgs, /'-p','127\.0\.0\.1::5432'/);
  assert.doesNotMatch(runArgs, /'--(?:mount|volume|volumes|privileged)'|'-P'|'--network','host'|POSTGRES_HOST_AUTH_METHOD=trust/);
  // Removing the anonymous volume on teardown is REQUIRED, not unsafe.
  assert.match(code, /\['rm','--force','--volumes',name\]/);
});
