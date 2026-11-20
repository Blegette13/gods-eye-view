import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  DRIVER_SMOKE_IMAGE, SYNTHETIC_DRIVER_FIXTURE_SQL,
} from './parcel-pg-driver-disposable-smoke.mjs';
import { EXTRA_SYNTHETIC_PARCELS_SQL } from './parcel-geometry-disposable-smoke.mjs';

/**
 * Step 40C-28 — opt-in disposable deterministic TWO-SESSION PostgreSQL
 * concurrency probes for proposed immutable run seals.
 *
 * Never uses a host port, remote connection URI, real county GIS, production
 * DB, persistent Docker volume or application LOGIN. No production grants.
 * This does NOT constitute a proof against owners/superusers disabling
 * triggers, or a cross-request MVCC snapshot.
 */
export const RUN_SEAL_CONCURRENCY_SUCCESS =
  'PASS: disposable PostGIS run-seal concurrency, writer-first and sealer-first ordering.';
export const RUN_SEAL_CONCURRENCY_IMAGE = DRIVER_SMOKE_IMAGE;
const SOURCE = 'step40c13-synthetic';
const COUNTY = '48453';
const READY_MARKER = 'PostgreSQL init process complete; ready for start up.';

export function requireRunSealConcurrencyOptIn(args) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing concurrent run-seal smoke without exact --disposable-only');
  }
  return true;
}

function docker(args, { input, timeout = 120_000 } = {}) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout, maxBuffer: 3 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Disposable Docker command failed: ' +
      String(result.error?.message || result.stderr || result.stdout || '').slice(-1000));
  }
  return result.stdout || '';
}

