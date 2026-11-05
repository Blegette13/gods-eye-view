import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PUBLICATION_REVIEW_SMOKE_SUCCESS, PUBLICATION_REVIEW_LOGIN,
  requirePublicationReviewSmokeOptIn,
  runPublicationReviewDisposableSmoke,
} from '../../../scripts/bdp/parcel-publication-review-disposable-smoke.mjs';
const code=readFileSync(new URL(
  '../../../scripts/bdp/parcel-publication-review-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('40C36 disposable smoke demands exactly one explicit opt-in flag',()=>{
  assert.equal(requirePublicationReviewSmokeOptIn(['--disposable-only']),true);
  for(const args of [[],null,['--production'],['--live'],
    ['--disposable-only','--reuse'],['--disposable-only','--disposable-only']]) {
    assert.throws(()=>requirePublicationReviewSmokeOptIn(args),
      /Refusing independent publication test/);
  }
});

test('invalid opt-in denies execution BEFORE any container startup',async()=>{
  await assert.rejects(runPublicationReviewDisposableSmoke(['--prod']),
    /Refusing independent publication test/);
});

test('one-use Docker fixture has no external network, ports, mounts or persistence',()=>{
  assert.match(code,/docker\(\['run','-d','--name',name,'--network','none'/);
  assert.match(code,/'POSTGRES_HOST_AUTH_METHOD=scram-sha-256'/);
  assert.doesNotMatch(code,/'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.match(code,/docker\(\['rm','--force','--volumes',name\]/);
  assert.match(code,/randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(code,/replaceAll\(postgresPassword,'\[redacted\]'\)/);
  assert.match(code,/replaceAll\(loginPassword,'\[redacted\]'\)/);
});

test('smoke loads reviewed SQL and invented source, never a local BDP DB',()=>{
  for(const part of [
    'parcelIndexFoundation.sql','parcelRestrictedRpcFoundation.sql',
    'parcelGeometryPublicationRightsFoundation.sql',
    'parcelGeometryPublicationReviewRpcFoundation.sql',
    'SYNTHETIC_DRIVER_FIXTURE_SQL','step40c13-synthetic',
  ]) assert.ok(code.includes(part),part);
  assert.doesNotMatch(code,/connectionString|bdp-postgis|new Pool\(|\.listen\(/);
});

test('password-authenticated review LOGIN is not elevated or impersonated',()=>{
  assert.equal(PUBLICATION_REVIEW_LOGIN,'ldos_parcel_publication_test');
  assert.match(code,/CREATE ROLE.*PUBLICATION_REVIEW_LOGIN/);
  assert.match(code,/LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.match(code,/NOREPLICATION NOBYPASSRLS PASSWORD/);
  assert.match(code,/'PGPASSWORD='\+loginPassword/);
  assert.match(code,/'-h','127\.0\.0\.1','-U',PUBLICATION_REVIEW_LOGIN/);
  assert.doesNotMatch(code,/SET LOCAL ROLE|SET SESSION AUTHORIZATION/);
});

test('real-login role proof tests direct base-table and other-RPC grants',()=>{
  assert.match(code,/PREPARE ldos_publication_attest\(text\)/);
  assert.match(code,/GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL/);
  assert.match(code,/GRANT SELECT ON bdp_parcel_index\.geometry_publication_reviews/);
  assert.match(code,/proof\(\)\.no_index_table_access,false/);
  assert.match(code,/roleProof\(\)\.no_index_table_access,false/);
  assert.match(code,/roleProof\(\)\.no_other_index_rpc,false/);
  assert.match(code,/GRANT EXECUTE ON FUNCTION/);
  assert.match(code,/REVOKE EXECUTE ON FUNCTION/);
});

test('default-unreviewed, expiration, revision and revocation checks use live SQL',()=>{
  for(const phrase of [
    "review_state='approved'",
    "review_state='revoked'",
    "allow_geometry_redistribution=FALSE",
    "expires_at=clock_timestamp()-interval '1 hour'",
    "review_reference='synthetic/review-36-updated'",
    "assert.equal(apply(query(),true),'0')",
    "assert.equal(apply(query(),true),'1')",
  ])assert.ok(code.includes(phrase),phrase);
});

test('smoke explicitly proves caching rights are INDEPENDENT, not publishing approval',()=>{
  assert.match(code,/SET rights_state='revoked'/);
  assert.match(code,/separate sealed-source gate must still/);
  assert.match(code,/assert\.equal\(apply\(query\(\),true\),'1'\)/);
  assert.match(PUBLICATION_REVIEW_SMOKE_SUCCESS,
    /^PASS: disposable PostGIS independent geometry-review LOGIN/);
});
