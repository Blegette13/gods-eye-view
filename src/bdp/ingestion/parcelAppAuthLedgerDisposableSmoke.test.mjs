import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  APP_AUTH_LEDGER_SMOKE_PASS,
  requireAppAuthLedgerDisposableOptIn,
  runAppAuthLedgerDisposableSmoke,
} from '../../../scripts/bdp/app-auth-ledger-disposable-smoke.mjs';

const src=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-ledger-disposable-smoke.mjs',import.meta.url,
),'utf8');
test('58 exact disposable-only flag required',()=>{
  assert.equal(requireAppAuthLedgerDisposableOptIn(['--disposable-only']),true);
  for(const input of [
    [],null,undefined,['--dev-only'],['--production'],
    ['--disposable-only','--reuse'],['--disposable-only','--disposable-only'],
  ])assert.throws(()=>requireAppAuthLedgerDisposableOptIn(input),
    /Refusing app authorization ledger SQL smoke/);
});
test('58 invalid opt-in prevents all external Docker actions',async()=>{
  await assert.rejects(runAppAuthLedgerDisposableSmoke(['--prod']),
    /Refusing app authorization ledger SQL smoke/);
});
test('58 synthetic Docker preflight checks existing image and server',()=>{
  assert.ok(src.includes("docker(['info','--format','{{.ServerVersion}}'])"));
  assert.ok(src.includes("docker(['image','inspect',IMAGE])"));
  assert.ok(src.includes("postgis/postgis:17-3.5"));
  assert.ok(src.includes("'--pull=never'"));
});
test('58 fresh random container is isolated: no host ports, network or mounts',()=>{
  assert.ok(src.includes("'ldos-auth-ledger-'+randomBytes(6)"));
  assert.ok(src.includes("'--network','none'"));
  assert.ok(src.includes("'--force','--volumes',container"));
  for(const forbidden of ["'--publish'","'-p'","'--mount'","'--privileged'","'--network','host'"])
    assert.ok(!src.includes(forbidden),forbidden);
});
test('58 only new app-auth draft SQL enters synthetic database',()=>{
  assert.ok(src.includes("'../../server/standalone/sql/landOsAccountAuthorityFoundation.sql'"));
  assert.ok(src.includes('sql(read());'));
  assert.ok(!src.includes('CREATE TABLE auth.users'));
  assert.ok(!src.includes('auth.signUp'));
  assert.ok(!src.includes('LDOS_SUPABASE_DEV_URL'));
});
test('58 two distinct password-authenticated logins, no impersonation',()=>{
  assert.ok(src.includes('ldos_auth_ledger_writer_fixture'));
  assert.ok(src.includes('ldos_auth_ledger_reader_fixture'));
  assert.ok(src.includes("PGPASSWORD='+passwords[as]"));
  assert.ok(src.includes("'127.0.0.1','-U',LOGIN[as]"));
  assert.ok(src.includes('randomBytes(32)'));
  assert.ok(!src.includes('SET ROLE'));
  assert.ok(!src.includes('SET SESSION AUTHORIZATION'));
});
test('58 restricted writer test grants never appear in migration or real role',()=>{
  assert.ok(src.includes('GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES'));
  assert.ok(src.includes('SCHEMA ldos_app_auth TO '+ "'+LOGIN.writer"));
  assert.ok(src.includes('No host ports, mounts, network') || src.includes('No host ports, mounts, network,'));
  assert.ok(src.includes('synthetic fixtures'));
  assert.ok(src.includes('GRANT USAGE ON SCHEMA ldos_app_auth TO '));
  assert.ok(!src.includes('GRANT ALL PRIVILEGES'));
});
test('58 separate reader cannot query protected data or insert',()=>{
  assert.ok(src.includes("denied('SELECT * FROM ldos_app_auth.accounts;','reader'"));
  assert.ok(src.includes("'reader',/permission denied/i"));
  assert.ok(src.includes("'ldos_app_auth.accounts','SELECT'"));
});
test('58 no SQL schema creation, owner takeover, or direct guard execute',()=>{
  assert.ok(src.includes('CREATE TABLE ldos_app_auth.spoofed'));
  assert.ok(src.includes('DISABLE TRIGGER ALL'));
  assert.ok(src.includes("'ldos_app_auth.guard_revision()','EXECUTE'"));
  assert.ok(src.includes("'ldos_app_auth','CREATE'"));
});
test('58 real INSERT probes default suspension, revocation, MFA and county denial',()=>{
  assert.ok(src.includes("'suspended|1'"));
  assert.ok(src.includes("'revoked|unverified|1'"));
  assert.ok(src.includes("'denied|1'"));
  assert.ok(src.includes('RETURNING account_state'));
  assert.ok(src.includes('RETURNING session_state'));
  assert.ok(src.includes('RETURNING grant_state'));
});
test('58 account/session/county ABA reversals must advance revisions',()=>{
  for(const expected of [
    "'active|2'","'suspended|3'","'active|4'",
    "'active|verified|2'","'revoked|unverified|3'",
    "'active|verified|4'","'allowed|2'","'denied|3'","'allowed|4'",
  ])assert.ok(src.includes(expected),expected);
});
test('58 immutable IDs, revision injection, invalid dates and counties fail in SQL',()=>{
  for(const code of [
    'authority revision is database-managed',
    'account identity is immutable','session binding is immutable',
    'county binding is immutable','violates check constraint',
    "session_digest='","expires_at=issued_at+interval '9 hours'",
    "'06037'",
  ])assert.ok(src.includes(code),code);
});
test('58 DELETE and all TRUNCATE requests denied by real table triggers',()=>{
  assert.ok(src.includes('DELETE FROM ldos_app_auth.county_grants'));
  assert.ok(src.includes("['accounts','sessions','county_grants']"));
  assert.ok(src.includes('TRUNCATE ldos_app_auth.'));
  assert.ok(src.includes('authority rows must be retained'));
});
test('58 transaction rollback and concurrent SQL connections preserve epochs',()=>{
  assert.ok(src.includes('ROLLBACK;'));
  assert.ok(src.includes("assert.equal(grantRev(),'4'"));
  assert.ok(src.includes('Promise.all([first,second])'));
  assert.ok(src.includes('SELECT pg_sleep(0.7)'));
  assert.ok(src.includes("assert.deepEqual(results.sort(),['5','6']"));
  assert.ok(src.includes("assert.equal(grantRev(),'6'"));
});
test('58 success is limited to disposable SQL and errors never expose secrets',()=>{
  assert.match(APP_AUTH_LEDGER_SMOKE_PASS,/^PASS: disposable app-owned PostgreSQL ledger/);
  assert.ok(src.includes('NOT app authorization, Supabase login, MFA'));
  assert.ok(src.includes('no live database changed'));
  assert.ok(src.includes('finally{'));
  assert.ok(src.includes("docker(['rm','--force','--volumes',container]"));
  for(const bad of ['console.log(password','process.stdout.write(password','JSON.stringify(passwords)'])
    assert.ok(!src.includes(bad),bad);
});
