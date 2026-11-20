import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  GEOMETRY_LOGIN,GEOMETRY_LOGIN_DISPOSABLE_SUCCESS,
  requireGeometryLoginDisposableOptIn,runGeometryLoginDisposableSmoke,
} from '../../../scripts/bdp/parcel-geometry-login-disposable-smoke.mjs';
const code=readFileSync(new URL(
  '../../../scripts/bdp/parcel-geometry-login-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('40C38 requires one exact disposable-only flag before any DB activity',()=>{
  assert.equal(requireGeometryLoginDisposableOptIn(['--disposable-only']),true);
  for(const args of [null,[],['--live'],['--prod'],
    ['--disposable-only','--reuse'],['--disposable-only','--disposable-only']]){
    assert.throws(()=>requireGeometryLoginDisposableOptIn(args),
      /Refusing geometry LOGIN smoke/);
  }
});
test('invalid flag rejects before creating Docker containers',async()=>{
  await assert.rejects(runGeometryLoginDisposableSmoke(['--unsafe']),
    /Refusing geometry LOGIN smoke/);
});
test('Docker test is networkless, portless, unmounted, and deletes its volume',()=>{
  assert.match(code,/docker\(\['run','-d','--name',name,'--network','none'/);
  assert.match(code,/'POSTGRES_HOST_AUTH_METHOD=scram-sha-256'/);
  assert.doesNotMatch(code,/'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.match(code,/docker\(\['rm','--force','--volumes',name\]/);
  assert.match(code,/replaceAll\(postgresPassword,'\[redacted\]'\)/);
  assert.match(code,/replaceAll\(loginPassword,'\[redacted\]'\)/);
});
test('only synthetic sources and staged SQL are used, never local BDP database',()=>{
  for(const s of [
    'SYNTHETIC_DRIVER_FIXTURE_SQL','EXTRA_SYNTHETIC_PARCELS_SQL',
    'parcelIndexFoundation.sql','parcelRestrictedRpcFoundation.sql',
    'parcelGeometryPublicationRightsFoundation.sql',
    'parcelGeometryRestrictedRpcFoundation.sql','parcelRunSealFoundation.sql',
    'parcelGeometryKeysetRpcFoundation.sql',
    'parcelGeometrySealedInitialRpcFoundation.sql',
    'parcelSealedSourceAuthorityRpcFoundation.sql',
    'parcelGeometryPublicationReviewRpcFoundation.sql',
    'step40c13-synthetic',
  ])assert.ok(code.includes(s),s);
  assert.doesNotMatch(code,/bdp-postgis|connectionString|new Pool\(|\.listen\(/);
});
test('a REAL password-authenticated dedicated geometry-only login is tested',()=>{
  assert.equal(GEOMETRY_LOGIN,'ldos_parcel_geometry_test');
  assert.match(code,/CREATE ROLE.*GEOMETRY_LOGIN/);
  assert.match(code,/LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.match(code,/NOREPLICATION NOBYPASSRLS PASSWORD/);
  assert.match(code,/'PGPASSWORD='\+loginPassword/);
  assert.match(code,/'-h','127\.0\.0\.1','-U',GEOMETRY_LOGIN/);
  assert.doesNotMatch(code,/SET LOCAL ROLE|SET SESSION AUTHORIZATION/);
});
test('exact expected login and all catalog fields are checked, not a loose account',()=>{
  assert.match(code,/PREPARE ldos_geometry_attest\(text\)/);
  assert.match(code,/SEALED_GEOMETRY_ROLE_ATTESTATION_SQL/);
  assert.match(code,/roleProof\('ldos_parcel_geometry_wrong'\)\.exact_login,false/);
  assert.match(code,/no_other_index_rpc/);
  assert.match(code,/no_role_memberships/);
});
test('positive attestation is tested alongside table, other RPC and role regressions',()=>{
  for(const part of [
    'GRANT SELECT ON bdp_parcel_index.parcel_versions',
    'REVOKE SELECT ON bdp_parcel_index.parcel_versions',
    'GRANT EXECUTE ON FUNCTION',
    'REVOKE EXECUTE ON FUNCTION',
    'GRANT ldos_parcel_rpc_client TO',
    'REVOKE ldos_parcel_rpc_client FROM',
    'roleProof().no_index_table_access,false',
    'roleProof().no_other_index_rpc,false',
    'roleProof().no_role_memberships,false',
  ])assert.ok(code.includes(part),part);
});
test('unsealed or unlicensed synthetic parcels never become a publishable entitlement',()=>{
  assert.match(code,/Unsealed run cannot be read/);
  assert.match(code,/Caching rights never imply publication approval/);
  assert.match(code,/review_state='revoked'/);
  assert.match(code,/assert\.equal\(apply\(initial,true\),'0'\)/);
  assert.match(GEOMETRY_LOGIN_DISPOSABLE_SUCCESS,
    /^PASS: disposable PostGIS geometry-only LOGIN/);
});
