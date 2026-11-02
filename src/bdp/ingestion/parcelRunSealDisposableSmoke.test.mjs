import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  requireRunSealDisposableOptIn,
  runParcelRunSealDisposableSmoke,
  RUN_SEAL_SMOKE_SUCCESS,
} from '../../../scripts/bdp/parcel-run-seal-disposable-smoke.mjs';

const file = readFileSync(new URL(
  '../../../scripts/bdp/parcel-run-seal-disposable-smoke.mjs', import.meta.url), 'utf8');

test('only exact disposable-only flag permits actual PostGIS run-seal test', () => {
  assert.equal(requireRunSealDisposableOptIn(['--disposable-only']), true);
  for (const args of [[], null, ['--live'], ['--reusedb'],
    ['--disposable-only','--host=production'],
    ['--disposable-only','--disposable-only']]) {
    assert.throws(() => requireRunSealDisposableOptIn(args), /Refusing parcel run seal/);
  }
});

test('invalid opt-in fails before Docker command invocation', async () => {
  await assert.rejects(runParcelRunSealDisposableSmoke(['--live']),
    /Refusing parcel run seal/);
});

test('synthetic Docker isolation has no network, host ports, bind mounts or trust auth', () => {
  const args = file.match(/docker\(\['run',[\s\S]*?DRIVER_SMOKE_IMAGE\]/)?.[0];
  assert.ok(args, 'Must start a disposable database');
  assert.match(args, /'--network', 'none'/);
  assert.match(args, /'POSTGRES_HOST_AUTH_METHOD=scram-sha-256'/);
  assert.doesNotMatch(args, /'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.match(file, /randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(file, /docker\(\['rm', '--force', '--volumes', name\]/);
  assert.match(file, /PostgreSQL init process complete; ready for start up/);
});

test('test uses only invented parcels and an existing synthetic source', () => {
  assert.match(file, /SYNTHETIC_DRIVER_FIXTURE_SQL/);
  assert.match(file, /EXTRA_SYNTHETIC_PARCELS_SQL/);
  assert.match(file, /step40c13-synthetic/);
  assert.match(file, /synthetic-window/);
  assert.match(file, /parcelIndexFoundation\.sql/);
  assert.match(file, /parcelRunSealFoundation\.sql/);
  assert.doesNotMatch(file, /connectionString|bdp-postgis|createServer\(|\.listen\(|new Pool\(/);
});

test('before sealing incomplete/mismatched counts/source/version are all denied', () => {
  for (const expected of [
    "Cannot seal missing, incomplete or mismatched parcel run",
    "Run seal indexed count differs from completed run",
    "incomplete-only",
    "wrong-version",
    "other-source",
    "indexed_records",
  ]) assert.ok(file.includes(expected), expected);
  assert.match(file, /assert\.equal\(runSql\('SELECT count\(\*\) FROM bdp_parcel_index\.parcel_versions/);
});

test('successful completed run checks indexed count and server-created timestamp', () => {
  assert.match(file, /runSql\(seal\(runId, SOURCE, 'v1', 3\)\)/);
  assert.match(file, /SELECT indexed_records FROM/);
  assert.match(file, /sealed_at BETWEEN now\(\)/);
  assert.match(file, /SELECT count\(\*\) FROM/);
});

test('sealed parcel records, coverage windows, run and seal metadata reject mutation', () => {
  for (const expected of [
    'Sealed parcel run is immutable',
    'Cannot add or move records into a sealed parcel run',
    'Run seal cannot be changed',
    'DELETE FROM ',
    'SET source_feature_id',
    'SET window_key',
    'SET source_notes',
    'SET indexed_records=2',
    'duplicate key value violates unique constraint',
  ]) assert.ok(file.includes(expected), expected);
  assert.match(file, /assert\.equal\(runSql\("SELECT outcome FROM "/);
});

test('runner is test-only and cannot authorize any real GIS delivery', () => {
  assert.match(RUN_SEAL_SMOKE_SUCCESS,
    /^PASS: disposable PostGIS immutable run seals/);
  assert.match(file, /--disposable-only/);
  assert.match(file, /BEGIN|runSql/);
  assert.match(file, /replaceAll\(password, '\[redacted\]'\)/);
  assert.doesNotMatch(file, /GRANT EXECUTE|source_registry SET rights_state='approved'/);
});
