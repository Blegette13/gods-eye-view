import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Step 40C-9: manually run the staged restricted RPC migration and smoke
 * only inside a brand-new, randomly named, isolated disposable Docker DB.
 *
 * This script never accepts a host, connection URL, existing container or
 * database volume. It never publishes ports or joins a Docker network.
 * No county GIS data is accessed. It is NOT a production migration command.
 */
export const PARCEL_RPC_SMOKE_IMAGE = 'postgis/postgis:17-3.5';

const fixtures = (file) => readFileSync(
  new URL('../../src/bdp/ingestion/sql/' + file, import.meta.url), 'utf8',
);

/**
 * Augment the checked-in synthetic fixture with checks EXECUTED AS THE
 * restricted role before the fixture revokes the source. This catches
 * accidental tests that succeed only because the superuser executed them.
 */
export function createRestrictedRoleSmokeSql(source = fixtures('parcelRestrictedRpcSmoke.sql')) {
  const marker = "UPDATE bdp_parcel_index.source_registry SET rights_state='revoked'";
  if (typeof source !== 'string' || !source.includes(marker)
    || !source.includes('BEGIN;') || !source.includes('ROLLBACK;')) {
    throw new TypeError('Expected original rollback-only RPC fixture');
  }
  const roleCheck = `
-- No session role inheritance or unrestricted tables in this check.
SET LOCAL ROLE ldos_parcel_rpc_client;
DO $ldos_restricted_test$
DECLARE
  n integer;
  selected_run bigint;
BEGIN
  IF current_user <> 'ldos_parcel_rpc_client' THEN
    RAISE EXCEPTION 'FAIL: expected restricted role';
  END IF;
  IF has_table_privilege(current_user, 'bdp_parcel_index.parcel_versions', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: restricted role has direct parcel SELECT';
  END IF;
  BEGIN
    PERFORM 1 FROM bdp_parcel_index.parcel_versions;
    RAISE EXCEPTION 'FAIL: raw geometry table was readable';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
  SELECT count(*), max(run_id) INTO n, selected_run
  FROM bdp_parcel_index.approved_sources_rpc('48453');
  IF n <> 1 OR selected_run IS NULL THEN
    RAISE EXCEPTION 'FAIL: restricted source resolver could not find the fixture';
  END IF;
  SELECT count(*) INTO n
  FROM bdp_parcel_index.parcel_viewport_probe_rpc(
    '48453','step40c9-test',selected_run,-97.8,30.2,-97.7,30.3,201);
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: restricted viewport RPC returned unexpected count %', n;
  END IF;
  RAISE NOTICE 'PASS: authenticated-role simulation has RPC access but no raw parcel table read';
END;
$ldos_restricted_test$;
RESET ROLE;

`;
  return source.replace(marker, roleCheck + marker);
}

function docker(args, { input, quiet = false, timeout = 180_000 } = {}) {
  const out = spawnSync('docker', args, {
    encoding: 'utf8', input, timeout, maxBuffer: 4 * 1024 * 1024,
  });
  if (out.error) throw new Error('Disposable Docker invocation failed: ' + out.error.message);
  if (out.status !== 0) {
    throw new Error('Disposable Docker command failed (' + out.status + '): '
      + String(out.stderr || out.stdout || '').trim().slice(-1600));
  }
  if (!quiet && out.stdout) process.stdout.write(out.stdout);
  return out.stdout ?? '';
}

/**
 * Capture the reason the isolated database exited BEFORE removing it.
 * Do not use docker --rm on startup: it destroys the diagnostic logs when
 * PostgreSQL exits during initialization (which is what happened locally).
 * This helper never connects to an existing application database.
 */
function disposableContainerDiagnostics(name) {
  const inspect = spawnSync('docker', [
    'inspect', '--format',
    'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}',
    name,
  ], { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 });
  const logs = spawnSync('docker', ['logs', '--tail', '60', name], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024,
  });
  const state = inspect.status === 0 ? inspect.stdout.trim() : 'container state unavailable';
  const text = logs.status === 0 ? (logs.stderr + logs.stdout).trim()
    : 'Postgres startup logs unavailable';
  return 'Disposable PostGIS diagnostics: ' + state + '\n'
    + String(text).slice(-4000);
}

/**
 * pg_isready can succeed during the image's TEMPORARY initdb server phase.
 * Running CREATE EXTENSION concurrently with 10_postgis.sh races and can
 * terminate the entire disposable container with pg_extension_name_index.
 * Wait until Docker's Postgres entrypoint COMPLETES its full init phase.
 */
function postgisInitializationComplete(name) {
  const result = spawnSync('docker', ['logs', name], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) return false;
  return (result.stdout + '\n' + result.stderr)
    .includes('PostgreSQL init process complete; ready for start up.');
}

export async function runRestrictedRpcDisposableSmoke(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing to run except with --disposable-only; never use an existing database');
  }
  const name = 'ldos-restricted-rpc-test-' + randomBytes(6).toString('hex');
  let created = false;
  try {
    // --rm would erase PostgreSQL startup logs if the container exits early.
    // The finally block removes the container AND anonymous test volumes.
    docker(['run', '-d', '--network', 'none', '--name', name,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', PARCEL_RPC_SMOKE_IMAGE],
    { quiet: true, timeout: 240_000 });
    created = true;
    let ready = false;
    for (let tries = 0; tries < 60; tries++) {
      const inspected = spawnSync('docker', [
        'inspect', '--format', '{{.State.Status}}', name,
      ], { encoding: 'utf8', timeout: 10_000 });
      if (inspected.status !== 0 || inspected.stdout.trim() !== 'running') {
        throw new Error('Disposable PostGIS container exited before full initialization');
      }
      // The image has its own 10_postgis.sh. Do NOT connect to its temporary
      // bootstrap server, even if pg_isready reports success.
      if (postgisInitializationComplete(name)) {
        const result = spawnSync('docker',
          ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres'],
          { encoding: 'utf8', timeout: 10_000 });
        if (result.status === 0) { ready = true; break; }
      }
      await sleep(1000);
    }
    if (!ready) throw new Error('Disposable restricted RPC container not ready');
    const psql = (sql) => docker(
      ['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
        '-U', 'postgres', '-d', 'postgres'],
      { input: sql },
    );
    // Image init installs PostGIS into postgres; verify, never race it.
    psql('SELECT PostGIS_Version();\n');
    psql(fixtures('parcelIndexFoundation.sql'));
    psql(fixtures('parcelRestrictedRpcFoundation.sql'));
    psql(createRestrictedRoleSmokeSql());
    process.stdout.write('PASS: isolated PostGIS restricted RPC, synthetic data, and role isolation.\n');
  } catch (error) {
    if (created) {
      // Preserve the first real error, then append why PostgreSQL exited.
      throw new Error(error.message + '\n' + disposableContainerDiagnostics(name));
    }
    throw error;
  } finally {
    if (created) {
      try {
        // One command handles running and exited containers and deletes the
        // image-created anonymous PostgreSQL test volume.
        docker(['rm', '--force', '--volumes', name],
          { quiet: true, timeout: 30_000 });
      } catch (error) {
        process.stderr.write('WARNING: unable to remove isolated test container '
          + name + ': ' + error.message + '\n');
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runRestrictedRpcDisposableSmoke().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
