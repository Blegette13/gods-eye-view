import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ROLE,PASS,PREFLIGHT_OK,POSTFLIGHT_OK,requireFlag,makeRoleMigration,
  PREFLIGHT_SQL,POSTFLIGHT_SQL,verifyPreflight,verifyPostflight,planSummary,
  runLocalReaderRoleMigration,
} from '../../../scripts/bdp/app-auth-local-reader-role-migration.mjs';

const sql=makeRoleMigration();
test('62D-C5 explicit plan/apply flags only',()=>{
  for(const opt of ['--plan-only','--apply-local-auth-only'])
    assert.equal(requireFlag([opt]),opt);
  for(const opts of [null,[],['--apply'],['--prod'],['--apply-local-auth-only','--force'],
    ['--plan-only','--apply-local-auth-only']])assert.throws(()=>requireFlag(opts));
});
test('62D-C5 single atomic guarded role migration with timeouts',()=>{
  assert.equal((sql.match(/^BEGIN;$/gm)||[]).length,1);
  assert.equal((sql.match(/^COMMIT;$/gm)||[]).length,1);
  assert.match(sql,/^BEGIN;\nSET LOCAL lock_timeout/);
  assert.ok(sql.trimEnd().endsWith('COMMIT;'));
});
test('62D-C5 validates exact primary DB and absent role before changes',()=>{
  for(const fragment of ["current_database() <> 'ldos_auth_dev'",'pg_is_in_recovery()',
    "current_user <> 'postgres'","to_regnamespace('ldos_app_auth') IS NULL",
    "rolname = 'ldos_auth_account_reader'",'RAISE EXCEPTION'])
    assert.ok(sql.includes(fragment),fragment);
});
test('62D-C5 requires all ledger tables but refuses nonempty ones',()=>{
  for(const name of ['accounts','sessions','county_grants']){
    assert.ok(sql.includes(`to_regclass('ldos_app_auth.${name}') IS NULL`));
    assert.ok(sql.includes(`EXISTS (SELECT 1 FROM ldos_app_auth.${name})`));
  }
});
test('62D-C5 disallows pre-installed candidate RPC',()=>{
  assert.match(sql,/to_regprocedure\('ldos_app_auth.current_county_candidate_rpc\(text,text\)'\) IS NOT NULL/);
});
test('62D-C5 creates only named NOLOGIN NOINHERIT unprivileged role',()=>{
  assert.equal(ROLE,'ldos_auth_account_reader');
  assert.match(sql,/CREATE ROLE ldos_auth_account_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;/);
  assert.equal((sql.match(/CREATE ROLE /g)||[]).length,1);
});
test('62D-C5 grants schema USAGE and three precise account columns only',()=>{
  assert.match(sql,/GRANT USAGE ON SCHEMA ldos_app_auth TO ldos_auth_account_reader;/);
  assert.match(sql,/GRANT SELECT \(subject, account_state, revision\)\s+ON TABLE ldos_app_auth.accounts TO ldos_auth_account_reader;/);
  assert.equal((sql.match(/GRANT SELECT/g)||[]).length,1);
});
test('62D-C5 does not issue credentials, provision users or touch GIS',()=>{
  assert.doesNotMatch(sql,/PASSWORD|LOGIN\b(?! NO)|INSERT INTO|UPDATE ldos_app_auth|ALTER ROLE|CREATE FUNCTION|GRANT (INSERT|UPDATE|DELETE|TRUNCATE|EXECUTE)|POSTGIS|bdp_parcel/i);
});
test('62D-C5 read-only preflight requires exact empty ledger and no reader',()=>{
  assert.equal(verifyPreflight(PREFLIGHT_OK+'\n'),true);
  for(const v of [PREFLIGHT_OK.replace('|0|0|0|','|1|0|0|'),
    'ldos_auth_dev|t|t|0|0|0|t|t','ldos_auth_dev|f|t|0|0|0|f|t',
    'ldos_auth_dev|f|t|0|0|0|t|f','postgres|f|t|0|0|0|t|t',''])
    assert.throws(()=>verifyPreflight(v));
  assert.match(PREFLIGHT_SQL,/current_database\(\)/);
  assert.match(PREFLIGHT_SQL,/to_regprocedure/);
});
test('62D-C5 read-only postflight requires exact local result',()=>{
  assert.equal(verifyPostflight(POSTFLIGHT_OK),true);
  for(const v of [POSTFLIGHT_OK.replace('|0|0|0|','|0|1|0|'),
    'ldos_auth_dev|f|t|0|0|0|f','ldos_auth_dev|t|t|0|0|0|t',''])
    assert.throws(()=>verifyPostflight(v));
});
test('62D-C5 postflight confirms role restrictions including no login/membership',()=>{
  for(const x of ['NOT rolcanlogin','NOT rolsuper','NOT rolcreatedb',
    'NOT rolcreaterole','NOT rolreplication','NOT rolbypassrls','NOT rolinherit',
    'NOT EXISTS (SELECT 1 FROM pg_auth_members'])assert.ok(POSTFLIGHT_SQL.includes(x));
});
test('62D-C5 postflight rejects non-account reads and account created_at',()=>{
  for(const x of ["accounts','created_at','SELECT","ldos_app_auth.sessions','SELECT",
    "ldos_app_auth.county_grants','SELECT"])assert.ok(POSTFLIGHT_SQL.includes(x));
});
test('62D-C5 postflight allows only account subject state revision SELECT',()=>{
  for(const col of ['subject','account_state','revision'])
    assert.ok(POSTFLIGHT_SQL.includes(`'ldos_app_auth.accounts','${col}','SELECT'`));
});
test('62D-C5 postflight rejects writes/DDL/routine EXECUTE',()=>{
  for(const right of ['INSERT','UPDATE','DELETE','TRUNCATE'])
    assert.ok(POSTFLIGHT_SQL.includes(`'ldos_app_auth.accounts','${right}'`));
  assert.match(POSTFLIGHT_SQL,/guard_revision\(\).*EXECUTE/);
  assert.match(POSTFLIGHT_SQL,/ldos_app_auth','CREATE/);
});
test('62D-C5 plan-only is safe and reports NOLOGIN',()=>{
  assert.deepEqual(planSummary(),{
    db:'ldos_auth_dev',container:'ldos-auth-dev-auth-postgres-1',role:ROLE,
    login:false,createsPassword:false,createsUsers:false,
    grantsAccountColumnSelect:true,grantsSessionRead:false,
    grantsCountyRead:false,grantsWrite:false,grantsGisRights:false,
  });
  assert.deepEqual(runLocalReaderRoleMigration(['--plan-only']),planSummary());
});
test('62D-C5 source contains no app SQL driver, external API or secret disclosure',()=>{
  const source=readFileSync(new URL(
    '../../../scripts/bdp/app-auth-local-reader-role-migration.mjs',import.meta.url,
  ),'utf8');
  assert.doesNotMatch(source,/new Pool\(|createServer\(|SUPABASE|sb_secret_|fetch\(|PGPASSWORD/);
  assert.match(PASS,/NOLOGIN account reader/);
});
