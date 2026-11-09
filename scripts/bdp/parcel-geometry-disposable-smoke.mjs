import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  DRIVER_SMOKE_IMAGE, parseDisposableLoopbackPort, SYNTHETIC_DRIVER_FIXTURE_SQL,
} from './parcel-pg-driver-disposable-smoke.mjs';
import { parseBoundedParcelPageRequest } from '../../src/bdp/ingestion/parcelPageContract.js';
import {
  buildParcelGeometrySnapshotStatement, stageParcelGeometrySnapshot,
} from '../../src/bdp/ingestion/parcelGeometrySnapshotPlan.js';

/**
 * Step 40C-17: MANUAL DISPOSABLE POSTGIS ONLY. NEVER a migration runner.
 * Creates a fresh, random Docker test container, on a random loopback port,
 * with no bind mounts, named volumes, existing service links, or external GIS.
 * Admin DB access is permissible ONLY inside this synthetic container to
 * validate draft SQL; the real metadata service must never get these grants.
 */
const INIT_MARKER = 'PostgreSQL init process complete; ready for start up.';
export const GEOMETRY_SMOKE_SUCCESS =
  'PASS: disposable PostGIS geometry rights, bounded snapshot, overflow, and revocation.';

export function requireGeometryDisposableOptIn(args) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing geometry smoke without exact --disposable-only');
  }
  return true;
}

export const EXTRA_SYNTHETIC_PARCELS_SQL = [
  "INSERT INTO bdp_parcel_index.parcel_versions",
  "  (ingest_run_id,source_id,county_fips,source_parcel_id,source_version,",
  "   received_at,source_geometry_sha256,geometry)",
  "SELECT id,source_id,'48453','SYNTHETIC-PARCEL-002','v1',",
  "  clock_timestamp(),repeat('b',64),",
  "  public.ST_Multi(public.ST_MakeEnvelope(-97.735,30.25,-97.725,30.26,4326))",
  "FROM bdp_parcel_index.ingest_runs WHERE source_id='step40c13-synthetic';",
  "INSERT INTO bdp_parcel_index.parcel_versions",
  "  (ingest_run_id,source_id,county_fips,source_parcel_id,source_version,",
  "   received_at,source_geometry_sha256,geometry)",
  "SELECT id,source_id,'48453','SYNTHETIC-PARCEL-003','v1',",
  "  clock_timestamp(),repeat('c',64),",
  "  public.ST_Multi(public.ST_MakeEnvelope(-97.725,30.25,-97.715,30.26,4326))",
  "FROM bdp_parcel_index.ingest_runs WHERE source_id='step40c13-synthetic';",
  "UPDATE bdp_parcel_index.ingest_runs SET received_records=3",
  "WHERE source_id='step40c13-synthetic';",
].join('\n');

function docker(args, { input, timeout = 120_000 } = {}) {
  const p = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout, maxBuffer: 3 * 1024 * 1024,
  });
  if (p.error || p.status !== 0) throw new Error('Disposable Docker command failed: ' +
    (p.error?.message || String(p.stderr || p.stdout || '').trim().slice(-1200)));
  return p.stdout || '';
}

function diagnostic(name) {
  const p = spawnSync('docker', [
    'logs', '--tail', '40', name,
  ], { encoding: 'utf8', timeout: 10_000, maxBuffer: 256 * 1024 });
  return String((p.stderr || '') + (p.stdout || '')).slice(-1800);
}

