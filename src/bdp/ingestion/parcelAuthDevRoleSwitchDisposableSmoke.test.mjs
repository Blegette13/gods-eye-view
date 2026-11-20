import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PASS,IMAGE,GATEWAY,SUBJECT,ATTEST_EXPECTED,
  requireDisposableFlag,gatewayRoleSql,roleReadOnlySql,
} from '../../../scripts/bdp/app-auth-role-switch-disposable-smoke.mjs';
import {PRIMARY_ACCOUNT_SQL} from '../../../server/providers/bdp-primary-account-reader.js';
import {AUTH_DEV_ROLE_SWITCH_ATTEST_SQL} from '../../../server/providers/bdp-auth-dev-role-switch-pg.js';

const PASSWORD='a'.repeat(64);
const roleSql=gatewayRoleSql(PASSWORD);
const readSql=roleReadOnlySql();
const source=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-role-switch-disposable-smoke.mjs',
  import.meta.url,
),'utf8');

test('62D-C7 requires exactly --disposable-only',()=>{
  assert.equal(requireDisposableFlag(['--disposable-only']),true);
  for(const args of [null,undefined,[],['--plan-only'],['--apply-local-auth-only'],
    ['--disposable-only','--force'],['--prod']])
    assert.throws(()=>requireDisposableFlag(args));
});
test('62D-C7 synthetic role credential must be a 64-digit hex token',()=>{
  for(const x of [null,undefined,123,'short','G'.repeat(64),'a'.repeat(63),
    'a'.repeat(65)])assert.throws(()=>gatewayRoleSql(x));
  assert.match(roleSql,/PASSWORD 'a{64}';/);
});
test('62D-C7 gateway is dedicated LOGIN with no elevation or role inheritance',()=>{
  assert.equal(GATEWAY,'ldos_auth_gateway_login');
  assert.match(roleSql,/CREATE ROLE ldos_auth_gateway_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.doesNotMatch(roleSql,/\b(?:SUPERUSER|CREATEROLE|BYPASSRLS)\b/);
});
test('62D-C7 SQL grants one SET-only role membership and no direct table grants',()=>{
  assert.match(roleSql,/GRANT ldos_auth_account_reader TO ldos_auth_gateway_login\s+WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;/);
  assert.doesNotMatch(roleSql,/GRANT SELECT|GRANT ALL|GRANT USAGE|GRANT CREATE/);
});
test('62D-C7 SQL guards exact synthetic DB and expected roles',()=>{
  for(const x of ["current_database() <> 'ldos_auth_dev'",
    'pg_is_in_recovery()',"current_user <> 'postgres'",
    "rolname='ldos_auth_account_reader'",
    "rolname='ldos_auth_gateway_login'"])
    assert.ok(roleSql.includes(x),x);
});
test('62D-C7 gateway SQL atomic and time bounded',()=>{
  assert.ok(roleSql.startsWith("BEGIN;\nSET LOCAL lock_timeout"));
  assert.ok(roleSql.endsWith('COMMIT;'));
  assert.equal((roleSql.match(/^BEGIN;$/gm)||[]).length,1);
  assert.equal((roleSql.match(/^COMMIT;$/gm)||[]).length,1);
});
test('62D-C7 fixed SQL uses only a read-only transaction and SET LOCAL ROLE',()=>{
  assert.ok(readSql.startsWith('BEGIN READ ONLY;\nSET LOCAL ROLE ldos_auth_account_reader;'));
  assert.ok(readSql.endsWith('\nROLLBACK;'));
  // The attestation SQL legitimately lists INSERT/UPDATE/DELETE/TRUNCATE
  // as privilege names. Reject executable write statements instead.
  assert.doesNotMatch(readSql,
    /^\s*(?:COMMIT|INSERT\s+INTO|UPDATE\s+ldos_app_auth|DELETE\s+FROM|TRUNCATE)\b/im);
});
test('62D-C7 role-switch read uses exact attestation and fixed SQL',()=>{
  assert.ok(readSql.includes(AUTH_DEV_ROLE_SWITCH_ATTEST_SQL+';'));
  assert.ok(readSql.includes('PREPARE ldos_read_account(uuid) AS '+PRIMARY_ACCOUNT_SQL+';'));
  assert.match(readSql,/EXECUTE ldos_read_account/);
});
test('62D-C7 role-switch disallows caller-chosen subject',()=>{
  assert.equal(SUBJECT,'11111111-1111-4111-8111-111111111111');
  assert.throws(()=>roleReadOnlySql('22222222-2222-4222-8222-222222222222'));
});
test('62D-C7 exact boolean privilege proof expects nineteen true values',()=>{
  assert.equal(ATTEST_EXPECTED.split('|').length,19);
  assert.ok(ATTEST_EXPECTED.split('|').every(x=>x==='t'));
});
test('62D-C7 uses existing local postgres:17 image without downloading',()=>{
  assert.equal(IMAGE,'postgres:17');
  assert.match(source,/'image','inspect',IMAGE/);
  assert.match(source,/'--pull','never'/);
});
test('62D-C7 Docker container has no external network/ports/mounts/volumes',()=>{
  assert.match(source,/'--network','none'/);
  assert.doesNotMatch(source,/'-p'|'--publish'|'--mount'|'--volume'|'--network','bridge'/);
});
test('62D-C7 uses random disposable container name, only scoped cleanup',()=>{
  assert.match(source,/'ldos-auth-role-switch-'\+randomBytes\(6\)/);
  assert.match(source,/if\(created\)\{/);
  assert.match(source,/\['rm','--force','--volumes',name\]/);
  assert.doesNotMatch(source,/docker compose down|docker system prune/);
});
test('62D-C7 uses disposable password login, never the persistent container',()=>{
  assert.match(source,/'-h','127\.0\.0\.1','-U',GATEWAY/);
  assert.match(source,/PGPASSWORD='\+gatewayPassword/);
  assert.doesNotMatch(source,/ldos-auth-dev-auth-postgres-1|54338|docker-compose\.auth-dev/);
});
test('62D-C7 checks denied writes, hidden account column and unrelated tables',()=>{
  for(const x of ['SELECT created_at','ldos_app_auth.sessions',
    'ldos_app_auth.county_grants','UPDATE ldos_app_auth.accounts',
    'CREATE TABLE ldos_app_auth.escape'])assert.ok(source.includes(x),x);
});
test('62D-C7 errors intentionally exclude SQL, identifiers and credentials',()=>{
  assert.match(source,/persistent databases not targeted/);
  assert.match(source,/cleanup unconfirmed/);
  assert.doesNotMatch(source,/console\.log|console\.error|createServer\(|SUPABASE|sb_secret_|process\.env|https?:\/\//);
  assert.match(PASS,/persistent auth-dev untouched/);
});