async function waitForPostgis(name) {
  for (let i = 0; i < 60; i++) {
    const state = docker(['inspect', '--format', '{{.State.Status}}', name]).trim();
    if (state !== 'running') throw new Error('Disposable PostGIS exited unexpectedly');
    const logs = spawnSync('docker', ['logs', name], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    if (logs.status === 0 && String(logs.stderr + logs.stdout).includes(READY_MARKER)) {
      const ready = spawnSync('docker', [
        'exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres',
      ], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      if (ready.status === 0) return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable PostGIS initialization not complete');
}

/** Two independent PostgreSQL backends, both confined to this one container. */
function openPsqlSession(name) {
  const child = spawn('docker', ['exec', '-i', name, 'psql',
    '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres'], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = '', stderr = '', done = false, exitCode = null, startError = null;
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  child.on('error', (error) => { startError = error; });
  child.on('close', (code) => { done = true; exitCode = code; });
  return Object.freeze({
    send(sql) {
      if (done || startError || child.stdin.destroyed) {
        throw new Error('Disposable psql session is no longer writable');
      }
      child.stdin.write(sql.endsWith('\n') ? sql : sql + '\n');
    },
    async waitFor(marker, maxMs = 15_000) {
      const deadline = Date.now() + maxMs;
      while (Date.now() < deadline) {
        if (stdout.includes(marker)) return stdout;
        if (done || startError) break;
        await sleep(40);
      }
      throw new Error('Session did not reach expected marker ' + marker +
        ': ' + String(startError?.message || stderr || stdout).slice(-900));
    },
    async waitForExit(maxMs = 15_000) {
      const deadline = Date.now() + maxMs;
      while (!done && !startError && Date.now() < deadline) await sleep(40);
      if (!done && !startError) throw new Error('Disposable session failed to exit on time');
      return Object.freeze({
        status: exitCode,
        stdout, stderr: String(startError?.message || stderr),
      });
    },
    async shutdown() {
      if (!done && !child.stdin.destroyed) {
        try { child.stdin.write('ROLLBACK;\n\\q\n'); child.stdin.end(); }
        catch { /* process may have already exited */ }
      }
      for (let i = 0; !done && i < 30; i++) await sleep(50);
      if (!done) child.kill();
    },
  });
}

function parcelInsert(runId, version, parcelId) {
  for (const item of [version, parcelId]) {
    assert.match(item, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
  }
  assert.match(String(runId), /^[1-9][0-9]*$/);
  return 'INSERT INTO bdp_parcel_index.parcel_versions ' +
    '(ingest_run_id,source_id,county_fips,source_parcel_id,source_version,' +
    'received_at,source_geometry_sha256,geometry) VALUES (' + runId +
    ",'" + SOURCE + "','" + COUNTY + "','" + parcelId + "','" + version + "'," +
    "clock_timestamp(),repeat('f',64)," +
    'public.ST_Multi(public.ST_MakeEnvelope(-97.75,30.25,-97.74,30.26,4326)));';
}

function sealInsert(runId, version, count) {
  assert.match(String(runId), /^[1-9][0-9]*$/);
  assert.match(version, /^v[0-9]+$/);
  return 'INSERT INTO bdp_parcel_index.parcel_run_seals ' +
    '(ingest_run_id,source_id,county_fips,source_version,indexed_records) ' +
    'VALUES (' + runId + ",'" + SOURCE + "','" + COUNTY + "','" + version + "'," +
    count + ');';
}

async function waitForBlocked(runSql, pid, maxMs = 12_000) {
  assert.match(String(pid), /^[1-9][0-9]*$/);
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const status = runSql(
      'SELECT CASE WHEN wait_event_type = \'Lock\' ' +
      'AND cardinality(pg_blocking_pids(pid)) > 0 THEN \'BLOCKED\' ' +
      'ELSE \'NOT_BLOCKED\' END FROM pg_catalog.pg_stat_activity ' +
      'WHERE pid = ' + pid + ';'
    );
    if (status === 'BLOCKED') return true;
    await sleep(100);
  }
  throw new Error('Concurrent request did not reach a blocked parent-run row lock');
}

export async function runParcelRunSealConcurrencySmoke(args = process.argv.slice(2)) {
  requireRunSealConcurrencyOptIn(args);
  const name = 'ldos-seal-race-' + randomBytes(6).toString('hex');
  const password = randomBytes(32).toString('hex');
  let created = false;
  const sessions = [];
  try {
    docker(['run', '-d', '--name', name, '--network', 'none',
      '-e', 'POSTGRES_PASSWORD=' + password,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      RUN_SEAL_CONCURRENCY_IMAGE], { timeout: 240_000 });
    created = true;
    await waitForPostgis(name);
    const runSql = (sql) => {
      const result = spawnSync('docker', [
        'exec', '-i', name, 'psql', '-X', '-t', '-A',
        '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
      ], { input: sql, encoding: 'utf8', timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024, windowsHide: true });
      if (result.error || result.status !== 0) throw new Error('Synthetic SQL failed: ' +
        String(result.error?.message || result.stderr || result.stdout || '').slice(-1100));
      return result.stdout.trim();
    };
    const sqlFile = (filename) => readFileSync(new URL(
      '../../src/bdp/ingestion/sql/' + filename, import.meta.url), 'utf8');
    const session = () => {
      const p = openPsqlSession(name);
      sessions.push(p);
      return p;
    };

    runSql('SELECT PostGIS_Version();');
    runSql(sqlFile('parcelIndexFoundation.sql'));
    runSql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    runSql(EXTRA_SYNTHETIC_PARCELS_SQL);
    runSql(sqlFile('parcelRunSealFoundation.sql'));
    const runV1 = runSql("SELECT id FROM bdp_parcel_index.ingest_runs " +
      "WHERE source_id='" + SOURCE + "' AND source_version='v1';");
    assert.match(runV1, /^[1-9][0-9]*$/);
    assert.equal(runSql('SELECT count(*) FROM bdp_parcel_index.parcel_versions ' +
      'WHERE ingest_run_id=' + runV1 + ';'), '3');

    // RACE A: an already-started parcel writer wins the parent-row lock.
    // Sealer must WAIT for the writer transaction, see 4 committed parcels,
    // then seal exactly those 4. No false 3-row completed seal is permitted.
    runSql('UPDATE bdp_parcel_index.ingest_runs SET received_records=4 WHERE id=' +
      runV1 + ';');
    const writerA = session();
    writerA.send('BEGIN;\n' + parcelInsert(runV1, 'v1', 'SYNTHETIC-RACE-FOUR') +
      "\nSELECT 'WRITER_HOLDS_PARENT';");
    await writerA.waitFor('WRITER_HOLDS_PARENT');

    const sealerA = session();
    sealerA.send("SELECT 'SEALER_PID:' || pg_backend_pid();");
    const sealerOut = await sealerA.waitFor('SEALER_PID:');
    const sealerPid = sealerOut.match(/SEALER_PID:([1-9][0-9]*)/)?.[1];
    assert.ok(sealerPid, 'Sealer must report its own PostgreSQL backend PID');
    sealerA.send('BEGIN;\n' + sealInsert(runV1, 'v1', 4) +
      "\nCOMMIT;\nSELECT 'SEAL_COMMITTED';");
    await waitForBlocked(runSql, sealerPid);
    assert.equal(runSql('SELECT count(*) FROM bdp_parcel_index.parcel_run_seals ' +
      'WHERE ingest_run_id=' + runV1 + ';'), '0');
    writerA.send("COMMIT;\nSELECT 'WRITER_COMMITTED';");
    await writerA.waitFor('WRITER_COMMITTED');
    await sealerA.waitFor('SEAL_COMMITTED');
    assert.equal(runSql('SELECT indexed_records FROM bdp_parcel_index.parcel_run_seals ' +
      'WHERE ingest_run_id=' + runV1 + ';'), '4');
    assert.equal(runSql('SELECT count(*) FROM bdp_parcel_index.parcel_versions ' +
      'WHERE ingest_run_id=' + runV1 + ';'), '4');

    // RACE B: the sealer wins the parent-row lock. A concurrent INSERT
    // must wait, then fail after commit because its run has been sealed.
    // The v2 fixture is unrelated to real county GIS and stays disposable.
    runSql("INSERT INTO bdp_parcel_index.ingest_runs " +
      "(source_id,source_version,outcome,finished_at,received_records," +
      "omitted_unidentified,source_reported_truncated,observed_envelope) " +
      "VALUES ('" + SOURCE + "','v2','complete',clock_timestamp(),1,0,FALSE," +
      "public.ST_MakeEnvelope(-97.8,30.2,-97.7,30.3,4326));");
    const runV2 = runSql("SELECT id FROM bdp_parcel_index.ingest_runs " +
      "WHERE source_id='" + SOURCE + "' AND source_version='v2';");
    assert.match(runV2, /^[1-9][0-9]*$/);
    runSql(parcelInsert(runV2, 'v2', 'SYNTHETIC-RACE-V2-ONE'));

    const sealerB = session();
    sealerB.send('BEGIN;\n' + sealInsert(runV2, 'v2', 1) +
      "\nSELECT 'SEAL_HOLDS_PARENT';");
    await sealerB.waitFor('SEAL_HOLDS_PARENT');
    const writerB = session();
    writerB.send("SELECT 'WRITER_PID:' || pg_backend_pid();");
    const writerOut = await writerB.waitFor('WRITER_PID:');
    const writerPid = writerOut.match(/WRITER_PID:([1-9][0-9]*)/)?.[1];
    assert.ok(writerPid, 'Writer must report its own PostgreSQL backend PID');
    writerB.send('BEGIN;\n' + parcelInsert(runV2, 'v2', 'SYNTHETIC-RACE-V2-LATE'));
    await waitForBlocked(runSql, writerPid);
    sealerB.send("COMMIT;\nSELECT 'SEAL_B_COMMITTED';");
    await sealerB.waitFor('SEAL_B_COMMITTED');
    // The losing transaction must be refused by the actual trigger.
    const rejected = await writerB.waitForExit();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Cannot add or move records into a sealed parcel run/);
    assert.equal(runSql('SELECT indexed_records FROM bdp_parcel_index.parcel_run_seals ' +
      'WHERE ingest_run_id=' + runV2 + ';'), '1');
    assert.equal(runSql('SELECT count(*) FROM bdp_parcel_index.parcel_versions ' +
      'WHERE ingest_run_id=' + runV2 + ';'), '1');

    process.stdout.write(RUN_SEAL_CONCURRENCY_SUCCESS + '\n');
  } catch (error) {
    const logs = created ? spawnSync('docker', ['logs','--tail','30',name], {
      encoding:'utf8', timeout: 10_000, maxBuffer: 128 * 1024,
      windowsHide: true,
    }) : null;
    throw new Error(('Disposable concurrent run seal failed: ' + error.message +
      '\nDisposable diagnostics:\n' + String(logs?.stderr || logs?.stdout || '')
        .slice(-1100)).replaceAll(password, '[redacted]').slice(0, 2500));
  } finally {
    for (const p of sessions) {
      try { await p.shutdown(); } catch { /* remove container anyway */ }
    }
    if (created) {
      try { docker(['rm','--force','--volumes',name], { timeout: 30_000 }); }
      catch { process.stderr.write('WARNING: isolated concurrency container cleanup failed\n'); }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runParcelRunSealConcurrencySmoke().catch(error => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
