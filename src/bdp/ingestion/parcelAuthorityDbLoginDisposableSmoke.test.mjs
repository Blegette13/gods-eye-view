import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTHORITY_DB_LOGIN, AUTHORITY_DB_LOGIN_SUCCESS,
  requireAuthorityDbLoginDisposableOptIn,
  runAuthorityDbLoginDisposableSmoke,
} from '../../../scripts/bdp/parcel-authority-login-disposable-smoke.mjs';

const code=readFileSync(new URL(
  '../../../scripts/bdp/parcel-authority-login-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('40C35 requires exactly one disposable-only flag',()=>{
  assert.equal(requireAuthorityDbLoginDisposableOptIn(['--disposable-only']),true);
  for(const a of [
    null,[],['--local'],['--production'],['--disposable-only','--reuse'],
    ['--disposable-only','--disposable-only'],
  ]) assert.throws(()=>requireAuthorityDbLoginDisposableOptIn(a),
    /Refusing authority-login smoke/);
});

test('invalid arguments cannot initiate Docker operations',async()=>{
  await assert.rejects(runAuthorityDbLoginDisposableSmoke(['--live']),
    /Refusing authority-login smoke/);
});

test('Docker is one-use, non-networked, portless, unmounted, with cleanup',()=>{
  assert.match(code,/docker\(\['run','-d','--name',name,'--network','none'/);
  assert.match(code,/'POSTGRES_HOST_AUTH_METHOD=scram-sha-256'/);
  assert.doesNotMatch(code,/'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.match(code,/docker\(\['rm','--force','--volumes',name\]/);
  assert.match(code,/randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(code,/replaceAll\(postgresPassword,'\[redacted\]'\)/);
  assert.match(code,/replaceAll\(loginPassword,'\[redacted\]'\)/);
});

test('only existing synthetic fixture and staged sealed-source SQL are loaded',()=>{
  for(const phrase of [
    'parcelIndexFoundation.sql',
    'parcelRestrictedRpcFoundation.sql',
    'parcelRunSealFoundation.sql',
    'parcelSealedSourceAuthorityRpcFoundation.sql',
    'SYNTHETIC_DRIVER_FIXTURE_SQL',
    'EXTRA_SYNTHETIC_PARCELS_SQL',
    'step40c13-synthetic',
  ]) assert.ok(code.includes(phrase),phrase);
  assert.doesNotMatch(code,/connectionString|bdp-postgis|new Pool\(|\.listen\(/);
});

test('test connects as an actual separate password-login, not SET ROLE',()=>{
  assert.equal(AUTHORITY_DB_LOGIN,'ldos_parcel_authority_test');
  assert.match(code,/CREATE ROLE.*AUTHORITY_DB_LOGIN/);
  assert.match(code,/LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.match(code,/NOREPLICATION NOBYPASSRLS PASSWORD/);
  assert.match(code,/'-h','127\.0\.0\.1','-U',AUTHORITY_DB_LOGIN/);
  assert.match(code,/'PGPASSWORD='\+loginPassword/);
  assert.doesNotMatch(code,/SET LOCAL ROLE|SET SESSION AUTHORIZATION/);
});

test('identity attestation is parameter bound and checks nine booleans',()=>{
  assert.match(code,/PREPARE ldos_authority_attest\(text\)/);
  assert.match(code,/SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL/);
  assert.match(code,/no_role_memberships/);
  assert.match(code,/no_index_table_access/);
  assert.match(code,/no_other_index_rpc/);
  assert.match(code,/allTrue\(\)/);
});

test('deliberate privilege escalation and membership changes fail role proof',()=>{
  for(const phrase of [
    'GRANT SELECT ON bdp_parcel_index.parcel_versions',
    'REVOKE SELECT ON bdp_parcel_index.parcel_versions',
    'GRANT EXECUTE ON FUNCTION',
    'REVOKE EXECUTE ON FUNCTION',
    'GRANT CREATE ON SCHEMA bdp_parcel_index',
    'REVOKE CREATE ON SCHEMA bdp_parcel_index',
    'GRANT ldos_parcel_rpc_client TO',
    'REVOKE ldos_parcel_rpc_client FROM',
    'proof().no_index_table_access,false',
    'proof().no_other_index_rpc,false',
    'proof().no_schema_create,false',
    'proof().no_role_memberships,false',
  ]) assert.ok(code.includes(phrase),phrase);
});

test('no seal, wrong county or revoked source ever produces authority rows',()=>{
  assert.match(code,/An unsealed synthetic run must not be authoritative/);
  assert.match(code,/parcel_run_seals/);
  assert.match(code,/parcel_sealed_source_authority_rpc\('48029'\)/);
  assert.match(code,/rights_state='revoked'/);
  assert.match(AUTHORITY_DB_LOGIN_SUCCESS,
    /^PASS: disposable PostGIS authority-only LOGIN/);
});
