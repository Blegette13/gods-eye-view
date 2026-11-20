import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  SESSION_COUNTY_EPOCH_READER_SMOKE_PASS,
  requireSessionCountyEpochReaderOptIn,
  runSessionCountyEpochReaderSmoke,
} from '../../../scripts/bdp/parcel-session-county-epoch-reader-disposable-smoke.mjs';
const src=readFileSync(new URL(
  '../../../scripts/bdp/parcel-session-county-epoch-reader-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('47 requires exact disposable-only opt-in',()=>{
  assert.equal(requireSessionCountyEpochReaderOptIn(['--disposable-only']),true);
  for(const invalid of [
    null,[],['--prod'],['--disposable-only','--reuse'],
    ['--disposable-only','--disposable-only'],
  ])assert.throws(()=>requireSessionCountyEpochReaderOptIn(invalid),
    /Refusing session\/county epoch SQL smoke/);
});
test('47 invalid opt-in stops before Docker is launched',async()=>{
  await assert.rejects(runSessionCountyEpochReaderSmoke(['--prod']),
    /Refusing session\/county epoch SQL smoke/);
});
test('47 Docker test uses new random isolated container and local image',()=>{
  assert.match(src,/docker\(\['run','-d','--name',container,'--network','none','--pull=never'/);
  assert.match(src,/docker\(\['info','--format','\{\{\.ServerVersion\}\}'\]/);
  assert.match(src,/docker\(\['image','inspect',DRIVER_SMOKE_IMAGE\]/);
  assert.doesNotMatch(src,/'--privileged'|'-p'|'-P'|'--mount'|'--volume'/);
  assert.doesNotMatch(src,/new Pool\(|connectionString|bdp-postgis/);
});
test('47 only synthetic private auth schema and fixed RPC are installed',()=>{
  assert.match(src,/parcelSessionCountyEpochFoundation\.sql/);
  assert.match(src,/parcelSessionCountyEpochRpcFoundation\.sql/);
  assert.match(src,/ldos_private_auth\.session_county_decisions/);
  assert.match(src,/ldos_private_auth\.parcel_session_county_epoch_rpc\(text,text\)/);
  assert.doesNotMatch(src,/real_account|ST_AsGeoJSON|ST_Intersects/i);
});
test('47 synthetic user defaults false and must have all current flags',()=>{
  assert.match(src,/Default-false account\/session flags must deny/);
  assert.match(src,/account_active=TRUE,mfa_verified=TRUE/);
  assert.match(src,/session_active=TRUE,allow_discovery=TRUE/);
  assert.match(src,/MFA revoked must deny synthetic proof/);
});
test('47 revoke-reapprove ABA, rollback, and delete-reinsert preserve revision',()=>{
  for(const txt of [
    'epoch(),1n','epoch(),2n','epoch(),3n','epoch(),4n',
    'epoch(),5n','epoch(),6n','epoch(),7n',
    'allow_discovery=FALSE','allow_discovery=TRUE',
    'Rolled-back revoke must be invisible',
    'Delete/recreate must not reset history',
  ])assert.ok(src.includes(txt),txt);
});
test('47 real LOGIN must not read raw grants and privilege drift fails',()=>{
  for(const txt of [
    'CREATE ROLE','LOGIN NOINHERIT NOSUPERUSER NOCREATEDB',
    'NOBYPASSRLS PASSWORD',
    "'-h','127.0.0.1','-U',LOGIN",
    'PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL',
    'no_private_table_access,false',
    'REVOKE SELECT ON ldos_private_auth.session_county_epochs',
    'denied(lookup)',
  ])assert.ok(src.includes(txt),txt);
});
test('47 no secret in failure and name-scoped cleanup even after timeout',()=>{
  assert.match(src,/let attempted=false/);
  assert.match(src,/attempted=true/);
  assert.match(src,/if\(attempted\)/);
  assert.match(src,/docker\(\['rm','--force','--volumes',container\]/);
  assert.match(src,/replaceAll\(loginPassword,'\[redacted\]'\)/);
  assert.match(src,/replaceAll\(postgresPassword,'\[redacted\]'\)/);
  assert.doesNotMatch(src,/createServer\(|\.listen\(|app\.get\(/);
});
test('47 success string does not claim legal approval or real user authentication',()=>{
  assert.match(SESSION_COUNTY_EPOCH_READER_SMOKE_PASS,
    /^PASS: disposable PostGIS session\/county epoch LOGIN/);
  assert.match(src,/SYNTHETIC USERS ONLY/);
  assert.doesNotMatch(src,/GIS rights approved|real MFA validated/);
});
