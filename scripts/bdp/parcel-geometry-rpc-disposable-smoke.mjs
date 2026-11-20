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
import {
  EXTRA_SYNTHETIC_PARCELS_SQL,
} from './parcel-geometry-disposable-smoke.mjs';

/**
 * Step 40C-19: OPT-IN DISPOSABLE-ONLY SECURITY DEFINER SQL validation.
 *
 * No ports, networks, bind mounts, reused databases, data imports, login
 * accounts or publication rights for any real source. A synthetic NOLOGIN
 * role gets EXECUTE only inside this disposable fixture to test privilege
 * separation. It is NOT a production role or an authorized browser route.
 */
export const GEOMETRY_RPC_SUCCESS =
  'PASS: disposable fixed geometry RPC, default-deny, restricted EXECUTE, and revocation.';
export const GEOMETRY_RPC_PROBE_ROLE = 'ldos_geometry_probe_test';
export const GEOMETRY_RPC_NAME = 'bdp_parcel_index.parcel_geometry_snapshot_rpc';
export const GEOMETRY_RPC_TYPES =
  'text,text,bigint,double precision,double precision,double precision,double precision,integer';
const INIT_MARKER = 'PostgreSQL init process complete; ready for start up.';

export function requireGeometryRpcDisposableOptIn(args) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing geometry RPC test without exact --disposable-only');
  }
  return true;
}

function docker(args, { input, timeout = 120_000 } = {}) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout, maxBuffer: 3 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Isolated Docker command failed: ' +
      String(result.error?.message || result.stderr || result.stdout || '').slice(-1400));
  }
  return result.stdout || '';
}

function diagnostics(name) {
  const result = spawnSync('docker', ['logs', '--tail', '45', name], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 256 * 1024,
  });
  return (String(result.stderr || '') + String(result.stdout || '')).slice(-1600);
}

async function waitForPostgis(name) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (docker(['inspect', '--format', '{{.State.Status}}', name]).trim() !== 'running') {
      throw new Error('Isolated PostGIS container exited during initialization');
    }
    const logs = spawnSync('docker', ['logs', name], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    if (logs.status === 0 && (String(logs.stdout) + String(logs.stderr)).includes(INIT_MARKER)) {
      const ready = spawnSync('docker',
        ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres'],
        { encoding: 'utf8', timeout: 10_000 },
      );
      if (ready.status === 0) return;
    }
    await sleep(1000);
  }
  throw new Error('Isolated PostGIS did not reach final startup state');
}

/** Fixed, synthetic source and extent: never accept runtime user GIS inputs. */
export const GEOMETRY_RPC_QUERY = `SELECT *
  FROM ${GEOMETRY_RPC_NAME}(
    '48453','step40c13-synthetic',1,
    -97.76,30.24,-97.71,30.27,3)`;

export const GEOMETRY_RPC_PROBE_GRANT = `CREATE ROLE ${GEOMETRY_RPC_PROBE_ROLE}
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA bdp_parcel_index TO ${GEOMETRY_RPC_PROBE_ROLE};
GRANT EXECUTE ON FUNCTION ${GEOMETRY_RPC_NAME}(${GEOMETRY_RPC_TYPES})
  TO ${GEOMETRY_RPC_PROBE_ROLE};`;

