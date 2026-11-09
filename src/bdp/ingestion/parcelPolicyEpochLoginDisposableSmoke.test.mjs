import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PRIVATE_EPOCH_LOGIN_SMOKE_PASS,
  requirePrivateEpochLoginDisposableOptIn,
  runPrivateEpochLoginDisposableSmoke,
} from '../../../scripts/bdp/parcel-epoch-login-disposable-smoke.mjs';
const code=readFileSync(new URL(
  '../../../scripts/bdp/parcel-epoch-login-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('41 smoke requires exactly one --disposable-only flag',()=>{
  assert.equal(requirePrivateEpochLoginDisposableOptIn(['--disposable-only']),true);
  for(const args of [
    null,[],['--prod'],['--local'],
    ['--disposable-only','--reuse'],
    ['--disposable-only','--disposable-only'],
  ])assert.throws(()=>requirePrivateEpochLoginDisposableOptIn(args),
    /Refusing epoch-only SQL login smoke/);
});
test('invalid flag prevents any Docker creation',async()=>{
  await assert.rejects(runPrivateEpochLoginDisposableSmoke(['--production']),
    /Refusing epoch-only SQL login smoke/);
});
test('disposable Docker instance has no network, ports or mounted local data',()=>{
  assert.match(code,/docker\(\['run','-d','--name',name,'--network','none'/);
  assert.match(code,/'POSTGRES_HOST_AUTH_METHOD=scram-sha-256'/);
  assert.doesNotMatch(code,/'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.match(code,/docker\(\['rm','--force','--volumes',name\]/);
  assert.match(code,/replaceAll\(loginPassword,'\[redacted\]'\)/);
  assert.match(code,/replaceAll\(postgresPassword,'\[redacted\]'\)/);
});
test('smoke only installs staged SQL over invented source fixtures',()=>{
  for(const item of [
    'SYNTHETIC_DRIVER_FIXTURE_SQL','step40c13-synthetic',
    'parcelIndexFoundation.sql','parcelRestrictedRpcFoundation.sql',
    'parcelGeometryPublicationRightsFoundation.sql',
    'parcelPolicyEpochFoundation.sql',
    'parcelPolicyEpochSnapshotRpcFoundation.sql',
  ])assert.ok(code.includes(item),item);
  assert.doesNotMatch(code,/bdp-postgis|connectionString|new Pool\(|\.listen\(/);
});
test('real password login is separately restricted and not SET ROLE impersonated',()=>{
  assert.match(code,/CREATE ROLE '\+LOGIN/);
  assert.match(code,/LOGIN NOINHERIT NOSUPERUSER NOCREATEDB/);
  assert.match(code,/NOREPLICATION NOBYPASSRLS PASSWORD/);
  assert.match(code,/'PGPASSWORD='\+loginPassword/);
  assert.match(code,/'-h','127\.0\.0\.1','-U',LOGIN/);
  assert.doesNotMatch(code,/SET LOCAL ROLE|SET SESSION AUTHORIZATION/);
});
test('fixed role attestation denies table SELECT and unrelated index function',()=>{
  assert.match(code,/PREPARE ldos_epoch_attest\(text\)/);
  assert.match(code,/PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL/);
  assert.match(code,/roleProof\('ldos_parcel_epoch_wrong'\)\.exact_login,false/);
  assert.match(code,/roleProof\(\)\.no_index_table_access,false/);
  assert.match(code,/roleProof\(\)\.no_other_index_rpc,false/);
  assert.match(code,/REVOKE SELECT ON bdp_parcel_index\.parcel_policy_epochs/);
  assert.match(code,/REVOKE EXECUTE ON FUNCTION/);
});
test('both independent ABA rights transitions remain visible as new counters',()=>{
  for(const k of [
    "rights_state='revoked'","rights_state='approved'",
    "assert.equal(read(),'1|1')","assert.equal(read(),'2|1')",
    "assert.equal(read(),'3|1')","assert.equal(read(),'3|2')",
    "assert.equal(read(),'3|3')","assert.equal(read(),'3|4')",
    "review_state='revoked',allow_geometry_redistribution=FALSE",
  ])assert.ok(code.includes(k),k);
  assert.match(code,/epoch RPC does NOT assert/);
});
test('successful disposable test is explicitly not production authorization',()=>{
  assert.match(PRIVATE_EPOCH_LOGIN_SMOKE_PASS,
    /^PASS: disposable PostGIS epoch-only LOGIN/);
  assert.match(code,/NOT concurrent read release/);
  assert.doesNotMatch(code,/createServer\(|app\.get\(|ST_AsGeoJSON/);
});
