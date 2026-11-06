import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THREE_PRINCIPAL_SMOKE_PASS,
  requireThreePrincipalDisposableOptIn,
  runThreePrincipalDisposableSmoke,
} from '../../../scripts/bdp/parcel-three-principal-disposable-smoke.mjs';

const source = readFileSync(new URL(
  '../../../scripts/bdp/parcel-three-principal-disposable-smoke.mjs',
  import.meta.url), 'utf8');
const runtime = readFileSync(new URL(
  '../../../server/providers/bdp-parcel-sealed-geometry-runtime.js',
  import.meta.url), 'utf8');

test('40C39 only executes when invoked with the single exact disposable flag',()=>{
  assert.equal(requireThreePrincipalDisposableOptIn(['--disposable-only']),true);
  for (const args of [
    null,[],['--live'],['--production'],['--reuse'],
    ['--disposable-only','--reuse'],
    ['--disposable-only','--disposable-only'],
  ]) assert.throws(()=>requireThreePrincipalDisposableOptIn(args),
    /Refusing three-principal SQL smoke/);
});

test('invalid CLI flag rejects before spawning Docker',async()=>{
  await assert.rejects(runThreePrincipalDisposableSmoke(['--unsafe']),
    /Refusing three-principal SQL smoke/);
});

test('smoke uses a fresh isolated PostGIS instance without host connectivity',()=>{
  assert.match(source,/docker\(\['run','-d','--name',name,'--network','none'/);
  assert.match(source,/'POSTGRES_HOST_AUTH_METHOD=scram-sha-256'/);
  assert.doesNotMatch(source,/'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.match(source,/randomBytes\(6\)\.toString\('hex'\)/);
  assert.match(source,/docker\(\['rm','--force','--volumes',name\]/);
});

test('only six reviewed schema drafts and three synthetic setup fixtures load',()=>{
  for (const item of [
    'parcelIndexFoundation.sql',
    'parcelRestrictedRpcFoundation.sql',
    'parcelGeometryPublicationRightsFoundation.sql',
    'parcelGeometryRestrictedRpcFoundation.sql',
    'parcelRunSealFoundation.sql',
    'parcelGeometryKeysetRpcFoundation.sql',
    'parcelGeometrySealedInitialRpcFoundation.sql',
    'parcelSealedSourceAuthorityRpcFoundation.sql',
    'parcelGeometryPublicationReviewRpcFoundation.sql',
    'SYNTHETIC_DRIVER_FIXTURE_SQL',
    'EXTRA_SYNTHETIC_PARCELS_SQL',
    'step40c13-synthetic',
  ]) assert.ok(source.includes(item),item);
  assert.doesNotMatch(source,/connectionString|bdp-postgis|new Pool\(|\.listen\(/);
});

test('three isolated password-authenticated SQL LOGINs are created separately',()=>{
  for (const principal of [
    'ldos_parcel_authority_test',
    'ldos_parcel_publication_test',
    'ldos_parcel_geometry_test',
  ]) assert.ok(source.includes(principal),principal);
  assert.match(source,/CREATE ROLE.*LOGINS\[principal\]/);
  assert.match(source,/LOGIN NOINHERIT/);
  assert.match(source,/NOBYPASSRLS/);
  assert.match(source,/'PGPASSWORD='\+passwords\[principal\]/);
  assert.match(source,/'-h','127\.0\.0\.1','-U',LOGINS\[principal\]/);
  assert.doesNotMatch(source,/SET LOCAL ROLE|SET SESSION AUTHORIZATION/);
});

test('three distinct role attestations run under actual login principals',()=>{
  for (const item of [
    'SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL',
    'GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL',
    'SEALED_GEOMETRY_ROLE_ATTESTATION_SQL',
    "PREPARE ldos_role_proof(text)",
    'allRolesStrict()',
    "roleProof('source',LOGINS.review).exact_login,false",
    "roleProof('review',LOGINS.geometry).exact_login,false",
    "roleProof('geometry',LOGINS.source).exact_login,false",
  ]) assert.ok(source.includes(item),item);
});

test('each principal is restricted to its individually granted fixed SQL RPCs',()=>{
  for (const item of [
    "GRANT EXECUTE ON FUNCTION '+FN.source+' TO '+LOGINS.source",
    "GRANT EXECUTE ON FUNCTION '+FN.review+' TO '+LOGINS.review",
    "GRANT EXECUTE ON FUNCTION '+FN.initial+' TO '+LOGINS.geometry",
    "GRANT EXECUTE ON FUNCTION '+FN.keyset+' TO '+LOGINS.geometry",
    "denied(reviewQuery,'source')",
    "denied(geometryQuery,'source')",
    "denied(sourceQuery,'review')",
    "denied(geometryQuery,'review')",
    "denied(sourceQuery,'geometry')",
    "denied(reviewQuery,'geometry')",
  ]) assert.ok(source.includes(item),item);
});

test('unsealed and unreviewed records deny independent rights and geometry',()=>{
  assert.match(source,/assert\.deepEqual\(counts\(\),\{authority:0,publication:0,geometry:0\}\)/);
  assert.match(source,/parcel_run_seals/);
  assert.match(source,/assert\.deepEqual\(counts\(\),\{authority:1,publication:0,geometry:0\}\)/);
  assert.match(source,/synthetic\/step-40c39/);
  assert.match(source,/allowed\.geometry>=1&&allowed\.geometry<=3/);
});

test('publication revocation invalidates follow-up role-separated reads',()=>{
  assert.match(source,/review_state='revoked',allow_geometry_redistribution=FALSE/);
  assert.match(source,/assert\.deepEqual\(counts\(\),\{authority:1,publication:0,geometry:0\}\)/);
  assert.match(source,/review_state='approved',allow_geometry_redistribution=TRUE/);
  assert.match(source,/assert\.equal\(counts\(\)\.geometry,allowed\.geometry\)/);
});

test('cache revocation does not magically revoke independent legal review',()=>{
  assert.match(source,/SET rights_state='revoked'/);
  assert.match(source,/assert\.deepEqual\(counts\(\),\{authority:0,publication:1,geometry:0\}\)/);
  assert.match(source,/SET rights_state='approved'/);
});

test('cross-role grant drift is rejected by geometry role attestation',()=>{
  assert.match(source,/GRANT EXECUTE ON FUNCTION '\+FN.review\+' TO '\+LOGINS.geometry/);
  assert.match(source,/roleProof\('geometry'\)\.no_other_index_rpc,false/);
  assert.match(source,/REVOKE EXECUTE ON FUNCTION '\+FN.review\+' FROM '\+LOGINS.geometry/);
  assert.match(source,/allRolesStrict\(\)/);
  assert.match(THREE_PRINCIPAL_SMOKE_PASS,
    /^PASS: disposable PostGIS three independent LOGINs/);
});

test('every disposable SQL error redacts each randomly generated password',()=>{
  assert.match(source,/replaceAll\(secret,'\[redacted\]'\)/);
  assert.match(source,/postgresPassword,\.\.\.Object\.values\(passwords\)/);
  assert.match(source,/WARNING: disposable three-principal container cleanup failed/);
});

test('no source-only, review-only or geometry-only result ever grants browser rights',()=>{
  assert.doesNotMatch(source,/createServer\(|\.listen\(|express\(|app\.get\(/);
  assert.match(source,/not a production-atomic revocation epoch/i);
  assert.match(runtime,/publicationRevision = createHash/);
});

test('ABA risk: identical pre/post authority facts cannot prove no intervening revoke',()=>{
  const initial = Object.freeze({
    source:'synthetic',cache:'approved',review:'approved',
    reviewReference:'review-v1',
  });
  const revoked = {...initial,review:'revoked'};
  const reapproved = {...initial};
  assert.notDeepEqual(revoked,initial);
  assert.deepEqual(reapproved,initial);
  assert.equal(JSON.stringify(reapproved),JSON.stringify(initial));
  // This intentionally documents the unsolved limitation of pre/post
  // value comparisons. Durable monotonic epochs must be added later.
  assert.match(runtime,/Pre\/post|before and after|pre\/post|before and after/i);
});