export async function runGeometryRestrictedRpcDisposableSmoke(args = process.argv.slice(2)) {
  requireGeometryRpcDisposableOptIn(args);
  const name = 'ldos-geometry-rpc-test-' + randomBytes(6).toString('hex');
  const password = randomBytes(32).toString('hex');
  let created = false;
  try {
    // No published ports and NO Docker network: all SQL runs on the isolated
    // PostgreSQL Unix socket via docker exec, not through an app connection.
    docker(['run', '-d', '--name', name, '--network', 'none',
      '-e', 'POSTGRES_PASSWORD=' + password,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      DRIVER_SMOKE_IMAGE], { timeout: 240_000 });
    created = true;
    await waitForPostgis(name);

    const execute = (sql) => spawnSync('docker', [
      'exec', '-i', name, 'psql', '-X', '-t', '-A',
      '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
    ], { input: sql, encoding: 'utf8', timeout: 120_000, maxBuffer: 3 * 1024 * 1024 });
    const apply = (sql) => {
      const out = execute(sql);
      if (out.error || out.status !== 0) throw new Error(
        'Disposable SQL failed: ' + String(out.error?.message || out.stderr || out.stdout).slice(-1500));
      return out.stdout.trim();
    };
    const rejectAsDenied = (sql) => {
      const out = execute(sql);
      assert.notEqual(out.status, 0, 'Restricted role must not execute raw SQL or unpublished RPC');
      assert.match(String(out.stderr), /permission denied/i);
    };
    const fixtureSql = (file) => readFileSync(new URL(
      '../../src/bdp/ingestion/sql/' + file, import.meta.url), 'utf8');

    apply('SELECT PostGIS_Version();\n');
    apply(fixtureSql('parcelIndexFoundation.sql'));
    apply(fixtureSql('parcelRestrictedRpcFoundation.sql'));
    apply(fixtureSql('parcelGeometryPublicationRightsFoundation.sql'));
    apply(SYNTHETIC_DRIVER_FIXTURE_SQL);
    apply(EXTRA_SYNTHETIC_PARCELS_SQL);
    apply("INSERT INTO bdp_parcel_index.geometry_publication_reviews " +
      "(source_id,county_fips) VALUES ('step40c13-synthetic','48453');");

    // Validate the new SECURITY DEFINER function and its REVOKEs as real
    // PostgreSQL DDL before testing any synthetic rights transition.
    apply(fixtureSql('parcelGeometryRestrictedRpcFoundation.sql'));

    // Verify new RPC is unavailable even though the old metadata role has
    // USAGE on the schema and can run approved metadata RPCs.
    const privileges = apply(`SELECT
      has_function_privilege('ldos_parcel_rpc_client',
        '${GEOMETRY_RPC_NAME}(${GEOMETRY_RPC_TYPES})','EXECUTE'),
      has_table_privilege('ldos_parcel_rpc_client',
        'bdp_parcel_index.geometry_publication_reviews','SELECT')`);
    assert.equal(privileges, 'f|f');
    rejectAsDenied(`BEGIN READ ONLY;
      SET LOCAL ROLE ldos_parcel_rpc_client;
      ${GEOMETRY_RPC_QUERY};`);

    // A fresh test-only NOLOGIN role is granted EXECUTE, but no raw table
    // SELECT. This role and the GRANT disappear with the test container.
    apply(GEOMETRY_RPC_PROBE_GRANT);
    assert.equal(apply(`SELECT has_function_privilege('${GEOMETRY_RPC_PROBE_ROLE}',
      '${GEOMETRY_RPC_NAME}(${GEOMETRY_RPC_TYPES})','EXECUTE'),
      has_table_privilege('${GEOMETRY_RPC_PROBE_ROLE}',
      'bdp_parcel_index.parcel_versions','SELECT')`), 't|f');
    rejectAsDenied(`BEGIN READ ONLY;
      SET LOCAL ROLE ${GEOMETRY_RPC_PROBE_ROLE};
      SELECT source_parcel_id FROM bdp_parcel_index.parcel_versions LIMIT 1;`);

    // Caching approval alone cannot enable a single geometry row.
    const asProbe = (sql) => apply(`BEGIN READ ONLY;
      SET LOCAL ROLE ${GEOMETRY_RPC_PROBE_ROLE};
      ${sql}
      ROLLBACK;`);
    const count = () => {
      const result = asProbe(`SELECT count(*) FROM (${GEOMETRY_RPC_QUERY}) AS g;`);
      const rows = result.split(/\r?\n/).map(s => s.trim());
      return Number(rows.find(s => /^\d+$/.test(s)));
    };
    assert.equal(count(), 0, 'Independent redistribution rights default to denied');

    // Approve ONLY invented source data in this disposable container.
    apply("UPDATE bdp_parcel_index.geometry_publication_reviews SET " +
      "review_state='approved', allow_geometry_redistribution=TRUE, " +
      "review_reference='SYNTHETIC TEST ONLY', " +
      "reviewed_at=clock_timestamp()-interval '1 hour', " +
      "expires_at=clock_timestamp()+interval '2 hours' " +
      "WHERE source_id='step40c13-synthetic';");
    assert.equal(count(), 3, 'Fixed geometry RPC must return capped limit+1 rows');

    const json = asProbe(`SELECT COALESCE(json_agg(
      json_build_object('id',g.source_parcel_id,'hasPolygon',g.geometry IS NOT NULL)
      ORDER BY g.source_parcel_id COLLATE "C"), '[]'::json)::text
      FROM (${GEOMETRY_RPC_QUERY}) g;`);
    const records = JSON.parse(json.split(/\r?\n/).find(line => line.trim().startsWith('[')));
    assert.deepEqual(records, [
      { id: 'SYNTHETIC-PARCEL', hasPolygon: true },
      { id: 'SYNTHETIC-PARCEL-002', hasPolygon: true },
      { id: 'SYNTHETIC-PARCEL-003', hasPolygon: false },
    ]);

    // Explicitly prohibited county/run probes cannot enumerate parcels.
    const wrongCounty = GEOMETRY_RPC_QUERY.replace("'48453'", "'48029'");
    const wrongRun = GEOMETRY_RPC_QUERY.replace("'step40c13-synthetic',1",
      "'step40c13-synthetic',999");
    for (const query of [wrongCounty, wrongRun]) {
      const result = asProbe(`SELECT count(*) FROM (${query}) AS g;`);
      assert.match(result, /(?:^|\n)0(?:\n|$)/);
    }

    apply("UPDATE bdp_parcel_index.geometry_publication_reviews " +
      "SET review_state='revoked', allow_geometry_redistribution=FALSE " +
      "WHERE source_id='step40c13-synthetic';");
    assert.equal(count(), 0, 'Publication revocation must deny subsequent fixed RPC calls');
    apply("UPDATE bdp_parcel_index.geometry_publication_reviews " +
      "SET review_state='approved', allow_geometry_redistribution=TRUE " +
      "WHERE source_id='step40c13-synthetic';");
    apply("UPDATE bdp_parcel_index.source_registry SET rights_state='revoked' " +
      "WHERE source_id='step40c13-synthetic';");
    assert.equal(count(), 0, 'Caching revocation must independently deny fixed RPC calls');

    process.stdout.write(GEOMETRY_RPC_SUCCESS + '\n');
  } catch (error) {
    const detail = created ? '\nDisposable PostGIS logs:\n' + diagnostics(name) : '';
    throw new Error(('Disposable geometry RPC failed: ' + error.message + detail)
      .replaceAll(password, '[redacted]').slice(0, 2800));
  } finally {
    if (created) {
      try { docker(['rm', '--force', '--volumes', name], { timeout: 30_000 }); }
      catch {
        process.stderr.write('WARNING: unable to remove isolated geometry RPC container\n');
      }
    }
  }
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runGeometryRestrictedRpcDisposableSmoke().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
