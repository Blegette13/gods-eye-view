import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createParcelPgPoolConnector } from '../../server/providers/bdp-parcel-pg-pool.js';
import { createParcelMetadataRuntime } from '../../server/providers/bdp-parcel-metadata-runtime.js';

/**
 * Step 40C-13 - MANUAL, DISPOSABLE ONLY.
 *
 * Runs the actual node-postgres Pool against a brand-new synthetic PostGIS
 * database with a separate, minimally privileged LOGIN. It NEVER connects to
 * the project's existing bdp-postgis, an external DB, or a user-provided URI.
 * Only Docker's randomly assigned port bound to 127.0.0.1 is exposed locally.
 * No mounts, named volumes, real county GIS data, or web service are used.
 *
 * Requires Docker Desktop and separately installed "pg" on the host.
 * Refuses to start unless invoked with exactly "--disposable-only".
 */
export const DRIVER_SMOKE_IMAGE = 'postgis/postgis:17-3.5';
const INIT_MARKER = 'PostgreSQL init process complete; ready for start up.';
const ROLE = 'ldos_parcel_service';

export function parseDisposableLoopbackPort(output) {
  if (typeof output !== 'string') return null;
  const match = output.trim().match(/^127\.0\.0\.1:(\d{1,5})$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 && value < 65536 ? value : null;
}

export function syntheticServiceRoleSql(password) {
  if (typeof password !== 'string' || !/^[a-f0-9]{64}$/.test(password)) {
    throw new TypeError('A generated synthetic 32-byte hex test password is required');
  }
  // This only runs inside the new temporary container and its default DB.
  return \`CREATE ROLE \${ROLE} LOGIN NOINHERIT NOSUPERUSER
    NOCREATEDB NOCREATEROLE NOREPLICATION
    PASSWORD '\${password}';
GRANT CONNECT ON DATABASE postgres TO \${ROLE};
GRANT USAGE ON SCHEMA bdp_parcel_index TO \${ROLE};
GRANT EXECUTE ON FUNCTION bdp_parcel_index.approved_sources_rpc(text)
  TO \${ROLE};
GRANT EXECUTE ON FUNCTION bdp_parcel_index.parcel_viewport_probe_rpc(
  text,text,bigint,double precision,double precision,double precision,
  double precision,integer
) TO \${ROLE};\`;
}

export const SYNTHETIC_DRIVER_FIXTURE_SQL = \`
INSERT INTO bdp_parcel_index.source_registry
  (source_id,county_fips,source_url,attribution,rights_state,
   rights_review_reference,rights_reviewed_at,approved_caching_until)
VALUES ('step40c13-synthetic','48453','https://example.invalid/fixture',
  'Synthetic test, not licensed GIS data','approved','DISPOSABLE ONLY',
  clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day');

INSERT INTO bdp_parcel_index.ingest_runs
  (source_id,source_version,outcome,finished_at,received_records,
   omitted_unidentified,source_reported_truncated,observed_envelope)
VALUES ('step40c13-synthetic','v1','complete',clock_timestamp(),
  1,0,FALSE,public.ST_MakeEnvelope(-97.8,30.2,-97.7,30.3,4326));

INSERT INTO bdp_parcel_index.parcel_versions
  (ingest_run_id,source_id,county_fips,source_parcel_id,source_version,
   received_at,source_geometry_sha256,geometry)
SELECT id,source_id,'48453','SYNTHETIC-PARCEL','v1',
  clock_timestamp(),repeat('a',64),
  public.ST_Multi(public.ST_MakeEnvelope(-97.75,30.25,-97.74,30.26,4326))
FROM bdp_parcel_index.ingest_runs
WHERE source_id='step40c13-synthetic';\`;

function docker(args, { input, quiet = true, timeout = 120_000 } = {}) {
  const proc = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout, maxBuffer: 3 * 1024 * 1024,
  });
  if (proc.error || proc.status !== 0) {
    throw new Error('Disposable Docker command failed: ' +
      (proc.error?.message ?? String(proc.stderr || proc.stdout || '').trim().slice(-1500)));
  }
  if (!quiet && proc.stdout) process.stdout.write(proc.stdout);
  return proc.stdout || '';
}

function captureDiagnostics(name) {
  const inspect = spawnSync('docker', [
    'inspect','--format','status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}',name,
  ], { encoding:'utf8', timeout: 10_000, maxBuffer: 128 * 1024 });
  const logs = spawnSync('docker',['logs','--tail','50',name],{
    encoding:'utf8',timeout: 10_000,maxBuffer: 256 * 1024,
  });
  return (inspect.stdout || 'No container state') + '\n' +
    String((logs.stderr || '') + (logs.stdout || '')).slice(-2800);
}

async function waitForImageInitialization(name) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = docker(['inspect','--format','{{.State.Status}}',name]).trim();
    if (state !== 'running') throw new Error('Disposable PostGIS exited during startup');
    const startup = docker(['logs',name],{ timeout: 15_000 });
    // docker logs often writes to stderr, not stdout; use combined streams below.
    const logProc = spawnSync('docker',['logs',name],{
      encoding:'utf8',timeout: 15_000,maxBuffer: 1 * 1024 * 1024,
    });
    if (logProc.status === 0 && (logProc.stderr + logProc.stdout).includes(INIT_MARKER)) {
      const ready = spawnSync('docker',
        ['exec',name,'pg_isready','-U','postgres','-d','postgres'],
        {encoding:'utf8', timeout:10_000});
      if (ready.status === 0) return;
    }
    void startup;
    await sleep(1000);
  }
  throw new Error('Disposable PostGIS did not complete initialization');
}

async function verifyRealDriver(Pool, port, password) {
  const connector = createParcelPgPoolConnector({
    Pool,
    settings: { host: '127.0.0.1', port, database:'postgres',
      user: ROLE, password, ssl:false },
  });
  const key = randomBytes(48);
  const handle = randomBytes(32).toString('base64url');
  const digest = createHmac('sha256',key).update(handle).digest('hex');
  const now = Date.now();
  let sessionChecks = 0;
  let revoked = false;
  let sourceRevoked = false;
  const runtime = createParcelMetadataRuntime({
    connect: connector.connect,
    sessionHmacKey: key,
    now: () => now,
    findSessionByDigest: async (lookup) => {
      sessionChecks++;
      if (lookup !== digest) return null;
      return {
        sessionDigest:digest,subject:'fixture-operator',accountStatus:'active',
        mfaVerified:true,revokedAtMs:revoked ? now : null,
        issuedAtMs:now - 10_000,lastSeenAtMs:now - 1_000,
        expiresAtMs:now + 30 * 60 * 1000,
        countyGrants:[{countyFips:'48453',allowParcelDiscovery:true}],
      };
    },
  });
  const request = {
    countyFips:'48453',
    bounds:{west:-97.76,south:30.24,east:-97.73,north:30.27},
    limit:10,
  };
  try {
    const successful = await runtime.readViewportMetadata({ sessionHandle:handle,request });
    assert.deepEqual(successful,{
      status:'ok',parcelCount:1,overflow:false,
      viewportCoverage:'unknown',geometryDelivered:false,
    });
    assert.equal(sessionChecks,2);

    // This must fail for an actual restricted LOGIN, not just a mock.
    const client = await connector.connect();
    try {
      await assert.rejects(client.query(
        'SELECT source_parcel_id FROM bdp_parcel_index.parcel_versions LIMIT 1',
      ), /permission denied/i);
    } finally { client.release(new Error('Expected denied raw parcel SELECT')); }

    // A fake browser token cannot drive even an authenticated lookup.
    const forged = await runtime.readViewportMetadata({
      sessionHandle:'untrusted-browser-claim',request,
    });
    assert.deepEqual(forged,{status:'denied',viewportCoverage:'unknown'});

    revoked = true;
    const denied = await runtime.readViewportMetadata({sessionHandle:handle,request});
    assert.deepEqual(denied,{status:'denied',viewportCoverage:'unknown'});

    revoked = false;
    // The admin fixture will be revoked below; new queries must then deny.
    sourceRevoked = true;
    return { ready: true, request, runtime, handle, connector,
      assertDeniedAfterSourceRevocation: async () => {
        assert.equal(sourceRevoked,true);
        const answer = await runtime.readViewportMetadata({ sessionHandle:handle,request });
        assert.deepEqual(answer,{status:'denied',viewportCoverage:'unknown'});
      } };
  } catch (error) {
    await connector.close();
    throw error;
  }
}

export async function runParcelPgDriverSmoke(args = process.argv.slice(2), {
  loadPg = () => import('pg'),
} = {}) {
  if (args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing to connect without --disposable-only');
  }
  // Require the real pg dependency before provisioning an isolated database.
  let Pool;
  try { ({ Pool } = await loadPg()); } catch {
    throw new Error('The real pg driver is not installed. Install pg locally before running this opt-in test.');
  }
  if (typeof Pool !== 'function') throw new Error('Expected node-postgres Pool constructor');

  const name = 'ldos-pg-driver-smoke-' + randomBytes(6).toString('hex');
  const adminPassword = randomBytes(32).toString('hex');
  const rolePassword = randomBytes(32).toString('hex');
  let created = false;
  let session;
  try {
    docker(['run','-d','--name',name,'--network','bridge',
      '-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD='+adminPassword,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',DRIVER_SMOKE_IMAGE],
      {timeout:240_000});
    created = true;
    await waitForImageInitialization(name);
    const portText = docker(['port',name,'5432/tcp']).trim();
    const port = parseDisposableLoopbackPort(portText);
    if (!port) throw new Error('Refusing non-loopback or ambiguous disposable database port');
    const psql = (sql) => docker([
      'exec','-i',name,'psql','-X','-v','ON_ERROR_STOP=1',
      '-U','postgres','-d','postgres'],{input:sql,quiet:true});
    const sqlFile = (file) => readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+file,import.meta.url),'utf8');
    psql('SELECT PostGIS_Version();\n');
    psql(sqlFile('parcelIndexFoundation.sql'));
    psql(sqlFile('parcelRestrictedRpcFoundation.sql'));
    psql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    psql(syntheticServiceRoleSql(rolePassword));

    session = await verifyRealDriver(Pool,port,rolePassword);
    psql("UPDATE bdp_parcel_index.source_registry SET rights_state='revoked' "+
      "WHERE source_id='step40c13-synthetic';");
    await session.assertDeniedAfterSourceRevocation();
    process.stdout.write(
      'PASS: disposable real pg Pool, restricted LOGIN, HMAC metadata and revocation.\n',
    );
  } catch(error) {
    // Never print generated DB passwords or session keys.
    const details = created ? '\nDisposable Docker status/logs:\n'+captureDiagnostics(name) : '';
    throw new Error('Real pg driver smoke failed: '+String(error.message).slice(0,800)+details);
  } finally {
    if (session) await session.connector.close().catch(() => {});
    if (created) {
      try { docker(['rm','--force','--volumes',name],{timeout:30_000}); }
      catch { process.stderr.write('WARNING: could not remove disposable driver test container '+name+'\n'); }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runParcelPgDriverSmoke().catch((err) => {
    process.stderr.write(err.message+'\n');
    process.exitCode=1;
  });
}
