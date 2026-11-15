import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  SIX_PRINCIPAL_SMOKE_PASS,
  requireSixPrincipalDisposableOptIn,
  runSixPrincipalDisposableSmoke,
} from '../../../scripts/bdp/parcel-six-principal-disposable-smoke.mjs';

const src=readFileSync(new URL(
  '../../../scripts/bdp/parcel-six-principal-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('49 exact disposable-only opt-in is mandatory',()=>{
  assert.equal(requireSixPrincipalDisposableOptIn(['--disposable-only']),true);
  for(const args of [
    [],null,['--prod'],['--disposable-only','--reuse'],
    ['--disposable-only','--disposable-only'],
  ])assert.throws(()=>requireSixPrincipalDisposableOptIn(args),
    /Refusing six-principal SQL smoke/);
});
test('49 invalid opt-in exits before any docker operation',async()=>{
  await assert.rejects(runSixPrincipalDisposableSmoke(['--prod']),
    /Refusing six-principal SQL smoke/);
});
test('49 isolated new PostGIS container has no host networking, ports or mounts',()=>{
  assert.match(src,/randomBytes\(6\)\.toString\('hex'\)/);
  assert.match(src,/docker\(\['info','--format','\{\{\.ServerVersion\}\}'\]/);
  assert.match(src,/docker\(\['image','inspect',DRIVER_SMOKE_IMAGE\]/);
  assert.match(src,/docker\(\['run','-d','--name',container,'--network','none','--pull=never'/);
  assert.doesNotMatch(src,/'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.doesNotMatch(src,/new Pool\(|connectionString|bdp-postgis/);
});
test('49 six distinct SQL LOGINs are password authenticated, not impersonated',()=>{
  for(const login of [
    'ldos_parcel_authority_test','ldos_parcel_publication_test',
    'ldos_parcel_geometry_test','ldos_parcel_epoch_test',
    'ldos_parcel_run_epoch_test','ldos_parcel_session_epoch_test',
  ])assert.ok(src.includes(login),login);
  assert.match(src,/Object\.fromEntries\(\s*PRINCIPALS\.map\(p=>\[p,randomBytes\(32\)\.toString\('hex'\)\]\)/);
  assert.match(src,/CREATE ROLE '\+LOGIN\[principal\]\+' LOGIN NOINHERIT/);
  assert.match(src,/'-h','127\.0\.0\.1','-U',LOGIN\[as\]/);
  assert.doesNotMatch(src,/sql\(['\"]SET ROLE|sql\(['\"]SET SESSION AUTHORIZATION/);
});
test('49 six separate schema-restricted fixed RPCs and geometry keyset only',()=>{
  for(const fn of [
    'parcel_sealed_source_authority_rpc(text)',
    'parcel_geometry_publication_review_rpc(text,text)',
    'parcel_geometry_sealed_initial_rpc',
    'parcel_geometry_keyset_rpc',
    'parcel_policy_epoch_snapshot_rpc(text,text)',
    'parcel_current_sealed_run_epoch_rpc(text,text,bigint)',
    'parcel_session_county_epoch_rpc(text,text)',
  ])assert.ok(src.includes(fn),fn);
  assert.match(src,/schema=principal==='session'\?'ldos_private_auth':'bdp_parcel_index'/);
  assert.match(src,/for\(const fn of grants\[principal\]\)/);
  assert.doesNotMatch(src,/GRANT ALL|GRANT SELECT ON .* TO LOGINS|GRANT CREATE ON SCHEMA/);
});
test('49 only reviewed synthetic SQL schemas and parcels enter isolated database',()=>{
  for(const f of [
    'SYNTHETIC_DRIVER_FIXTURE_SQL','EXTRA_SYNTHETIC_PARCELS_SQL',
    'parcelIndexFoundation.sql','parcelRestrictedRpcFoundation.sql',
    'parcelGeometryPublicationRightsFoundation.sql',
    'parcelRunSealFoundation.sql',
    'parcelGeometrySealedInitialRpcFoundation.sql',
    'parcelPolicyEpochSnapshotRpcFoundation.sql',
    'parcelCurrentSealedRunEpochRpcFoundation.sql',
    'parcelSessionCountyEpochRpcFoundation.sql',
    'step40c13-synthetic',
  ])assert.ok(src.includes(f),f);
  assert.doesNotMatch(src,/fetch\(|https:\/\/|ST_AsGeoJSON|app\.get\(/);
});
test('49 each role rejects cross-RPC calls and raw source/auth table access',()=>{
  assert.match(src,/for\(const principal of PRINCIPALS\)\{\s*for\(const other of PRINCIPALS\)/);
  assert.match(src,/if\(principal===other\)continue/);
  assert.match(src,/denied\(query\[other\],principal\)/);
  assert.match(src,/denied\('SELECT source_id FROM bdp_parcel_index\.source_registry;',principal\)/);
  assert.match(src,/denied\('SELECT epoch FROM ldos_private_auth\.session_county_epochs;',principal\)/);
  assert.match(src,/Object\.values\(proof\(principal\)\)\.every\(Boolean\)/);
});
test('49 private run seal plus independent synthetic review required for geometry count',()=>{
  // count(*) always returns a row containing '0', NOT an empty string.
  assert.match(src,/assert\\.equal\\(own\\('source'\\),'0'\\)/);
  assert.doesNotMatch(src,/assert\\.equal\\(own\\('source'\\),''\\)/);
  assert.match(src,/assert\\.equal\\(own\\('source'\\),'1'\\)/);
  assert.match(src,/assert\.equal\(own\('review'\),'0'\)/);
  assert.match(src,/assert\.equal\(own\('geometry'\),'0'\)/);
  assert.match(src,/parcel_run_seals/);
  assert.match(src,/review_reference='synthetic\/step-40c49'/);
  assert.match(src,/quantity>=1&&quantity<=3/);
});
test('49 session ABA and publication ABA produce separate epoch changes',()=>{
  assert.match(src,/allow_discovery=FALSE/);
  assert.match(src,/allow_discovery=TRUE/);
  assert.match(src,/BigInt\(own\('session'\)\),BigInt\(sessionBefore\)\+2n/);
  assert.match(src,/review_state='revoked',allow_geometry_redistribution=FALSE/);
  assert.match(src,/review_state='approved',allow_geometry_redistribution=TRUE/);
  assert.match(src,/assert\.equal\(p1,p0\+2n/);
  assert.match(src,/assert\.equal\(c1,c0\)/);
  assert.match(src,/assert\.equal\(own\('run'\),runBefore\)/);
});
test('49 failed newer finished ingest denies fallback to older sealed run',()=>{
  assert.match(src,/synthetic-failed/);
  assert.match(src,/clock_timestamp\(\)\+interval '1 hour'/);
  assert.match(src,/assert\.equal\(own\('run'\),'',/);
  assert.match(src,/assert\.equal\(own\('source'\),'0',/);
  assert.doesNotMatch(src,/ALTER ROLE .*SUPERUSER/);
});
test('49 real role privilege drift causes two separate catalog proof failures',()=>{
  assert.match(src,/proof\('policy'\)\.no_index_table_access,false/);
  assert.match(src,/proof\('session'\)\.no_private_table_access,false/);
  assert.match(src,/REVOKE SELECT ON bdp_parcel_index\.parcel_policy_epochs/);
  assert.match(src,/REVOKE SELECT ON ldos_private_auth\.session_county_epochs/);
  assert.match(src,/attestAll\(\);/);
});
test('49 startup credentials are redacted, cleanup runs even after run timeout',()=>{
  assert.match(src,/let attempted=false/);
  assert.match(src,/attempted=true/);
  assert.match(src,/if\(attempted\)\{/);
  assert.match(src,/docker\(\['rm','--force','--volumes',container\]/);
  assert.match(src,/msg\.replaceAll\(postgresPassword,'\[redacted\]'\)/);
  assert.match(src,/for\(const password of Object\.values\(passwords\)\)/);
  assert.doesNotMatch(src,/JSON\.stringify\(args\)|console\.log\(passwords\)/);
});
test('49 success only confirms disposable SQL roles, NOT real session or public geometry',()=>{
  assert.match(SIX_PRINCIPAL_SMOKE_PASS,
    /^PASS: disposable PostGIS six independent SQL LOGINS/);
  assert.match(src,/DOES NOT exercise a real identity provider/);
  assert.match(src,/not an atomic HTTP release test/);
  assert.doesNotMatch(src,/createServer\(|\.listen\(|publishAuthorized:true/);
});
