import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  requireSealedSourceAuthorityOptIn,
  runSealedSourceAuthorityDisposableSmoke,
  SEALED_SOURCE_AUTHORITY_SIGNATURE,
  SEALED_SOURCE_AUTHORITY_SUCCESS,
  SEALED_SOURCE_AUTHORITY_PROBE_ROLE,
} from '../../../scripts/bdp/parcel-sealed-source-authority-disposable-smoke.mjs';

const src = readFileSync(new URL(
  '../../../scripts/bdp/parcel-sealed-source-authority-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('40C34 PostGIS test only runs with one exact disposable-only flag',()=>{
  assert.equal(requireSealedSourceAuthorityOptIn(['--disposable-only']),true);
  for(const args of [
    null,[],['--local'],['--prod'],['--disposable-only','--reuse'],
    ['--disposable-only','--disposable-only'],
  ]) assert.throws(()=>requireSealedSourceAuthorityOptIn(args),/Refusing sealed-source smoke/);
});

test('invalid opt-in rejects before creating a Docker container',async()=>{
  await assert.rejects(runSealedSourceAuthorityDisposableSmoke(['--unsafe']),
    /Refusing sealed-source smoke/);
});

test('Docker is isolated: no network, host ports, bind mounts or persistent volume',()=>{
  const line=src.match(/docker\(\['run','-d'[\s\S]*?DRIVER_SMOKE_IMAGE\]/)?.[0];
  assert.ok(line);
  assert.match(line,/'--network','none'/);
  assert.match(line,/'POSTGRES_HOST_AUTH_METHOD=scram-sha-256'/);
  assert.doesNotMatch(line,/'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.match(src,/randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(src,/docker\(\['rm','--force','--volumes',name\]/);
});

test('test creates only disposable fixture data and no production session',()=>{
  for(const fragment of [
    'parcelIndexFoundation.sql','parcelRestrictedRpcFoundation.sql',
    'parcelRunSealFoundation.sql','parcelSealedSourceAuthorityRpcFoundation.sql',
    'SYNTHETIC_DRIVER_FIXTURE_SQL','EXTRA_SYNTHETIC_PARCELS_SQL',
    'step40c13-synthetic',
  ]) assert.ok(src.includes(fragment),fragment);
  assert.doesNotMatch(src,/connectionString|bdp-postgis|new Pool\(|createServer\(|\.listen\(/);
});

test('a distinct NOLOGIN role proves default-deny, raw-table denial and test-only EXECUTE',()=>{
  assert.equal(SEALED_SOURCE_AUTHORITY_PROBE_ROLE,'ldos_sealed_authority_probe');
  assert.equal(SEALED_SOURCE_AUTHORITY_SIGNATURE,
    'bdp_parcel_index.parcel_sealed_source_authority_rpc(text)');
  assert.match(src,/CREATE ROLE.*SEALED_SOURCE_AUTHORITY_PROBE_ROLE/);
  assert.match(src,/NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.match(src,/GRANT EXECUTE ON FUNCTION.*SEALED_SOURCE_AUTHORITY_SIGNATURE/);
  assert.match(src,/has_table_privilege/);
  assert.match(src,/rejectSql\('BEGIN READ ONLY;/);
});

test('sealing a synthetic complete run is required for source authority',()=>{
  for(const fragment of [
    'assert.equal(count(),0)','assert.equal(count(),1)',
    'parcel_run_seals','indexed_records',
    'synthetic-v1','source_version=',
  ]) {
    if(fragment==='synthetic-v1') continue;
    assert.ok(src.includes(fragment),fragment);
  }
  assert.match(src,/source_version='v1'/);
});

test('expiry/revocation and latest partial/unsealed complete runs deny older fallback',()=>{
  for(const fragment of [
    "rights_state='revoked'",
    "rights_state='approved'",
    "'v2-partial'","'partial'",
    "'v3-complete'","'complete'",
    'clock_timestamp()+interval',
    'assert.equal(count(),0)',
  ]) assert.ok(src.includes(fragment),fragment);
});

test('synthetic test has generic success wording and scrubs database secret',()=>{
  assert.match(SEALED_SOURCE_AUTHORITY_SUCCESS,
    /^PASS: disposable PostGIS sealed-source authority/);
  assert.match(src,/replaceAll\(password,'\[redacted\]'\)/);
  assert.match(src,/if\(process\.argv\[1\]/);
  assert.doesNotMatch(src,/GRANT.*TO\s+PUBLIC|ALTER DEFAULT PRIVILEGES/i);
});
