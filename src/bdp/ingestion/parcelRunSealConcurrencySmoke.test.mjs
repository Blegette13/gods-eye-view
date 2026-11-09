import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RUN_SEAL_CONCURRENCY_SUCCESS, RUN_SEAL_CONCURRENCY_IMAGE,
  requireRunSealConcurrencyOptIn,
  runParcelRunSealConcurrencySmoke,
} from '../../../scripts/bdp/parcel-run-seal-concurrency-smoke.mjs';

const source = readFileSync(new URL(
  '../../../scripts/bdp/parcel-run-seal-concurrency-smoke.mjs',
  import.meta.url), 'utf8');

test('only the exact disposable-only flag enables the concurrency smoke', () => {
  assert.equal(requireRunSealConcurrencyOptIn(['--disposable-only']), true);
  for (const args of [
    null, [], ['--live'], ['--disposable-only', '--reuse'],
    ['--host=production'], ['--disposable-only', '--disposable-only'],
  ]) assert.throws(() => requireRunSealConcurrencyOptIn(args), /Refusing concurrent run-seal/);
});

test('invalid opt-in fails before Docker startup', async () => {
  await assert.rejects(runParcelRunSealConcurrencySmoke(['--production']),
    /Refusing concurrent run-seal/);
});

test('two independent psql clients use the same isolated Unix-socket-only container', () => {
  assert.match(source, /spawn\('docker', \['exec', '-i', name, 'psql'/);
  assert.match(source, /const session = \(\) => \{/);
  assert.match(source, /const writerA = session\(\)/);
  assert.match(source, /const sealerA = session\(\)/);
  assert.match(source, /const sealerB = session\(\)/);
  assert.match(source, /const writerB = session\(\)/);
  assert.match(source, /pg_backend_pid\(\)/);
});

test('Docker has no network access, mapped ports, mounts, persistent volume or trust authentication', () => {
  const run = source.match(/docker\(\['run',[\s\S]*?RUN_SEAL_CONCURRENCY_IMAGE\]/)?.[0];
  assert.ok(run);
  assert.match(run, /'--network', 'none'/);
  assert.match(run, /'POSTGRES_HOST_AUTH_METHOD=scram-sha-256'/);
  assert.doesNotMatch(run, /'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.match(source, /randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(source, /docker\(\['rm','--force','--volumes',name\]/);
  assert.equal(RUN_SEAL_CONCURRENCY_IMAGE, 'postgis/postgis:17-3.5');
});

test('the writer-first test holds an uncommitted parent row before sealing', () => {
  for (const requirement of [
    'received_records=4',
    'SYNTHETIC-RACE-FOUR',
    'WRITER_HOLDS_PARENT',
    'SEALER_PID:',
    'SEAL_COMMITTED',
    'WRITER_COMMITTED',
    'await waitForBlocked(runSql, sealerPid)',
    "'WHERE ingest_run_id=' + runV1 + ';'), '4'",
  ]) assert.ok(source.includes(requirement), requirement);
  assert.ok(source.indexOf("waitForBlocked(runSql, sealerPid)")
    < source.indexOf("writerA.send(\"COMMIT;"));
});

test('the sealer-first test waits for a writer and rejects the late parcel', () => {
  for (const requirement of [
    "'v2','complete'",
    'SYNTHETIC-RACE-V2-ONE',
    'SYNTHETIC-RACE-V2-LATE',
    'SEAL_HOLDS_PARENT',
    'WRITER_PID:',
    'await waitForBlocked(runSql, writerPid)',
    'SEAL_B_COMMITTED',
    'Cannot add or move records into a sealed parcel run',
  ]) assert.ok(source.includes(requirement), requirement);
  assert.ok(source.indexOf('waitForBlocked(runSql, writerPid)')
    < source.indexOf('sealerB.send("COMMIT;'));
});

test('blocking is verified through actual PostgreSQL lock wait and pg_blocking_pids', () => {
  assert.match(source, /wait_event_type = \\'Lock\\'/);
  assert.match(source, /cardinality\(pg_blocking_pids\(pid\)\) > 0/);
  assert.match(source, /pg_catalog\.pg_stat_activity/);
  assert.match(source, /status === 'BLOCKED'/);
  assert.match(source, /12_000/);
});

test('only synthetic fixture, staged SQL and invented parcels are loaded', () => {
  for (const fragment of [
    'parcelIndexFoundation.sql', 'parcelRunSealFoundation.sql',
    'SYNTHETIC_DRIVER_FIXTURE_SQL', 'EXTRA_SYNTHETIC_PARCELS_SQL',
    'step40c13-synthetic',
  ]) assert.ok(source.includes(fragment), fragment);
  assert.doesNotMatch(source, /new Pool\(|connectionString|bdp-postgis|createServer\(|\.listen\(/);
});

test('fixture IDs use separate SELECT calls and no INSERT RETURNING command tag', () => {
  assert.match(source, /SELECT id FROM bdp_parcel_index\.ingest_runs/);
  assert.doesNotMatch(source, /RETURNING id;/);
  assert.match(source, /assert\.match\(runV1, \/\^\[1-9\]/);
  assert.match(source, /assert\.match\(runV2, \/\^\[1-9\]/);
});

test('failed sessions and Docker volumes are cleaned up even on error', () => {
  assert.match(source, /finally \{\s+for \(const p of sessions\)/);
  assert.match(source, /await p\.shutdown\(\)/);
  assert.match(source, /ROLLBACK;/);
  assert.match(source, /child\.kill\(\)/);
  assert.match(source, /replaceAll\(password, '\[redacted\]'\)/);
});

test('success confirms lock ordering only, never snapshot or GIS publication approval', () => {
  assert.match(RUN_SEAL_CONCURRENCY_SUCCESS,
    /^PASS: disposable PostGIS run-seal concurrency/);
  assert.match(source, /This does NOT constitute a proof/);
  assert.doesNotMatch(source, /\bGRANT EXECUTE\b|\bCREATE ROLE\b|\bCREATE SERVER\b/);
});
