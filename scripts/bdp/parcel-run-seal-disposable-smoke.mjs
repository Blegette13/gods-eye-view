import { spawnSync } from 'node:child_process';
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
 * Step 40C-27: manual synthetic disposable PostGIS verification of the
 * proposed run-seal triggers. Does not connect to any existing DB or
 * enable parcel geometry redistribution, production SQL, or HTTP routes.
 */
export const RUN_SEAL_SMOKE_SUCCESS =
  'PASS: disposable PostGIS immutable run seals, denied mutations and incomplete-run rejection.';
const SOURCE = 'step40c13-synthetic';
const IMAGE_READY_MARKER = 'PostgreSQL init process complete; ready for start up.';

export function requireRunSealDisposableOptIn(args) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing parcel run seal smoke without exact --disposable-only');
  }
  return true;
}

function docker(args, { input, timeout = 120_000 } = {}) {
  const p = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout, maxBuffer: 3 * 1024 * 1024,
  });
  if (p.error || p.status !== 0) throw new Error('Disposable Docker command failed: ' +
    String(p.error?.message || p.stderr || p.stdout || '').slice(-1400));
  return p.stdout || '';
}

async function waitForPostgis(name) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = docker(['inspect', '--format', '{{.State.Status}}', name]).trim();
    if (state !== 'running') throw new Error('Disposable PostGIS exited during startup');
    const logs = spawnSync('docker', ['logs', name], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    if (logs.status === 0 &&
      String(logs.stdout + logs.stderr).includes(IMAGE_READY_MARKER)) {
      const ready = spawnSync('docker', [
        'exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres',
      ], { encoding: 'utf8', timeout: 10_000 });
      if (ready.status === 0) return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable PostGIS did not complete initialization');
}

export async function runParcelRunSealDisposableSmoke(args = process.argv.slice(2)) {
  requireRunSealDisposableOptIn(args);
  const name = 'ldos-run-seal-test-' + randomBytes(6).toString('hex');
  const password = randomBytes(32).toString('hex');
  let created = false;

  try {
    docker(['run', '-d', '--name', name, '--network', 'none',
      '-e', 'POSTGRES_PASSWORD=' + password,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      DRIVER_SMOKE_IMAGE], { timeout: 240_000 });
    created = true;
    await waitForPostgis(name);

    const execSql = (sql) => spawnSync('docker', [
      'exec', '-i', name, 'psql', '-X', '-t', '-A',
      '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
    ], { input: sql, encoding: 'utf8', timeout: 120_000,
      maxBuffer: 3 * 1024 * 1024 });
    const runSql = (sql) => {
      const p = execSql(sql);
      if (p.error || p.status !== 0) throw new Error('Synthetic SQL failed: ' +
        String(p.error?.message || p.stderr || p.stdout).slice(-1500));
      return p.stdout.trim();
    };
    const rejectSql = (sql, pattern) => {
      const p = execSql(sql);
      assert.notEqual(p.status, 0, 'Disallowed synthetic mutation unexpectedly succeeded');
      assert.match(String(p.stderr), pattern);
    };
    const file = (filename) => readFileSync(new URL(
      '../../src/bdp/ingestion/sql/' + filename, import.meta.url), 'utf8');

    runSql('SELECT PostGIS_Version();');
    runSql(file('parcelIndexFoundation.sql'));
    runSql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    runSql(EXTRA_SYNTHETIC_PARCELS_SQL);

    // Insert a complete synthetic window BEFORE sealing. Actual count,
    // county/source/version and update privileges are verified by guards.
    runSql("INSERT INTO bdp_parcel_index.coverage_windows " +
      "(ingest_run_id,source_id,county_fips,window_key,window_geometry," +
      "coverage_state,received_records,omitted_unidentified,source_truncated,observed_at) " +
      "SELECT id,source_id,'48453','synthetic-window'," +
      "public.ST_MakeEnvelope(-97.76,30.24,-97.71,30.27,4326)," +
      "'complete',3,0,FALSE,clock_timestamp() " +
      "FROM bdp_parcel_index.ingest_runs WHERE source_id='" + SOURCE + "';");

    runSql(file('parcelRunSealFoundation.sql'));
    const runId = runSql("SELECT id FROM bdp_parcel_index.ingest_runs " +
      "WHERE source_id='" + SOURCE + "';");
    assert.match(runId, /^[1-9][0-9]*$/);
    assert.equal(runSql('SELECT count(*) FROM bdp_parcel_index.parcel_versions ' +
      'WHERE ingest_run_id=' + runId + ';'), '3');

    // A finished but incomplete run must not be sealable.
    const incompleteId = runSql(
      "INSERT INTO bdp_parcel_index.ingest_runs " +
      "(source_id,source_version,outcome,finished_at,received_records," +
      "omitted_unidentified,source_reported_truncated) " +
      "VALUES ('" + SOURCE + "','incomplete-only','partial',clock_timestamp()," +
      "0,0,FALSE) RETURNING id;"
    );
    assert.match(incompleteId, /^[1-9][0-9]*$/);
    const seal = (id, source, version, count) =>
      'INSERT INTO bdp_parcel_index.parcel_run_seals ' +
      '(ingest_run_id,source_id,county_fips,source_version,indexed_records) ' +
      'VALUES (' + id + ",'" + source + "','48453','" + version + "'," + count + ');';

    rejectSql(seal(incompleteId, SOURCE, 'incomplete-only', 0),
      /Cannot seal missing, incomplete or mismatched parcel run/);
    rejectSql(seal(runId, SOURCE, 'v1', 2),
      /Run seal indexed count differs from completed run/);
    rejectSql(seal(runId, SOURCE, 'wrong-version', 3),
      /Cannot seal missing, incomplete or mismatched parcel run/);
    rejectSql(seal(runId, 'other-source', 'v1', 3),
      /Cannot seal missing, incomplete or mismatched parcel run/);

    runSql(seal(runId, SOURCE, 'v1', 3));
    assert.equal(runSql('SELECT indexed_records FROM ' +
      'bdp_parcel_index.parcel_run_seals WHERE ingest_run_id=' + runId + ';'), '3');
    assert.equal(runSql('SELECT (sealed_at BETWEEN now() - interval ' +
      "'1 minute' AND now()) FROM bdp_parcel_index.parcel_run_seals " +
      'WHERE ingest_run_id=' + runId + ';'), 't');

    const pTable = 'bdp_parcel_index.parcel_versions';
    const wTable = 'bdp_parcel_index.coverage_windows';
    const iTable = 'bdp_parcel_index.ingest_runs';
    const sTable = 'bdp_parcel_index.parcel_run_seals';
    rejectSql('UPDATE ' + pTable + " SET source_feature_id='edit' " +
      'WHERE ingest_run_id=' + runId + ';', /Sealed parcel run is immutable/);
    rejectSql('DELETE FROM ' + pTable + ' WHERE ingest_run_id=' + runId + ';',
      /Sealed parcel run is immutable/);
    rejectSql('INSERT INTO ' + pTable +
      ' (ingest_run_id,source_id,county_fips,source_parcel_id,source_version,' +
      'received_at,source_geometry_sha256,geometry) VALUES (' + runId +
      ",'" + SOURCE + "','48453','SYNTHETIC-NEW','v1'," +
      "clock_timestamp(),repeat('f',64)," +
      'public.ST_Multi(public.ST_MakeEnvelope(-97.75,30.25,-97.74,30.26,4326)));',
      /Cannot add or move records into a sealed parcel run/);
    rejectSql('UPDATE ' + wTable +
      " SET window_key='changed' WHERE ingest_run_id=" + runId + ';',
      /Sealed parcel run is immutable/);
    rejectSql('DELETE FROM ' + wTable + ' WHERE ingest_run_id=' + runId + ';',
      /Sealed parcel run is immutable/);
    rejectSql('UPDATE ' + iTable + " SET source_notes='rewrite' WHERE id=" +
      runId + ';', /Sealed parcel run is immutable/);
    rejectSql('DELETE FROM ' + iTable + ' WHERE id=' + runId + ';',
      /Sealed parcel run is immutable/);
    rejectSql('UPDATE ' + sTable +
      ' SET indexed_records=2 WHERE ingest_run_id=' + runId + ';',
      /Run seal cannot be changed/);
    rejectSql('DELETE FROM ' + sTable + ' WHERE ingest_run_id=' + runId + ';',
      /Run seal cannot be changed/);
    rejectSql(seal(runId, SOURCE, 'v1', 3),
      /duplicate key value violates unique constraint/);

    assert.equal(runSql('SELECT count(*) FROM ' + pTable +
      ' WHERE ingest_run_id=' + runId + ';'), '3');
    assert.equal(runSql('SELECT count(*) FROM ' + wTable +
      ' WHERE ingest_run_id=' + runId + ';'), '1');
    assert.equal(runSql("SELECT outcome FROM " + iTable + ' WHERE id=' + runId + ';'),
      'complete');

    process.stdout.write(RUN_SEAL_SMOKE_SUCCESS + '\n');
  } catch (error) {
    const p = created ? spawnSync('docker', ['logs', '--tail', '30', name], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024,
    }) : null;
    const tail = String((p?.stderr || '') + (p?.stdout || '')).slice(-1500);
    throw new Error(('Disposable run seal verification failed: ' +
      error.message + '\n' + tail).replaceAll(password, '[redacted]').slice(0, 2600));
  } finally {
    if (created) {
      try { docker(['rm', '--force', '--volumes', name], { timeout: 30_000 }); }
      catch {
        process.stderr.write('WARNING: failed to remove isolated run-seal test container\n');
      }
    }
  }
}
if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runParcelRunSealDisposableSmoke().catch(error => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
