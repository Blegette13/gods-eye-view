import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PASS,READINESS_EXPECTED,READINESS_SQL,
  requireReadOnlyFlag,verifyReadiness,runReadOnlyAuthGatewayPreflight,
} from '../../../scripts/bdp/app-auth-local-gateway-preflight.mjs';
import {
  POSTFLIGHT_SQL,verifyPostflight,
} from '../../../scripts/bdp/app-auth-local-reader-role-migration.mjs';

const source=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-local-gateway-preflight.mjs',import.meta.url,
),'utf8');

test('62D-C8 requires one exact read-only opt-in flag',()=>{
  assert.equal(requireReadOnlyFlag(['--check-local-auth-only']),true);
  for(const x of [[],null,undefined,['--apply-local-auth-only'],
    ['--disposable-only'],['--check-local-auth-only','--force'],['--prod']])
    assert.throws(()=>requireReadOnlyFlag(x));
});
test('62D-C8 checks only the exact dedicated auth-dev database',()=>{
  assert.match(READINESS_SQL,/current_database\(\)/);
  assert.match(source,/'-d','ldos_auth_dev'/);
  assert.match(source,/verifyTarget\(metadata\(\)\)/);
});
test('62D-C8 check demands a writable primary, not a replica',()=>{
  assert.match(READINESS_SQL,/pg_is_in_recovery\(\)/);
  assert.equal(verifyReadiness(READINESS_EXPECTED),true);
  assert.throws(()=>verifyReadiness('ldos_auth_dev|t|t|t|t|t'));
});
test('62D-C8 checks exact postgres SQL preflight principal',()=>{
  assert.match(READINESS_SQL,/current_user = 'postgres'/);
  assert.throws(()=>verifyReadiness('ldos_auth_dev|f|f|t|t|t'));
});
test('62D-C8 denies existing persistent gateway LOGIN',()=>{
  assert.match(READINESS_SQL,/rolname = 'ldos_auth_gateway_login'/);
  assert.throws(()=>verifyReadiness('ldos_auth_dev|f|t|f|t|t'));
});
test('62D-C8 keeps independent candidate RPC absent',()=>{
  assert.match(READINESS_SQL,/current_county_candidate_rpc\(text,text\)/);
  assert.throws(()=>verifyReadiness('ldos_auth_dev|f|t|t|f|t'));
});
test('62D-C8 asserts all three persistent ledger tables empty',()=>{
  for(const name of ['accounts','sessions','county_grants'])
    assert.ok(READINESS_SQL.includes('FROM ldos_app_auth.'+name));
  assert.throws(()=>verifyReadiness('ldos_auth_dev|f|t|t|t|f'));
});
test('62D-C8 readiness fails on missing, trailing or foreign data',()=>{
  for(const x of ['',null,{},'postgres|f|t|t|t|t',
    READINESS_EXPECTED+'|extra','ldos_auth_dev|f|t|t|t|t\nother'])
    assert.throws(()=>verifyReadiness(x));
  assert.equal(verifyReadiness(READINESS_EXPECTED+'\n'),true);
});
test('62D-C8 reuses proven postflight role ACL assertions',()=>{
  assert.match(source,/verifyPostflight\(query\(POSTFLIGHT_SQL\)\)/);
  assert.match(POSTFLIGHT_SQL,/NOT rolcanlogin/);
  assert.match(POSTFLIGHT_SQL,/NOT has_column_privilege\('ldos_auth_account_reader','ldos_app_auth.accounts','created_at','SELECT'\)/);
  assert.equal(verifyPostflight('ldos_auth_dev|f|t|0|0|0|t'),true);
});
test('62D-C8 invokes only read-only Docker inspect and psql -c',()=>{
  assert.match(source,/docker\(\['inspect','--format'/);
  assert.match(source,/'psql','-X','-U','postgres'/);
  assert.match(source,/'-q','-c',sql/);
  assert.doesNotMatch(source,/docker\(\['run'|docker\(\['rm'|docker\(\['compose'|docker\(\['cp'/);
});
test('62D-C8 has no persistence mutation or provisioning code',()=>{
  assert.doesNotMatch(source,
    /CREATE ROLE|GRANT SELECT|ALTER ROLE|INSERT INTO|UPDATE ldos_app_auth|DROP DATABASE|DELETE FROM|TRUNCATE|pg_restore|pg_dump/);
  assert.doesNotMatch(READINESS_SQL,/\bCREATE\b|\bALTER\b|\bDROP\b|\bGRANT\b|\bREVOKE\b/i);
});
test('62D-C8 never handles API routes, Supabase, GIS or credentials',()=>{
  assert.doesNotMatch(source,
    /process\.env|PASSWORD|PGPASSWORD|SUPABASE|sb_secret_|createServer\(|new Pool\(|fetch\(|ST_AsGeoJSON/);
  assert.match(PASS,/no database writes/);
});