async function waitForFullPostgisStartup(name) {
  for (let i = 0; i < 60; i++) {
    const state = docker(['inspect', '--format', '{{.State.Status}}', name]).trim();
    if (state !== 'running') throw new Error('Isolated PostGIS container exited early');
    const logs = spawnSync('docker', ['logs', name], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    if (logs.status === 0 &&
      (logs.stderr + logs.stdout).includes(INIT_MARKER)) {
      const ready = spawnSync('docker',
        ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres'],
        { encoding: 'utf8', timeout: 10_000 });
      if (ready.status === 0) return;
    }
    await sleep(1000);
  }
  throw new Error('Isolated PostGIS never completed image initialization');
}

export async function runGeometryDisposableSmoke(args = process.argv.slice(2),
  { loadPg = () => import('pg') } = {}) {
  requireGeometryDisposableOptIn(args);
  let Pool;
  try {
    const module = await loadPg();
    Pool = module?.Pool ?? module?.default?.Pool;
  } catch {
    throw new Error('The real pg driver is not installed; install pg locally first');
  }
  if (typeof Pool !== 'function') throw new Error('Real node-postgres Pool is required');

  const name = 'ldos-geometry-test-' + randomBytes(6).toString('hex');
  const password = randomBytes(32).toString('hex');
  let created = false;
  let pool;
  try {
    docker(['run', '-d', '--name', name, '--network', 'bridge',
      '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=' + password,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=scram-sha-256', DRIVER_SMOKE_IMAGE],
    { timeout: 240_000 });
    created = true;
    await waitForFullPostgisStartup(name);

    const port = parseDisposableLoopbackPort(
      docker(['port', name, '5432/tcp']).trim());
    if (!port) throw new Error('Only random loopback Docker port is allowed');
    const psql = (sql) => docker(['exec', '-i', name, 'psql', '-X', '-v',
      'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: sql });
    const fixtureFile = (file) => readFileSync(
      new URL('../../src/bdp/ingestion/sql/' + file, import.meta.url), 'utf8');

    psql('SELECT PostGIS_Version();\n');
    psql(fixtureFile('parcelIndexFoundation.sql'));
    psql(fixtureFile('parcelRestrictedRpcFoundation.sql'));
    psql(fixtureFile('parcelGeometryPublicationRightsFoundation.sql'));
    psql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    psql(EXTRA_SYNTHETIC_PARCELS_SQL);
    // Default is unreviewed/false, and no real county is approved.
    psql("INSERT INTO bdp_parcel_index.geometry_publication_reviews " +
      "(source_id,county_fips) VALUES ('step40c13-synthetic','48453');");

    pool = new Pool({
      host: '127.0.0.1', port, user: 'postgres', database: 'postgres',
      password, ssl: false, max: 1, connectionTimeoutMillis: 2_000,
      statement_timeout: 3_000, idle_in_transaction_session_timeout: 5_000,
    });
    const { rows: runs } = await pool.query(
      "SELECT id FROM bdp_parcel_index.ingest_runs " +
      "WHERE source_id='step40c13-synthetic'");
    assert.equal(runs.length, 1);
    const runId = Number(runs[0].id);
    assert.ok(Number.isSafeInteger(runId) && runId > 0);
    const plan = parseBoundedParcelPageRequest({
      countyFips: '48453',
      bounds: { west: -97.76, south: 30.24, east: -97.71, north: 30.27 },
      limit: 2,
    });
    const statement = buildParcelGeometrySnapshotStatement({
      plan, trustedSourceId: 'step40c13-synthetic', trustedRunId: runId,
    });
    assert.ok(statement);

    // A usable public CAD URL and caching approval are NOT redistribution.
    let result = await pool.query(statement);
    assert.equal(result.rows.length, 0, 'Unreviewed GIS rights must deny geometry');

    const { rows: privileges } = await pool.query(
      "SELECT has_table_privilege('ldos_parcel_rpc_client'," +
      " 'bdp_parcel_index.geometry_publication_reviews','SELECT') AS raw_review_read");
    assert.equal(privileges[0].raw_review_read, false);

    // The existing restricted RPC role may NOT run the raw geometry SQL,
    // even if an admin explicitly reviews synthetic data in this test.
    const restricted = await pool.connect();
    try {
      await restricted.query('BEGIN');
      await restricted.query('SET LOCAL ROLE ldos_parcel_rpc_client');
      await assert.rejects(restricted.query(statement), /permission denied/i);
    } finally {
      await restricted.query('ROLLBACK');
      restricted.release();
    }

    psql("UPDATE bdp_parcel_index.geometry_publication_reviews SET " +
      "review_state='approved', allow_geometry_redistribution=TRUE, " +
      "review_reference='SYNTHETIC TEST ONLY', " +
      "reviewed_at=clock_timestamp()-interval '1 hour', " +
      "expires_at=clock_timestamp()+interval '2 hours' " +
      "WHERE source_id='step40c13-synthetic';");

    result = await pool.query(statement);
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[0].source_parcel_id, 'SYNTHETIC-PARCEL');
    assert.equal(result.rows[1].source_parcel_id, 'SYNTHETIC-PARCEL-002');
    assert.equal(result.rows[2].geometry, null, 'Overflow sentinel has no polygon');

    const nowMs = Date.now();
    const candidate = stageParcelGeometrySnapshot({
      plan, rows: result.rows, trustedRunId: runId, nowMs,
      trustedSource: {
        sourceId: 'step40c13-synthetic', countyFips: '48453',
        rightsState: 'approved', approvedCachingUntilMs: nowMs + 12 * 3_600_000,
      },
      trustedPublicationRights: {
        sourceId: 'step40c13-synthetic', countyFips: '48453',
        reviewState: 'approved', allowGeometryRedistribution: true,
        reviewReference: 'synthetic/rights-review',
        reviewedAtMs: nowMs - 60_000, expiresAtMs: nowMs + 3_600_000,
      },
    });
    assert.equal(candidate.ok, true, 'Single-query geometry candidate must validate');
    assert.equal(candidate.publishAuthorized, false);
    assert.equal(candidate.viewportCoverage, 'unknown');
    assert.equal(candidate.featureCount, 2);
    assert.equal(candidate.overflow, true);
    assert.ok(!candidate.candidateGeoJson.includes('SYNTHETIC-PARCEL-003'));

    // Wrong county or run ID cannot cross sources even under disposable admin.
    assert.equal((await pool.query({ text: statement.text, values: [
      '48029', ...statement.values.slice(1)] })).rows.length, 0);
    assert.equal((await pool.query({ text: statement.text, values: [
      statement.values[0], statement.values[1], runId + 1,
      ...statement.values.slice(3)] })).rows.length, 0);

    psql("UPDATE bdp_parcel_index.geometry_publication_reviews " +
      "SET review_state='revoked', allow_geometry_redistribution=FALSE " +
      "WHERE source_id='step40c13-synthetic';");
    assert.equal((await pool.query(statement)).rows.length, 0,
      'Publication revocation must deny subsequent geometry reads');

    psql("UPDATE bdp_parcel_index.geometry_publication_reviews " +
      "SET review_state='approved', allow_geometry_redistribution=TRUE " +
      "WHERE source_id='step40c13-synthetic';");
    psql("UPDATE bdp_parcel_index.source_registry SET rights_state='revoked' " +
      "WHERE source_id='step40c13-synthetic';");
    assert.equal((await pool.query(statement)).rows.length, 0,
      'Caching/source revocation must independently deny geometry');

    process.stdout.write(GEOMETRY_SMOKE_SUCCESS + '\n');
  } catch (error) {
    const log = created ? '\nDisposable test log tail:\n' + diagnostic(name) : '';
    const safe = String(error.message + log).replaceAll(password, '[redacted]');
    throw new Error('Disposable geometry smoke failed: ' + safe.slice(0, 2800));
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (created) {
      try { docker(['rm', '--force', '--volumes', name], { timeout: 30_000 }); }
      catch {
        process.stderr.write('WARNING: failed removing disposable geometry container ' +
          name + '\n');
      }
    }
  }
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runGeometryDisposableSmoke().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
