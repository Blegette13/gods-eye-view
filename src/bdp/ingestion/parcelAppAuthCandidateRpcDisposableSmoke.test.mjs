import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  APP_AUTH_CANDIDATE_SMOKE_PASS,
  requireCandidateRpcDisposableOptIn,
  runAppAuthCandidateRpcDisposableSmoke,
} from '../../../scripts/bdp/app-auth-candidate-rpc-disposable-smoke.mjs';

const sql=readFileSync(new URL(
  '../../../server/standalone/sql/landOsCurrentCountyCandidateRpc.sql',
  import.meta.url,
),'utf8');
const smoke=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-candidate-rpc-disposable-smoke.mjs',
  import.meta.url,
),'utf8');

test('59 must require one explicit disposable-only flag before any Docker work',()=>{
  assert.equal(requireCandidateRpcDisposableOptIn(['--disposable-only']),true);
  for(const invalid of [
    null,undefined,[],['--prod'],['--dev-only'],['--disposable-only','--force'],
    ['--disposable-only','--disposable-only'],
  ])assert.throws(()=>requireCandidateRpcDisposableOptIn(invalid),
    /Refusing app candidate RPC SQL smoke/);
});
test('59 malformed opt-in fails asynchronously without contacting Docker',async()=>{
  await assert.rejects(runAppAuthCandidateRpcDisposableSmoke(['--prod']),
    /Refusing app candidate RPC SQL smoke/);
});
test('59 SQL migration is a separate unexecuted atomic function draft',()=>{
  assert.match(sql,/^BEGIN;$/m);
  assert.match(sql,/^COMMIT;$/m);
  assert.match(sql,/NEVER apply to Supabase Auth/);
  assert.match(sql,/CREATE FUNCTION ldos_app_auth\.current_county_candidate_rpc/);
  assert.doesNotMatch(sql,/CREATE TABLE|CREATE ROLE|CREATE USER|INSERT INTO/);
});
test('59 function accepts only fixed digest and county text',()=>{
  assert.match(sql,/p_session_digest text/);
  assert.match(sql,/p_county_fips text/);
  assert.ok(sql.includes("p_session_digest ~ '^[0-9a-f]{64}$'"));
  assert.ok(sql.includes("p_county_fips ~ '^48[0-9]{3}$'"));
  assert.doesNotMatch(sql,/EXECUTE\s+format\(|EXECUTE\s+\w+\s*\|\|/i);
});
test('59 private candidate function returns only three BIGINT epoch fields',()=>{
  for(const label of [
    'account_epoch bigint','session_epoch bigint','county_grant_epoch bigint',
  ])assert.ok(sql.includes(label),label);
  assert.doesNotMatch(sql,/RETURNS SETOF.*(?:accounts|sessions)|ST_AsGeoJSON/);
  assert.doesNotMatch(sql,/RETURNS TABLE\s*\([^)]*\b(?:subject|email|owner|geometry|password)\b/s);
});
test('59 SQL checks actual current account, session, MFA, county and time',()=>{
  for(const predicate of [
    "s.session_state = 'active'",
    "s.mfa_state = 'verified'",
    "a.account_state = 'active'",
    "g.grant_state = 'allowed'",
    's.issued_at <= clock_timestamp()',
    's.expires_at > clock_timestamp()',
  ])assert.ok(sql.includes(predicate),predicate);
});
test('59 no missing grant or different county can match by join',()=>{
  assert.match(sql,/g\.subject = a\.subject/);
  assert.match(sql,/g\.county_fips = p_county_fips/);
  assert.match(sql,/s\.session_digest = p_session_digest/);
  assert.match(sql,/a\.subject = s\.subject/);
});
test('59 definer SQL uses pinned pg_catalog only and explicit fully-qualified tables',()=>{
  assert.match(sql,/LANGUAGE sql\s+VOLATILE\s+PARALLEL UNSAFE\s+SECURITY DEFINER/);
  assert.match(sql,/SET search_path = pg_catalog, pg_temp/);
  for(const t of ['accounts','sessions','county_grants'])
    assert.ok(sql.includes('ldos_app_auth.'+t),t);
});
test('59 function PUBLIC EXECUTE is revoked in same transaction before commit',()=>{
  assert.match(sql,/REVOKE ALL ON FUNCTION ldos_app_auth\.current_county_candidate_rpc\(text,text\)\s+FROM PUBLIC;/);
  assert.doesNotMatch(sql,/^\s*GRANT /m);
});
test('59 draft does not create a permission verdict or GIS release response',()=>{
  assert.match(sql,/CANDIDATE EVIDENCE, NOT release authorization/);
  assert.doesNotMatch(sql,/releaseAuthorized|canPublish|allowExport|approvedGIS/);
  assert.doesNotMatch(sql,/geometry|parcel_data_table|auth\.users/gi);
});
test('59 disposable probe uses exactly one new networkless container with cleanup',()=>{
  assert.ok(smoke.includes('postgis/postgis:17-3.5'));
  assert.ok(smoke.includes("'--network','none'"));
  assert.ok(smoke.includes("'--pull=never'"));
  assert.ok(smoke.includes("'ldos-auth-candidate-'+randomBytes(6)"));
  assert.ok(smoke.includes("docker(['rm','--force','--volumes',container]"));
  for(const p of ["'--publish'","'-p'","'--mount'","'--privileged'","'--network','host'"])
    assert.ok(!smoke.includes(p),p);
});
test('59 separate reader and blocked logins are least-privileged synthetic roles',()=>{
  for(const term of [
    'ldos_auth_candidate_reader_fixture',
    'ldos_auth_candidate_blocked_fixture',
    'NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE ',
    'NOREPLICATION NOBYPASSRLS PASSWORD ',
    'has_table_privilege','has_schema_privilege',
  ])assert.ok(smoke.includes(term),term);
  assert.doesNotMatch(smoke,/SET ROLE|SET SESSION AUTHORIZATION/);
});
test('59 test grants only exact candidate function to one synthetic reader',()=>{
  assert.ok(smoke.includes("'GRANT EXECUTE ON FUNCTION '+RPC+' TO '+ROLE.reader"));
  assert.ok(smoke.includes("'reader'") || smoke.includes('ROLE.reader'));
  assert.ok(smoke.includes('aclexplode(coalesce(p.proacl,acldefault('));
  assert.ok(smoke.includes('acl.grantee=0'));
  assert.ok(smoke.includes("'EXECUTE';"));
  assert.ok(!smoke.includes('GRANT SELECT ON ALL TABLES'));
});
test('59 true SQL role testing forbids raw table reads and function renaming',()=>{
  for(const term of [
    'SELECT * FROM ldos_app_auth.accounts;',
    'SELECT * FROM ldos_app_auth.sessions;',
    'SELECT * FROM ldos_app_auth.county_grants;',
    'CREATE TABLE ldos_app_auth.escape(x integer);',
    'ALTER FUNCTION ',
  ])assert.ok(smoke.includes(term),term);
  assert.ok(smoke.includes("denied(candidate(),'blocked'"));
});
test('59 source, digest and county fail closed before returning any candidate',()=>{
  for(const term of [
    "assert.equal(sql(candidate(),'reader'),'','deny-by-default",
    "'b'.repeat(64)","'48029'","'06037'",
    "'A'.repeat(64)","'a'.repeat(63)",
  ])assert.ok(smoke.includes(term),term);
});
test('59 ABA changes affect each of three independent epoch columns',()=>{
  for(const expected of [
    "'2|2|2'","'2|2|4'","'4|2|4'","'4|4|4'","'4|6|4'",
  ])assert.ok(smoke.includes(expected),expected);
  for(const deniedState of [
    "grant_state='denied'","account_state='suspended'",
    "mfa_state='unverified'","session_state='revoked'",
  ])assert.ok(smoke.includes(deniedState),deniedState);
});
test('59 expired and future-issued sessions fail despite currently allowed flags',()=>{
  assert.ok(smoke.includes("expires_at=clock_timestamp()-interval '1 second'"));
  assert.ok(smoke.includes("clock_timestamp()+interval '10 minutes'"));
  assert.ok(smoke.includes('expired session must deny'));
  assert.ok(smoke.includes('future-issued session fail closed'));
});
test('59 generic failure output never discloses project credentials or SQL statements',()=>{
  assert.match(APP_AUTH_CANDIDATE_SMOKE_PASS,/^PASS: disposable app-owned current-candidate RPC/);
  assert.match(APP_AUTH_CANDIDATE_SMOKE_PASS,/no geometry authorized/);
  assert.match(smoke,/Disposable app-candidate RPC proof failed at/);
  assert.doesNotMatch(smoke,/LDOS_SUPABASE_DEV_URL|process\.env\./);
  assert.doesNotMatch(smoke,/passwords\]|console\.log\(password|JSON\.stringify\(password/);
});
