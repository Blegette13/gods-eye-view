import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GEOMETRY_SMOKE_SUCCESS,
  EXTRA_SYNTHETIC_PARCELS_SQL,
  requireGeometryDisposableOptIn,
  runGeometryDisposableSmoke,
} from '../../../scripts/bdp/parcel-geometry-disposable-smoke.mjs';

test('refuses any real geometry smoke invocation without explicit disposable-only flag', () => {
  assert.equal(requireGeometryDisposableOptIn(['--disposable-only']), true);
  for (const options of [
    [], ['--production'], ['--disposable-only', '--db=existing'],
    ['--host=localhost'], ['--disposable-only', '--reuse-volume'],
  ]) assert.throws(() => requireGeometryDisposableOptIn(options), /Refusing/);
});

test('missing node-postgres package reports failure without ever starting Docker', async () => {
  await assert.rejects(runGeometryDisposableSmoke(['--disposable-only'], {
    loadPg: async () => { throw new Error('MODULE_NOT_FOUND'); },
  }), /real pg driver is not installed/);
  await assert.rejects(runGeometryDisposableSmoke([], {
    loadPg: async () => { throw new Error('should not load'); },
  }), /Refusing geometry smoke/);
});

test('synthetic fixture uses only invalid example URL, no real county data import', () => {
  const code = readFileSync(new URL('../../../scripts/bdp/parcel-pg-driver-disposable-smoke.mjs',
    import.meta.url), 'utf8');
  assert.match(code, /example\.invalid\/fixture/);
  assert.match(EXTRA_SYNTHETIC_PARCELS_SQL, /SYNTHETIC-PARCEL-002/);
  assert.match(EXTRA_SYNTHETIC_PARCELS_SQL, /SYNTHETIC-PARCEL-003/);
  assert.match(EXTRA_SYNTHETIC_PARCELS_SQL, /received_records=3/);
  assert.doesNotMatch(EXTRA_SYNTHETIC_PARCELS_SQL, /\bCOPY\s|https:\/\//);
});

test('temporary database is loopback only with no data volume, network host, or trust auth', () => {
  const code = readFileSync(new URL('../../../scripts/bdp/parcel-geometry-disposable-smoke.mjs',
    import.meta.url), 'utf8');
  const dockerRun = code.match(/docker\(\['run',[\s\S]*?DRIVER_SMOKE_IMAGE\]/)?.[0];
  assert.ok(dockerRun);
  assert.match(dockerRun, /'-p', '127\.0\.0\.1::5432'/);
  assert.match(dockerRun, /'--network', 'bridge'/);
  assert.doesNotMatch(dockerRun, /'--mount'|'--volume'|'--volumes'|'--privileged'|'-P'|POSTGRES_HOST_AUTH_METHOD=trust/);
  assert.match(code, /\['rm', '--force', '--volumes', name\]/);
  assert.match(code, /PostgreSQL init process complete; ready for start up/);
  assert.match(code, /parcelGeometryPublicationRightsFoundation\.sql/);
  assert.match(code, /parcelRestrictedRpcFoundation\.sql/);
});

test('runtime tests both rights gates plus rejects raw access from existing NOLOGIN role', () => {
  const code = readFileSync(new URL('../../../scripts/bdp/parcel-geometry-disposable-smoke.mjs',
    import.meta.url), 'utf8');
  assert.match(code, /SET LOCAL ROLE ldos_parcel_rpc_client/);
  assert.match(code, /Unreviewed GIS rights must deny geometry/);
  assert.match(code, /Publication revocation must deny subsequent geometry reads/);
  assert.match(code, /Caching\/source revocation must independently deny geometry/);
  assert.match(code, /Overflow sentinel has no polygon/);
  assert.match(code, /candidate\.publishAuthorized, false/);
  assert.match(code, /candidate\.viewportCoverage, 'unknown'/);
  assert.match(code, /await pool\.query\(statement\)/);
  assert.match(GEOMETRY_SMOKE_SUCCESS, /disposable PostGIS geometry rights/);
});

test('runner never exposes an HTTP endpoint or touches the existing project database', () => {
  const code = readFileSync(new URL('../../../scripts/bdp/parcel-geometry-disposable-smoke.mjs',
    import.meta.url), 'utf8');
  assert.doesNotMatch(code, /createServer\(|\.listen\(|bdp-postgis|connectionString/);
  assert.match(code, /docker\(\['run'/);
  assert.match(code, /pool\.end\(\)/);
  assert.match(code, /password = randomBytes\(32\)/);
  assert.match(code, /replaceAll\(password, '\[redacted\]'\)/);
});
