import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KEYSET_SMOKE_SUCCESS,
  KEYSET_PROBE_ROLE, KEYSET_RPC_SIGNATURE, SNAPSHOT_RPC_SIGNATURE,
  requireKeysetSmokeOptIn, runKeysetDisposableSmoke,
} from '../../../scripts/bdp/parcel-keyset-disposable-smoke.mjs';

const file = readFileSync(new URL(
  '../../../scripts/bdp/parcel-keyset-disposable-smoke.mjs', import.meta.url), 'utf8');

test('only exact disposable-only flag enables real PostGIS keyset smoke', () => {
  assert.equal(requireKeysetSmokeOptIn(['--disposable-only']), true);
  for (const args of [
    [], null, ['--host=production'], ['--disposable-only','--reuse'],
    ['--disposable-only','--disposable-only'], ['--run-again'],
  ]) assert.throws(() => requireKeysetSmokeOptIn(args), /Refusing keyset smoke/);
});

test('refused execution fails before Docker is touched', async () => {
  await assert.rejects(runKeysetDisposableSmoke(['--live']), /Refusing keyset smoke/);
});

test('Docker uses a fresh network-isolated container with no ports, mounts or trust auth', () => {
  const dockerRun = file.match(/docker\(\['run',[\s\S]*?DRIVER_SMOKE_IMAGE\]/)?.[0];
  assert.ok(dockerRun);
  assert.match(dockerRun, /'--network', 'none'/);
  assert.match(dockerRun, /'POSTGRES_HOST_AUTH_METHOD=scram-sha-256'/);
  assert.doesNotMatch(dockerRun,
    /'--(?:network', 'host|mount|volume|volumes|privileged|publish|publish-all)'|'-p'|'-P'/);
  assert.match(file, /randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(file, /PostgreSQL init process complete; ready for start up/);
  assert.match(file, /docker\(\['rm', '--force', '--volumes', name\]/);
});

test('only synthetic GIS fixture and dedicated draft SQL functions are loaded', () => {
  for (const expected of [
    'parcelIndexFoundation.sql',
    'parcelRestrictedRpcFoundation.sql',
    'parcelGeometryPublicationRightsFoundation.sql',
    'parcelGeometryRestrictedRpcFoundation.sql',
    'parcelGeometryKeysetRpcFoundation.sql',
    'parcelRunSealFoundation.sql',
    'SYNTHETIC_DRIVER_FIXTURE_SQL',
    'EXTRA_SYNTHETIC_PARCELS_SQL',
  ]) assert.ok(file.includes(expected), expected);
  assert.doesNotMatch(file, /connectionString|bdp-postgis|createServer\(|\.listen\(/);
  assert.match(file, /step40c13-synthetic/);
  assert.match(file, /INSERT INTO bdp_parcel_index\.geometry_publication_reviews/);
});

test('keyset requires an immutable, completed synthetic run despite approved publication', () => {
  assert.match(file, /Approved publication without an immutable run seal must return no geometry/);
  assert.match(file, /INSERT INTO bdp_parcel_index\.parcel_run_seals/);
  assert.match(file, /WHERE source_id='.*source_version='v1'/);
  assert.match(file, /indexed_records/);
  assert.ok(file.indexOf("apply(file('parcelRunSealFoundation.sql'))")
    < file.indexOf("apply(file('parcelGeometryKeysetRpcFoundation.sql'))"));
  assert.ok(file.indexOf('Approved publication without an immutable run seal')
    < file.indexOf('INSERT INTO bdp_parcel_index.parcel_run_seals'));
});

test('metadata-only role and fresh ungranted geometry role cannot execute keyset', () => {
  assert.equal(KEYSET_PROBE_ROLE, 'ldos_geometry_keyset_probe');
  assert.match(KEYSET_RPC_SIGNATURE, /parcel_geometry_keyset_rpc\(/);
  assert.match(SNAPSHOT_RPC_SIGNATURE, /parcel_geometry_snapshot_rpc\(/);
  assert.match(file, /has_function_privilege\('ldos_parcel_rpc_client'/);
  assert.match(file, /NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.match(file, /With schema USAGE but no EXECUTE/);
  assert.match(file, /GRANT EXECUTE ON FUNCTION/);
  assert.match(file, /has_table_privilege/);
  assert.match(file, /parcel_geometry_snapshot_rpc/);
});

test('actual smoke verifies ordered three-page cursor progression and null overflow', () => {
  for (const phrase of [
    'Initial page is read under test-container superuser ONLY',
    'Fetch after last ACCEPTED parcel, not after the extra sentinel',
    'SYNTHETIC-PARCEL-002',
    'SYNTHETIC-PARCEL-003',
    'No duplicate accepted parcels',
    'assert.deepEqual(output(query(third[0].id, third[0].version)), [])',
    'Publication revocation must prevent next-page delivery',
    'Independent source-caching revocation must prevent next-page delivery',
  ]) assert.ok(file.includes(phrase), phrase);
  assert.match(file, /county: '48029'/);
  assert.match(file, /run: 999/);
  assert.match(file, /source: 'other-source'/);
  assert.match(KEYSET_SMOKE_SUCCESS, /^PASS: disposable PostGIS keyset paging/);
});

test('all successful keyset reads are private SQL, not authorized browser output', () => {
  assert.doesNotMatch(file, /fetch\(|new Pool\(|createServer\(|\.listen\(/);
  assert.match(file, /BEGIN READ ONLY/);
  assert.match(file, /SET LOCAL ROLE/);
  assert.match(file, /replaceAll\(password, '\[redacted\]'\)/);
  assert.match(file, /pg_isready/);
  assert.match(file, /--disposable-only/);
});
