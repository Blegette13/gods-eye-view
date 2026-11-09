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
 * Step 40C-25 — opt-in, wholly disposable PostGIS keyset SQL verification.
 * All data, GRANTs and function creation occur in a fresh temporary container.
 * No ports, Docker networking, existing database, real county data, or service
 * LOGINs. The metadata-only role must NEVER gain EXECUTE. This is NOT an
 * application geometry endpoint or a commercial GIS redistribution license.
 */
export const KEYSET_SMOKE_SUCCESS =
  'PASS: disposable PostGIS keyset paging, restricted EXECUTE, overflow, and rights revocation.';
export const KEYSET_PROBE_ROLE = 'ldos_geometry_keyset_probe';
export const KEYSET_RPC_SIGNATURE =
  'bdp_parcel_index.parcel_geometry_keyset_rpc(' +
  'text,text,bigint,double precision,double precision,double precision,' +
  'double precision,integer,text,bigint)';
export const SNAPSHOT_RPC_SIGNATURE =
  'bdp_parcel_index.parcel_geometry_snapshot_rpc(' +
  'text,text,bigint,double precision,double precision,double precision,' +
  'double precision,integer)';
export const SEALED_INITIAL_RPC_SIGNATURE =
  'bdp_parcel_index.parcel_geometry_sealed_initial_rpc(' +
  'text,text,bigint,double precision,double precision,double precision,' +
  'double precision,integer)';
const IMAGE_READY_MARKER = 'PostgreSQL init process complete; ready for start up.';
const SOURCE = 'step40c13-synthetic';
const COUNTY = '48453';

export function requireKeysetSmokeOptIn(args) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing keyset smoke without exact --disposable-only flag');
  }
  return true;
}

function docker(args, { input, timeout = 120_000 } = {}) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout, maxBuffer: 3 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Disposable Docker command failed: ' +
      String(result.error?.message || result.stderr || result.stdout || '').slice(-1300));
  }
  return result.stdout || '';
}

function logsFor(name) {
  const result = spawnSync('docker', ['logs', '--tail', '45', name], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 256 * 1024,
  });
  return String(result.stderr || '') + String(result.stdout || '');
}

