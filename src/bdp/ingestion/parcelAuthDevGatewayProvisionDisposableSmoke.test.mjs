import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  IMAGE,PASS,POSTFLIGHT,ATTESTATION,
  requireDisposableOnly,extractC11Sql,
} from '../../../scripts/bdp/app-auth-gateway-provision-disposable-smoke.mjs';
import {AUTH_DEV_ROLE_SWITCH_ATTEST_SQL} from '../../../server/providers/bdp-auth-dev-role-switch-pg.js';
import {PRIMARY_ACCOUNT_SQL} from '../../../server/providers/bdp-primary-account-reader.js';

const smoke=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-gateway-provision-disposable-smoke.mjs',import.meta.url,
),'utf8');
const c11=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-dev-gateway-provision.ps1',import.meta.url,
),'utf8');
const password='a'.repeat(64);
const sql=extractC11Sql(c11,password);

test('62D-C11D never runs real SQL without one disposable-only opt-in',()=>{
  assert.equal(requireDisposableOnly(['--disposable-only']),true);
  for(const x of [[],null,undefined,['--apply-local-auth-only'],['--plan-only'],
    ['--disposable-only','--force'],['--prod']])
    assert.throws(()=>requireDisposableOnly(x));
});
test('62D-C11D runs only existing local PostgreSQL 17 image',()=>{
  assert.equal(IMAGE,'postgres:17');
  assert.match(smoke,/'image','inspect',IMAGE/);
  assert.match(smoke,/'--pull','never'/);
});
test('62D-C11D disposable database has no network, ports or mounts',()=>{
  assert.match(smoke,/'--network','none'/);
  assert.doesNotMatch(smoke,/'-p'|'--publish'|'--network','bridge'|'--mount'/);
});
test('62D-C11D uses randomly named container and scoped removal',()=>{
  assert.match(smoke,/'ldos-c11-credential-'\+randomBytes\(6\)/);
  assert.match(smoke,/if\(created\)\{/);
  assert.match(smoke,/\['rm','--force','--volumes',name\]/);
  assert.doesNotMatch(smoke,/docker compose down|docker system prune/);
});
test('62D-C11D never references the actual persistent container or port',()=>{
  assert.doesNotMatch(smoke,/ldos-auth-dev-auth-postgres-1|54338/);
  assert.match(smoke,/'POSTGRES_DB=ldos_auth_dev'/);
});
test('62D-C11D extraction requires reviewed fixed C11 SQL here strings',()=>{
  assert.match(sql.migration,/^BEGIN;\n/);
  assert.match(sql.migration,/END;\n\$ldos_c11_guard\$;/);
  assert.ok(sql.migration.trimEnd().endsWith('COMMIT;'));
  assert.ok(sql.postflight.trim().startsWith('SELECT'));
});
test('62D-C11D extraction rejects malformed or missing source',()=>{
  for(const x of [null,undefined,{},'',"random text",c11.replace("$sql = @'","$sql = @\""),
    c11.replace("END;\n$ldos_c11_guard$;","END\n$ldos_c11_guard$;")])
    assert.throws(()=>extractC11Sql(x,password));
});
test('62D-C11D extraction denies injected/malformed synthetic credentials',()=>{
  for(const x of [null,undefined,123,'short','G'.repeat(64),
    'a'.repeat(63),'a'.repeat(63)+"'",'a'.repeat(65)])
    assert.throws(()=>extractC11Sql(c11,x));
});
test('62D-C11D exact SQL uses synthetic fixture without modifying source',()=>{
  assert.match(sql.migration,/PASSWORD 'a{64}';/);
  assert.ok(!sql.migration.includes('__C11_HEX_CREDENTIAL__'));
  assert.ok(c11.includes('__C11_HEX_CREDENTIAL__'));
  assert.ok(Object.isFrozen(sql));
});
test('62D-C11D exact SQL grants only a SET-only reader role membership',()=>{
  assert.match(sql.migration,/CREATE ROLE ldos_auth_gateway_login LOGIN NOINHERIT NOSUPERUSER/);
  assert.match(sql.migration,/GRANT ldos_auth_account_reader TO ldos_auth_gateway_login\s+WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;/);
  assert.doesNotMatch(sql.migration,/GRANT SELECT|GRANT ALL|INSERT INTO|UPDATE ldos_app_auth/);
});
test('62D-C11D SQL guard validates primary, absence of gateway and empty ledger',()=>{
  for(const x of ["current_database() <> 'ldos_auth_dev'",
    "rolname='ldos_auth_gateway_login'",'pg_is_in_recovery()',
    'current_setting(\'password_encryption\')'])
    assert.ok(sql.migration.includes(x),x);
  for(const tbl of ['accounts','sessions','county_grants'])
    assert.ok(sql.migration.includes('EXISTS (SELECT 1 FROM ldos_app_auth.'+tbl+')'));
});
test('62D-C11D actually applies ledger and canonical C5 NOLOGIN reader in test container',()=>{
  assert.match(smoke,/landOsAccountAuthorityFoundation\.sql/);
  assert.match(smoke,/makeRoleMigration\(\)/);
  assert.match(smoke,/psql\(sql\.migration\)/);
});
test('62D-C11D verifies genuine synthetic password-authenticated gateway',()=>{
  assert.match(smoke,/'-e','PGPASSWORD='\+loginPassword/);
  assert.match(smoke,/'-h','127\.0\.0\.1','-U','ldos_auth_gateway_login'/);
  assert.match(smoke,/ldos_auth_gateway_login\|ldos_auth_gateway_login/);
});
test('62D-C11D validates all 19 read-only canonical SQL privilege attestations',()=>{
  assert.equal(ATTESTATION.split('|').length,19);
  assert.ok(ATTESTATION.split('|').every(x=>x==='t'));
  assert.ok(smoke.includes('AUTH_DEV_ROLE_SWITCH_ATTEST_SQL'));
  assert.ok(smoke.includes('PRIMARY_ACCOUNT_SQL'));
  assert.match(AUTH_DEV_ROLE_SWITCH_ATTEST_SQL,/correct_login/);
  assert.match(PRIMARY_ACCOUNT_SQL,/ldos_auth_account_reader/);
});
test('62D-C11D verifies denied direct reads and role escalation',()=>{
  for(const frag of ['SELECT subject FROM ldos_app_auth.accounts;',
    'SELECT * FROM ldos_app_auth.sessions;',
    'SELECT * FROM ldos_app_auth.county_grants;',
    'SET ROLE postgres;'])assert.ok(smoke.includes(frag),frag);
});
test('62D-C11D exact postflight expects no direct table rights',()=>{
  assert.equal(POSTFLIGHT,'ldos_auth_dev|f|t|t|t|t|t|t|t|t');
  assert.match(sql.postflight,/NOT has_table_privilege/);
  assert.match(smoke,/assert\.equal\(psql\(sql\.postflight\),POSTFLIGHT\)/);
});
test('62D-C11D duplicate migration must be denied',()=>{
  assert.match(smoke,/const duplicate=psql\(sql\.migration,\{raw:true\}\)/);
  assert.match(smoke,/assert\.notEqual\(duplicate\.status,0\)/);
});
test('62D-C11D failure messages do not print fixture SQL or credentials',()=>{
  assert.match(smoke,/persistent databases not targeted/);
  assert.match(smoke,/cleanup unconfirmed/);
  assert.doesNotMatch(smoke,/console\.log|console\.error|process\.env|createServer\(|sb_secret_|SUPABASE/);
  assert.match(PASS,/persistent auth-dev untouched/);
});
