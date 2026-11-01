import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { PARCEL_VIEWPORT_PROBE_SQL } from '../../src/bdp/ingestion/parcelViewportReadPlan.js';

/**
 * MANUAL ONLY: validates the staged schema and actual query in a disposable
 * isolated Docker container. Never connects to or modifies the user's BDP
 * database/volumes; never downloads county GIS data. Requires Docker and an
 * explicit --disposable-only flag. No ports, mounts, or Docker networks.
 */
export const DISPOSABLE_IMAGE = 'postgis/postgis:17-3.5';

export function createSyntheticParcelProbeSmokeSql(query = PARCEL_VIEWPORT_PROBE_SQL) {
  if (typeof query !== 'string' || !query.includes('ST_Intersects(pv.geometry, b.bounds)')
    || query.includes('$ldos_probe$') || query.includes('$ldos_smoke$')) {
    throw new TypeError('Expected bounded PostGIS parcel probe SQL');
  }
  // All geometry is invented inside the test transaction. The test never
  // changes the staged schema, and the synthetic rows always ROLLBACK.
  return `BEGIN;
DO $ldos_smoke$
DECLARE
  v_run BIGINT;
  v_count INTEGER;
  v_probe TEXT := $ldos_probe$SELECT count(*) FROM (
${query}
) AS matching_parcels$ldos_probe$;
BEGIN
  INSERT INTO bdp_parcel_index.source_registry
    (source_id, county_fips, source_url, attribution, rights_state,
     rights_review_reference, rights_reviewed_at, approved_caching_until)
  VALUES ('step40c3-smoke', '48453', 'https://example.invalid/fixture',
    'Synthetic test only; not a real parcel source', 'approved',
    'LOCAL DISPOSABLE TEST ONLY', clock_timestamp() - interval '1 day',
    clock_timestamp() + interval '1 day');

  INSERT INTO bdp_parcel_index.ingest_runs
    (source_id, source_version, outcome, finished_at, source_requests,
     received_records, omitted_unidentified, source_reported_truncated,
     observed_envelope)
  VALUES ('step40c3-smoke', 'fake-v1', 'complete', clock_timestamp(),
    1, 2, 0, FALSE, ST_MakeEnvelope(-98, 30, -97, 31, 4326))
  RETURNING id INTO v_run;

  INSERT INTO bdp_parcel_index.parcel_versions
    (ingest_run_id, source_id, county_fips, source_parcel_id, source_version,
     received_at, source_geometry_sha256, geometry)
  VALUES
    (v_run, 'step40c3-smoke', '48453', 'TEST-IN-VIEW', 'fake-v1',
     clock_timestamp(), repeat('a',64), ST_Multi(ST_MakeEnvelope(-97.75,30.25,-97.74,30.26,4326))),
    (v_run, 'step40c3-smoke', '48453', 'TEST-OUTSIDE', 'fake-v1',
     clock_timestamp(), repeat('b',64), ST_Multi(ST_MakeEnvelope(-98.10,30.50,-98.09,30.51,4326)));

  EXECUTE v_probe INTO v_count USING
    '48453'::char(5), 'step40c3-smoke'::text, v_run,
    -97.8::double precision, 30.2::double precision,
    -97.7::double precision, 30.3::double precision, 201::integer;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected exactly one spatially intersecting synthetic parcel; got %', v_count;
  END IF;

  UPDATE bdp_parcel_index.source_registry SET rights_state = 'revoked'
    WHERE source_id = 'step40c3-smoke';
  EXECUTE v_probe INTO v_count USING
    '48453'::char(5), 'step40c3-smoke'::text, v_run,
    -97.8::double precision, 30.2::double precision,
    -97.7::double precision, 30.3::double precision, 201::integer;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: revoked source remained readable';
  END IF;

  UPDATE bdp_parcel_index.source_registry
    SET rights_state = 'approved',
        approved_caching_until = clock_timestamp() - interval '1 second'
    WHERE source_id = 'step40c3-smoke';
  EXECUTE v_probe INTO v_count USING
    '48453'::char(5), 'step40c3-smoke'::text, v_run,
    -97.8::double precision, 30.2::double precision,
    -97.7::double precision, 30.3::double precision, 201::integer;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: expired source remained readable';
  END IF;
  RAISE NOTICE 'PASS: bounded PostGIS probe, synthetic spatial match, revocation and expiry';
END;
$ldos_smoke$;
ROLLBACK;
`;
}

function docker(args, { input = undefined, timeout = 120_000, quiet = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input,
    timeout, maxBuffer: 3 * 1024 * 1024 });
  if (result.error) throw new Error(`Docker command failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Docker exited ${result.status}: ${(result.stderr || result.stdout || '').trim().slice(-1200)}`);
  }
  if (!quiet && result.stdout?.trim()) process.stdout.write(result.stdout);
  return result.stdout || '';
}

export async function runDisposableParcelSmoke(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing to run without explicit --disposable-only. No existing DB is ever used.');
  }
  const container = `ldos-parcel-smoke-${randomBytes(6).toString('hex')}`;
  const sql = (name) => readFileSync(new URL(`../../src/bdp/ingestion/sql/${name}`, import.meta.url), 'utf8');
  let created = false;
  try {
    docker(['run', '-d', '--rm', '--network', 'none', '--name', container,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', DISPOSABLE_IMAGE],
    { timeout: 240_000, quiet: true });
    created = true;
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const probe = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'postgres'],
        { encoding: 'utf8', timeout: 10_000 });
      if (probe.status === 0) { ready = true; break; }
      await sleep(1000);
    }
    if (!ready) throw new Error('Disposable PostGIS container never became ready');
    const psql = (text) => docker(['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
      '-U', 'postgres', '-d', 'postgres'], { input: text });
    psql('CREATE EXTENSION IF NOT EXISTS postgis;\n');
    psql(sql('parcelIndexFoundation.sql'));
    psql(sql('parcelIndexFoundationSmoke.sql'));
    psql(createSyntheticParcelProbeSmokeSql());
    process.stdout.write('PASS: disposable PostGIS migration, rollback smoke, and runtime viewport probe.\n');
  } finally {
    if (created) {
      try { docker(['stop', '--time', '2', container], { timeout: 30_000, quiet: true }); }
      catch (err) { process.stderr.write(`WARNING: unable to stop disposable container ${container}: ${err.message}\n`); }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runDisposableParcelSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
