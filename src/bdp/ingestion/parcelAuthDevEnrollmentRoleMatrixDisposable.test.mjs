import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  C14B2C1_ROLE_BLOB,C14B2C1_PASS,C14B2C1_NAMES,
  requireC14B2C1Only,exactRoleSql,
} from '../../../scripts/bdp/app-auth-enrollment-roles-disposable-smoke.mjs';
import {c14b2aGitBlob} from '../../../scripts/bdp/app-auth-enrollment-atomic-disposable-plan.mjs';

const sql=readFileSync(new URL(
  '../../../server/standalone/sql/landOsEnrollmentRolesDisposable.sql',import.meta.url,
),'utf8');
const smoke=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-enrollment-roles-disposable-smoke.mjs',import.meta.url,
),'utf8');
const executor='a'.repeat(64),issuer='b'.repeat(64);
test('62D-C14B2C1 requires only explicit disposable-only flag',()=>{
  assert.equal(requireC14B2C1Only(['--disposable-only']),true);
  for(const x of [[],null,undefined,['--plan-only'],['--apply'],
    ['--disposable-only','--force'],['--apply-local-auth-only']])
    assert.throws(()=>requireC14B2C1Only(x));
});
test('62D-C14B2C1 SQL is pinned to exact reviewed Git blob',()=>{
  assert.equal(c14b2aGitBlob(sql),C14B2C1_ROLE_BLOB);
  assert.equal(C14B2C1_ROLE_BLOB.length,40);
});
test('62D-C14B2C1 replaces only two synthetic distinct random hex passwords',()=>{
  const prepared=exactRoleSql(sql,executor,issuer);
  assert.ok(!prepared.includes('__C14B2C1_'));
  assert.match(prepared,/PASSWORD 'a{64}'/);
  assert.match(prepared,/PASSWORD 'b{64}'/);
  assert.ok(sql.includes('__C14B2C1_EXECUTOR_64HEX__'));
  assert.ok(sql.includes('__C14B2C1_ISSUER_64HEX__'));
});
test('62D-C14B2C1 rejects changed source and malformed credential',()=>{
  for(const s of [null,'',sql+' ',sql.replace('NOINHERIT','INHERIT')])
    assert.throws(()=>exactRoleSql(s,executor,issuer));
  for(const bad of ['',null,'c'.repeat(63),'G'.repeat(64),'A'.repeat(64),
    'c'.repeat(65),executor])
    assert.throws(()=>exactRoleSql(sql,executor,bad));
});
test('62D-C14B2C1 guard limits exact disposable database, role and primary',()=>{
  assert.match(sql,/current_database\(\)<>'ldos_c14b_disposable'/);
  assert.match(sql,/current_user<>'postgres'/);
  assert.match(sql,/pg_is_in_recovery\(\)/);
  assert.match(sql,/current_setting\('password_encryption'\)<>'scram-sha-256'/);
});
test('62D-C14B2C1 refuses unreviewed or populated authority schema',()=>{
  for(const t of ['accounts','sessions','county_grants',
    'enrollment_requests','enrollment_approvals','enrollment_audit_events'])
    assert.ok(sql.includes('EXISTS (SELECT 1 FROM ldos_app_auth.'+t+')'),t);
});
test('62D-C14B2C1 requires five enrollment relations before role creation',()=>{
  for(const t of ['enrollment_reviewer_authorities','enrollment_invitations',
    'enrollment_requests','enrollment_approvals','enrollment_audit_events'])
    assert.ok(sql.includes("to_regclass('ldos_app_auth."+t+"') IS NULL"),t);
  assert.match(sql,/disposable_enrollment_transition\(text,uuid,text,uuid,uuid,uuid,bigint\)/);
});
test('62D-C14B2C1 refuses existing current reader and gateway login',()=>{
  assert.match(sql,/'ldos_auth_gateway_login'/);
  assert.match(sql,/'ldos_auth_account_reader'/);
  assert.match(sql,/rolname IN \(/);
});
test('62D-C14B2C1 creates exactly two credential-bound LOGINs',()=>{
  assert.equal((sql.match(/^CREATE ROLE /gm)||[]).length,4);
  assert.match(sql,/CREATE ROLE ldos_auth_enrollment_executor_login\s+LOGIN NOINHERIT/);
  assert.match(sql,/CREATE ROLE ldos_auth_review_issuer_login\s+LOGIN NOINHERIT/);
});
test('62D-C14B2C1 creates two separate locked NOLOGIN roles',()=>{
  assert.match(sql,/CREATE ROLE ldos_auth_enrollment_writer\s+NOLOGIN NOINHERIT/);
  assert.match(sql,/CREATE ROLE ldos_auth_review_issuer_writer\s+NOLOGIN NOINHERIT/);
});
test('62D-C14B2C1 all roles are non-privileged and non-inheriting',()=>{
  assert.equal((sql.match(/NOSUPERUSER NOCREATEDB NOCREATEROLE/g)||[]).length,4);
  assert.equal((sql.match(/NOREPLICATION\s+NOBYPASSRLS/g)||[]).length,4);
  assert.equal((sql.match(/NOINHERIT/g)||[]).length,4);
});
test('62D-C14B2C1 SQL has no grants, memberships or helper privileges',()=>{
  assert.doesNotMatch(sql,/^\s*GRANT |^\s*ALTER ROLE|^\s*CREATE FUNCTION |^\s*CREATE TABLE /gm);
  assert.doesNotMatch(sql,/SECURITY DEFINER|\bBYPASSRLS PASSWORD/);
});
test('62D-C14B2C1 SQL executes in a bounded transaction',()=>{
  assert.match(sql,/^BEGIN;$/m);
  assert.match(sql,/SET LOCAL lock_timeout='5s'/);
  assert.match(sql,/SET LOCAL statement_timeout='30s'/);
  assert.match(sql,/END;\n\$c14b2c1_guard\$;/);
  assert.ok(sql.trimEnd().endsWith('COMMIT;'));
});
test('62D-C14B2C1 container uses random name, no network or persistence',()=>{
  assert.match(smoke,/'ldos-c14b2c1-role-'\+randomBytes\(6\)/);
  assert.match(smoke,/'--network','none'/);
  assert.match(smoke,/'--pull','never'/);
  assert.doesNotMatch(smoke,/'--mount'|'--publish'|'--volume'/);
});
test('62D-C14B2C1 runner never references real persistent container or port',()=>{
  assert.doesNotMatch(smoke,/ldos-auth-dev-auth-postgres-1|54338|Supabase service role/i);
  assert.match(smoke,/'POSTGRES_DB='\+C14B_DB/);
  assert.match(smoke,/'image','inspect',C14B_IMAGE/);
});
test('62D-C14B2C1 loads existing exact reviewed schema and prototype',()=>{
  assert.match(smoke,/validC14BSource\(schema\)/);
  assert.match(smoke,/verifyC14B2ASource\(atomic\)/);
  assert.match(smoke,/exactRoleSql\(matrix,executor,issuer\)/);
});
test('62D-C14B2C1 passwords are randomized, synthetic, and never printed',()=>{
  assert.match(smoke,/const executor=randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(smoke,/const issuer=randomBytes\(32\)\.toString\('hex'\)/);
  assert.doesNotMatch(smoke,/process\.stdout\.write\(executor|console\.log|console\.error/);
});
test('62D-C14B2C1 verifies actual password authenticated SQL logins',()=>{
  assert.match(smoke,/'PGPASSWORD='\+secret/);
  assert.match(smoke,/'-h','127\.0\.0\.1','-U',role/);
  assert.match(smoke,/SELECT current_database\(\),current_user,session_user,pg_is_in_recovery\(\)/);
});
test('62D-C14B2C1 detects no membership or high privilege',()=>{
  assert.match(smoke,/pg_catalog\.pg_auth_members/);
  assert.match(smoke,/NOT rolinherit/);
  assert.match(smoke,/NOT rolsuper/);
  assert.match(smoke,/NOT rolbypassrls/);
  assert.match(smoke,/Array\(6\)\.fill\('t'\)/);
});
test('62D-C14B2C1 both login hashes use SCRAM-SHA-256',()=>{
  assert.match(smoke,/pg_catalog\.pg_authid/);
  assert.match(smoke,/rolpassword LIKE 'SCRAM-SHA-256\$%'/);
});
test('62D-C14B2C1 checks all 8 tables and function for zero effective grants',()=>{
  assert.equal(C14B2C1_NAMES.length,4);
  for(const name of ['accounts','sessions','county_grants','enrollment_approvals'])
    assert.ok(smoke.includes("'"+name+"'"));
  assert.match(smoke,/has_schema_privilege/);
  assert.match(smoke,/has_table_privilege/);
  assert.match(smoke,/has_function_privilege/);
});
test('62D-C14B2C1 denied direct writes, reads, role switch and function calls',()=>{
  for(const snippet of ['SELECT subject FROM ldos_app_auth.accounts;',
    'SELECT * FROM ldos_app_auth.enrollment_approvals;',
    'INSERT INTO ldos_app_auth.accounts(subject)',
    'UPDATE ldos_app_auth.enrollment_requests',
    'SET ROLE postgres;','SET ROLE ldos_auth_enrollment_writer;',
    'SET ROLE ldos_auth_review_issuer_writer;',
    'disposable_enrollment_transition(NULL,NULL,NULL,NULL,NULL,NULL,NULL)'])
    assert.ok(smoke.includes(snippet),snippet);
  assert.match(smoke,/\\b42501\\b/);
});
test('62D-C14B2C1 checks six authority tables remain empty',()=>{
  assert.match(smoke,/selected=\['accounts','sessions','county_grants','enrollment_requests'/);
  assert.match(smoke,/'0\|0\|0\|0\|0\|0'/);
  assert.match(C14B2C1_PASS,/persistent auth-dev untouched/);
});
test('62D-C14B2C1 refuses broad cleanup, removing only its own container',()=>{
  assert.match(smoke,/if\(created\)\{/);
  assert.match(smoke,/\['rm','--force','--volumes',name\]/);
  assert.doesNotMatch(smoke,/docker compose down|docker system prune/);
});
