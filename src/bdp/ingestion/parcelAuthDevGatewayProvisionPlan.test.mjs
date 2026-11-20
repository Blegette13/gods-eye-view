import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  GATEWAY_ROLE,READER_ROLE,PLAN_PASS,requirePlanOnly,
  validateFutureGatewayPassword,makeFutureGatewayMigration,planSummary,
} from '../../../scripts/bdp/app-auth-local-gateway-provision-plan.mjs';

const scriptUrl=new URL('../../../scripts/bdp/app-auth-local-gateway-provision-plan.mjs',import.meta.url);
const source=readFileSync(scriptUrl,'utf8');
const synthetic='a'.repeat(64);
const sql=makeFutureGatewayMigration(synthetic);

test('62D-C9 stage permits only one explicit plan flag',()=>{
  assert.equal(requirePlanOnly(['--plan-only']),true);
  for(const args of [[],null,undefined,['--apply-local-auth-only'],
    ['--disposable-only'],['--plan-only','--force'],['--prod']])
    assert.throws(()=>requirePlanOnly(args),/Only --plan-only/);
});
test('62D-C9 rejects empty, malformed and injected password inputs',()=>{
  for(const x of [null,undefined,123,'short','A'.repeat(64),
    'a'.repeat(63),'a'.repeat(65),'a'.repeat(63)+"'",
    'a'.repeat(63)+'\n'])
    assert.equal(validateFutureGatewayPassword(x),false);
  assert.equal(validateFutureGatewayPassword(synthetic),true);
});
test('62D-C9 source SQL builder rejects any non-random-shaped credential',()=>{
  for(const x of [undefined,'',123,'x'.repeat(64)])
    assert.throws(()=>makeFutureGatewayMigration(x),/32 random bytes/);
});
test('62D-C9 script does not generate/store credentials, connect or invoke Docker',()=>{
  assert.doesNotMatch(source,/spawnSync|execSync|execFile|fetch\(|new Pool\(|process\.env|randomBytes|writeFile|mkdir|docker|createServer\(/);
});
test('62D-C9 plan reports exact local-only auth target',()=>{
  const plan=planSummary();
  assert.equal(plan.database,'ldos_auth_dev');
  assert.equal(plan.host,'127.0.0.1');
  assert.equal(plan.port,54338);
  assert.equal(plan.login,'ldos_auth_gateway_login');
  assert.equal(plan.reader,'ldos_auth_account_reader');
});
test('62D-C9 plan is immutable and discloses no plaintext credentials',()=>{
  const plan=planSummary();
  assert.ok(Object.isFrozen(plan));
  assert.equal(plan.planOnly,true);
  assert.equal(plan.applyAvailable,false);
  assert.equal(plan.persistentCredentialCreated,false);
  assert.ok(!JSON.stringify(plan).includes(synthetic));
});
test('62D-C9 canonical reader stays NOLOGIN and gateway is separate',()=>{
  assert.equal(READER_ROLE,'ldos_auth_account_reader');
  assert.equal(GATEWAY_ROLE,'ldos_auth_gateway_login');
  assert.match(sql,/CREATE ROLE ldos_auth_gateway_login LOGIN NOINHERIT NOSUPERUSER/);
  assert.doesNotMatch(sql,/ALTER ROLE ldos_auth_account_reader LOGIN/);
});
test('62D-C9 gateway has all non-admin/no-bypass SQL attributes',()=>{
  for(const token of ['NOINHERIT','NOSUPERUSER','NOCREATEDB',
    'NOCREATEROLE','NOREPLICATION','NOBYPASSRLS'])
    assert.ok(sql.includes(token),token);
});
test('62D-C9 grants exactly one SET-only membership, no direct table rights',()=>{
  assert.match(sql,/GRANT ldos_auth_account_reader TO ldos_auth_gateway_login\s+WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;/);
  assert.equal((sql.match(/^GRANT /gm)||[]).length,1);
  assert.doesNotMatch(sql,/GRANT (?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALL|USAGE)/);
});
test('62D-C9 source migration uses one transaction and short timeouts',()=>{
  assert.equal((sql.match(/^BEGIN;$/gm)||[]).length,1);
  assert.equal((sql.match(/^COMMIT;$/gm)||[]).length,1);
  assert.match(sql,/^BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';/);
  assert.ok(sql.trimEnd().endsWith('COMMIT;'));
});
test('62D-C9 SQL targets only exact auth-dev primary and operator',()=>{
  for(const x of ["current_database() <> 'ldos_auth_dev'",
    'pg_is_in_recovery()', "current_user <> 'postgres'",
    "to_regnamespace('ldos_app_auth') IS NULL"])
    assert.ok(sql.includes(x),x);
});
test('62D-C9 SQL refuses pre-existing gateway role or unexpected reader grants',()=>{
  assert.match(sql,/rolname='ldos_auth_gateway_login'/);
  assert.match(sql,/pg_catalog\.pg_auth_members/);
  assert.match(sql,/rolname='ldos_auth_account_reader'/);
  assert.match(sql,/NOT rolcanlogin AND NOT rolinherit/);
});
test('62D-C9 SQL fails closed if ledger populated or candidate RPC installed',()=>{
  for(const x of ['accounts','sessions','county_grants'])
    assert.ok(sql.includes('EXISTS (SELECT 1 FROM ldos_app_auth.'+x+')'));
  assert.match(sql,/current_county_candidate_rpc\(text,text\)/);
});
test('62D-C9 SQL has no public/API/GIS grants or account provisioning',()=>{
  assert.doesNotMatch(sql,/INSERT INTO|UPDATE ldos_app_auth|CREATE TABLE|POSTGIS|ST_AsGeoJSON|GRANT .* TO PUBLIC|auth\.users/i);
});
test('62D-C9 CLI plan can run without a database and rejects apply',()=>{
  const entry=fileURLToPath(scriptUrl);
  const ok=spawnSync(process.execPath,[entry,'--plan-only'],{
    encoding:'utf8',windowsHide:true,timeout:10000,
  });
  assert.equal(ok.status,0);
  assert.equal(ok.stdout.trim(),PLAN_PASS);
  const denied=spawnSync(process.execPath,[entry,'--apply-local-auth-only'],{
    encoding:'utf8',windowsHide:true,timeout:10000,
  });
  assert.notEqual(denied.status,0);
  assert.equal(denied.stdout,'');
  assert.match(denied.stderr,/no database access or writes/);
});