async function waitForPostgis(name) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = docker(['inspect', '--format', '{{.State.Status}}', name]).trim();
    if (state !== 'running') throw new Error('Disposable PostgreSQL exited prematurely');
    const log = spawnSync('docker', ['logs', name], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    if (log.status === 0 &&
      (String(log.stderr) + String(log.stdout)).includes(IMAGE_READY_MARKER)) {
      const ready = spawnSync('docker', [
        'exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres',
      ], { encoding: 'utf8', timeout: 10_000 });
      if (ready.status === 0) return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable PostGIS image initialization did not complete');
}

export async function runKeysetDisposableSmoke(args = process.argv.slice(2)) {
  requireKeysetSmokeOptIn(args);
  const name = 'ldos-keyset-test-' + randomBytes(6).toString('hex');
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
    ], { input: sql, encoding: 'utf8', timeout: 120_000, maxBuffer: 3 * 1024 * 1024 });
    const apply = (sql) => {
      const result = execSql(sql);
      if (result.error || result.status !== 0) {
        throw new Error('Disposable SQL failed: ' +
          String(result.error?.message || result.stderr || result.stdout).slice(-1400));
      }
      return result.stdout.trim();
    };
    const expectDenied = (sql) => {
      const result = execSql(sql);
      assert.notEqual(result.status, 0, 'SQL must reject restricted access');
      assert.match(String(result.stderr), /permission denied/i);
    };
    const file = (name) => readFileSync(new URL(
      '../../src/bdp/ingestion/sql/' + name, import.meta.url), 'utf8');

    apply('SELECT PostGIS_Version();');
    apply(file('parcelIndexFoundation.sql'));
    apply(file('parcelRestrictedRpcFoundation.sql'));
    apply(file('parcelGeometryPublicationRightsFoundation.sql'));
    apply(SYNTHETIC_DRIVER_FIXTURE_SQL);
    apply(EXTRA_SYNTHETIC_PARCELS_SQL);
    apply("INSERT INTO bdp_parcel_index.geometry_publication_reviews " +
      "(source_id,county_fips) VALUES ('" + SOURCE + "','" + COUNTY + "');");
    apply(file('parcelGeometryRestrictedRpcFoundation.sql'));
    // Seals are required before CREATE of the new keyset RPC; install the
    // proposed guard in this fresh synthetic container only.
    apply(file('parcelRunSealFoundation.sql'));
    apply(file('parcelGeometryKeysetRpcFoundation.sql'));
    apply(file('parcelGeometrySealedInitialRpcFoundation.sql'));

    // Keep both the existing metadata-only role and PUBLIC out of new RPC.
    const privileges = apply("SELECT has_function_privilege('ldos_parcel_rpc_client'," +
      "'" + KEYSET_RPC_SIGNATURE + "','EXECUTE')," +
      "has_function_privilege('ldos_parcel_rpc_client'," +
      "'" + SEALED_INITIAL_RPC_SIGNATURE + "','EXECUTE')," +
      "has_table_privilege('ldos_parcel_rpc_client'," +
      "'bdp_parcel_index.geometry_publication_reviews','SELECT')");
    assert.equal(privileges, 'f|f|f');

    const query = (sourceParcelId, version, { county = COUNTY, run = 1,
      source = SOURCE, probeLimit = 2 } = {}) => {
      // Only these synthetic immutable test values are ever interpolated.
      assert.match(sourceParcelId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
      assert.match(String(version), /^[1-9][0-9]{0,18}$/);
      assert.match(county, /^48[0-9]{3}$/);
      assert.match(source, /^[a-z][a-z0-9_-]{2,79}$/);
      assert.ok(Number.isSafeInteger(run) && run > 0);
      assert.ok(Number.isSafeInteger(probeLimit) && probeLimit >= 2 && probeLimit <= 201);
      return 'SELECT * FROM bdp_parcel_index.parcel_geometry_keyset_rpc(' +
        "'" + county + "','" + source + "'," + run +
        ', -97.76,30.24,-97.71,30.27,' + probeLimit +
        ",'" + sourceParcelId + "'," + version + ')';
    };
    const fixedQuery = query('SYNTHETIC-PARCEL', 1);
    const initialQuery = "SELECT * FROM bdp_parcel_index.parcel_geometry_sealed_initial_rpc('" +
      COUNTY + "','" + SOURCE + "',1,-97.76,30.24,-97.71,30.27,2)";
    expectDenied('BEGIN READ ONLY;\nSET LOCAL ROLE ldos_parcel_rpc_client;\n' +
      fixedQuery + ';');
    expectDenied('BEGIN READ ONLY;\nSET LOCAL ROLE ldos_parcel_rpc_client;\n' +
      initialQuery + ';');

    // This role is NOLOGIN and exists ONLY inside the temporary DB.
    apply('CREATE ROLE ' + KEYSET_PROBE_ROLE +
      ' NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;' +
      '\nGRANT USAGE ON SCHEMA bdp_parcel_index TO ' + KEYSET_PROBE_ROLE + ';');
    // With schema USAGE but no EXECUTE, this newly created role also proves
    // the function has no accidental inherited PUBLIC permission.
    expectDenied('BEGIN READ ONLY;\nSET LOCAL ROLE ' + KEYSET_PROBE_ROLE +
      ';\n' + fixedQuery + ';');
    expectDenied('BEGIN READ ONLY;\nSET LOCAL ROLE ' + KEYSET_PROBE_ROLE +
      ';\n' + initialQuery + ';');
    apply('GRANT EXECUTE ON FUNCTION ' + KEYSET_RPC_SIGNATURE +
      ' TO ' + KEYSET_PROBE_ROLE + ';');
    // Granting one RPC must NOT implicitly authorize the other.
    expectDenied('BEGIN READ ONLY;\nSET LOCAL ROLE ' + KEYSET_PROBE_ROLE +
      ';\n' + initialQuery + ';');
    apply('GRANT EXECUTE ON FUNCTION ' + SEALED_INITIAL_RPC_SIGNATURE +
      ' TO ' + KEYSET_PROBE_ROLE + ';');

    assert.equal(apply("SELECT has_function_privilege('" + KEYSET_PROBE_ROLE +
      "','" + KEYSET_RPC_SIGNATURE + "','EXECUTE')," +
      "has_function_privilege('" + KEYSET_PROBE_ROLE +
      "','" + SEALED_INITIAL_RPC_SIGNATURE + "','EXECUTE')," +
      "has_function_privilege('" + KEYSET_PROBE_ROLE +
      "','" + SNAPSHOT_RPC_SIGNATURE + "','EXECUTE')," +
      "has_table_privilege('" + KEYSET_PROBE_ROLE +
      "','bdp_parcel_index.parcel_versions','SELECT')"), 't|t|f|f');
    expectDenied('BEGIN READ ONLY;\nSET LOCAL ROLE ' + KEYSET_PROBE_ROLE +
      ';\nSELECT source_parcel_id FROM bdp_parcel_index.parcel_versions LIMIT 1;');
    expectDenied('BEGIN READ ONLY;\nSET LOCAL ROLE ' + KEYSET_PROBE_ROLE +
      ";\nSELECT * FROM bdp_parcel_index.parcel_geometry_snapshot_rpc('" +
      COUNTY + "','" + SOURCE + "',1,-97.76,30.24,-97.71,30.27,2);");

    // Defensive read-only execution; PostgreSQL SECURITY DEFINER function
    // enforces both independent source and redistribution rights itself.
    const asRole = (statement) => apply('BEGIN READ ONLY;\nSET LOCAL ROLE ' +
      KEYSET_PROBE_ROLE + ';\n' + statement + ';\nROLLBACK;');
    const output = (statement, useRole = true) => {
      const wrapped = 'SELECT COALESCE(json_agg(json_build_object(' +
        "'id',p.source_parcel_id,'version',p.parcel_version_id::text," +
        "'hasPolygon',p.geometry IS NOT NULL) ORDER BY p.source_parcel_id COLLATE \"C\"," +
        "p.parcel_version_id), '[]'::json)::text FROM (" + statement + ') p';
      const result = useRole ? asRole(wrapped) : apply(wrapped);
      const line = result.split(/\r?\n/).find(s => s.trim().startsWith('['));
      assert.ok(line, 'Expected one PostGIS JSON array result');
      return JSON.parse(line);
    };

    assert.deepEqual(output(fixedQuery), [],
      'Approved caching alone must never allow geometry publication');
    assert.deepEqual(output(initialQuery), [],
      'Approved caching alone must never allow sealed first-page geometry');

    // Authorize ONLY the invented, disposable source fixture.
    apply("UPDATE bdp_parcel_index.geometry_publication_reviews " +
      "SET review_state='approved', allow_geometry_redistribution=TRUE," +
      "review_reference='SYNTHETIC TEST ONLY'," +
      "reviewed_at=clock_timestamp()-interval '1 hour'," +
      "expires_at=clock_timestamp()+interval '2 hours' " +
      "WHERE source_id='" + SOURCE + "';");

    // Even independently approved geometry rights cannot bypass the
    // explicit immutable-run seal gate. Both the first page and later
    // keyset pages still require a separate trusted HTTP authorization layer.
    assert.deepEqual(output(fixedQuery), [],
      'Approved publication without an immutable run seal must return no geometry');
    assert.deepEqual(output(initialQuery), [],
      'Approved publication without a seal must return no first-page geometry');

    // Only the disposable synthetic run is eligible for sealing.
    const syntheticRunId = apply("SELECT id FROM bdp_parcel_index.ingest_runs " +
      "WHERE source_id='" + SOURCE + "' AND source_version='v1';");
    assert.match(syntheticRunId, /^[1-9][0-9]*$/);
    assert.equal(apply("SELECT count(*) FROM bdp_parcel_index.parcel_versions " +
      "WHERE ingest_run_id=" + syntheticRunId + ';'), '3');
    apply("INSERT INTO bdp_parcel_index.parcel_run_seals " +
      "(ingest_run_id,source_id,county_fips,source_version,indexed_records) " +
      "VALUES (" + syntheticRunId + ",'" + SOURCE + "','" + COUNTY + "','v1',3);");
    assert.equal(apply("SELECT indexed_records FROM bdp_parcel_index.parcel_run_seals " +
      "WHERE ingest_run_id=" + syntheticRunId + ';'), '3');

    // Initial page uses sealed RPC under disposable NOLOGIN geometry role.
    // Legacy unsealed snapshot RPC remains inaccessible to this test role.
    const first = output(initialQuery);
    assert.deepEqual(first.map(x => [x.id, x.hasPolygon]), [
      ['SYNTHETIC-PARCEL', true],
      ['SYNTHETIC-PARCEL-002', false], // overflow sentinel
    ]);
    assert.match(first[0].version, /^[1-9][0-9]*$/);

    // Fetch after last ACCEPTED parcel, not after the extra sentinel.
    const second = output(query(first[0].id, first[0].version));
    assert.deepEqual(second.map(x => [x.id, x.hasPolygon]), [
      ['SYNTHETIC-PARCEL-002', true],
      ['SYNTHETIC-PARCEL-003', false],
    ]);
    const third = output(query(second[0].id, second[0].version));
    assert.deepEqual(third.map(x => [x.id, x.hasPolygon]), [
      ['SYNTHETIC-PARCEL-003', true],
    ]);
    assert.deepEqual(output(query(third[0].id, third[0].version)), []);
    const accepted = [first[0].id, second[0].id, third[0].id];
    assert.deepEqual(new Set(accepted).size, 3, 'No duplicate accepted parcels');

    // Wrong source/run/county do NOT produce a second source's rows.
    assert.deepEqual(output(query(first[0].id, first[0].version,
      { county: '48029' })), []);
    assert.deepEqual(output(query(first[0].id, first[0].version,
      { run: 999 })), []);
    assert.deepEqual(output(query(first[0].id, first[0].version,
      { source: 'other-source' })), []);

    apply("UPDATE bdp_parcel_index.geometry_publication_reviews " +
      "SET review_state='revoked',allow_geometry_redistribution=FALSE " +
      "WHERE source_id='" + SOURCE + "';");
    assert.deepEqual(output(query(first[0].id, first[0].version)), [],
      'Publication revocation must prevent next-page delivery');
    assert.deepEqual(output(initialQuery), [],
      'Publication revocation must prevent initial-page delivery');

    apply("UPDATE bdp_parcel_index.geometry_publication_reviews " +
      "SET review_state='approved',allow_geometry_redistribution=TRUE " +
      "WHERE source_id='" + SOURCE + "';");
    apply("UPDATE bdp_parcel_index.source_registry SET rights_state='revoked' " +
      "WHERE source_id='" + SOURCE + "';");
    assert.deepEqual(output(query(first[0].id, first[0].version)), [],
      'Independent source-caching revocation must prevent next-page delivery');
    assert.deepEqual(output(initialQuery), [],
      'Independent source-caching revocation must prevent initial-page delivery');

    process.stdout.write(KEYSET_SMOKE_SUCCESS + '\n');
  } catch (error) {
    const detail = created ? '\nDisposable PostGIS logs:\n' + logsFor(name) : '';
    throw new Error(('Disposable PostGIS keyset failed: ' + error.message + detail)
      .replaceAll(password, '[redacted]').slice(0, 2600));
  } finally {
    if (created) {
      try { docker(['rm', '--force', '--volumes', name], { timeout: 30_000 }); }
      catch { process.stderr.write('WARNING: failed removing isolated keyset container ' +
        name + '\n'); }
    }
  }
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runKeysetDisposableSmoke().catch(error => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
