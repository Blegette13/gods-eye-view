import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  C14B2A_SQL_BLOB,C14B2A_PLAN_PASS,requireC14B2APlanOnly,
  c14b2aGitBlob,verifyC14B2ASource,
} from '../../../scripts/bdp/app-auth-enrollment-atomic-disposable-plan.mjs';

const script=new URL(
  '../../../scripts/bdp/app-auth-enrollment-atomic-disposable-plan.mjs',
  import.meta.url);
const source=readFileSync(new URL(
  '../../../server/standalone/sql/landOsEnrollmentAtomicDisposable.sql',
  import.meta.url),'utf8');
const runner=readFileSync(script,'utf8');

test('62D-C14B2A requires only an explicit plan-only operation',()=>{
  assert.equal(requireC14B2APlanOnly(['--plan-only']),true);
  for(const args of [[],null,undefined,['--apply'],['--disposable-only'],
    ['--plan-only','--force'],['--apply-local-auth-only']])
    assert.throws(()=>requireC14B2APlanOnly(args));
});
test('62D-C14B2A source is pinned to exact reviewed Git blob',()=>{
  assert.equal(c14b2aGitBlob(source),C14B2A_SQL_BLOB);
  assert.equal(C14B2A_SQL_BLOB.length,40);
  assert.equal(verifyC14B2ASource(source),true);
});
test('62D-C14B2A rejects altered or missing transaction SQL',()=>{
  for(const modified of ['',null,undefined,{},source+' ',
    source.replace('SECURITY INVOKER','SECURITY DEFINER'),
    source.replace('ldos_c14b_disposable','ldos_auth_dev')])
    assert.throws(()=>verifyC14B2ASource(modified));
});
test('62D-C14B2A plan code never opens Docker or PostgreSQL',()=>{
  assert.doesNotMatch(runner,/spawnSync|docker|new Pool|psql|fetch\(|createServer\(|process\.env/);
  assert.match(runner,/runC14B2APlanOnly/);
  assert.match(runner,/verifyC14B2ASource\(source\)/);
});
test('62D-C14B2A CLI plan prints a fixed safe line and refuses apply',()=>{
  const filename=fileURLToPath(script);
  const run=option=>spawnSync(process.execPath,[filename,option],{
    encoding:'utf8',windowsHide:true,timeout:10000,
  });
  const ok=run('--plan-only');
  assert.equal(ok.status,0);
  assert.equal(ok.stdout.trim(),C14B2A_PLAN_PASS);
  const bad=run('--apply-local-auth-only');
  assert.notEqual(bad.status,0);
  assert.equal(bad.stdout,'');
  assert.match(bad.stderr,/no database access or writes/);
});
test('62D-C14B2A schema requires isolated local disposable database',()=>{
  assert.match(source,/current_database\(\) <> 'ldos_c14b_disposable'/);
  assert.match(source,/current_user <> 'postgres'/);
  assert.match(source,/pg_is_in_recovery\(\)/);
  assert.match(source,/to_regclass\('ldos_app_auth.enrollment_requests'\) IS NULL/);
});
test('62D-C14B2A guard requires the five already staged review relations',()=>{
  for(const table of ['enrollment_reviewer_authorities','enrollment_invitations',
    'enrollment_requests','enrollment_approvals','enrollment_audit_events'])
    assert.ok(source.includes("to_regclass('ldos_app_auth."+table+"') IS NULL"),table);
});
test('62D-C14B2A never targets production auth-dev or parcel GIS',()=>{
  assert.doesNotMatch(source,/ldos_auth_dev|ST_AsGeoJSON|bdp_postgis|auth\.users|public\.\w+/i);
  assert.doesNotMatch(source,/CREATE ROLE|GRANT SELECT|CREATE EXTENSION/);
});
test('62D-C14B2A refuses existing gateway and prospective writer roles',()=>{
  assert.match(source,/rolname IN \('ldos_auth_gateway_login',\s*'ldos_auth_enrollment_writer'\)/);
  assert.doesNotMatch(source,/^\s*GRANT /gm);
});
test('62D-C14B2A applies one bounded transactional function declaration',()=>{
  assert.equal((source.match(/^CREATE FUNCTION /gm)||[]).length,1);
  assert.match(source,/^BEGIN;$/m);
  assert.match(source,/^COMMIT;$/m);
  assert.match(source,/SET LOCAL lock_timeout='5s';/);
  assert.match(source,/SET LOCAL statement_timeout='30s';/);
});
test('62D-C14B2A function uses SECURITY INVOKER and protected search path',()=>{
  assert.match(source,/CREATE FUNCTION ldos_app_auth.disposable_enrollment_transition\(/);
  assert.match(source,/RETURNS bigint\s+LANGUAGE plpgsql\s+SECURITY INVOKER/);
  assert.match(source,/SET search_path=pg_catalog,pg_temp/);
  assert.doesNotMatch(source,/SECURITY DEFINER/);
});
test('62D-C14B2A function has no browser or existing database login grant',()=>{
  assert.match(source,/REVOKE ALL ON FUNCTION ldos_app_auth.disposable_enrollment_transition\(/);
  assert.match(source,/\) FROM PUBLIC;\s*COMMIT;$/);
  assert.doesNotMatch(source,/CREATE POLICY|CREATE ROLE|ALTER ROLE|GRANT EXECUTE/);
});
test('62D-C14B2A requires serializable, writable, primary-only transaction',()=>{
  assert.match(source,/current_setting\('transaction_isolation'\)<>'serializable'/);
  assert.match(source,/current_setting\('transaction_read_only'\)<>'off'/);
  assert.match(source,/pg_is_in_recovery\(\)/);
  assert.match(source,/current_user<>'postgres'/);
});
test('62D-C14B2A input UUID and issuer must be bounded and present',()=>{
  for(const text of ['p_phase IS NULL','p_subject IS NULL','p_request_id IS NULL',
    'p_approval_id IS NULL','p_audit_id IS NULL','p_issuer IS NULL',
    "p_issuer !~ '^https://[a-z0-9]{8,40}[.]supabase[.]co/auth/v1$'"])
    assert.ok(source.includes(text),text);
});
test('62D-C14B2A requires separate enroll and activate phases',()=>{
  assert.match(source,/p_phase NOT IN \('enroll_suspended','activate'\)/);
  assert.match(source,/p_expected_account_revision IS NOT NULL/);
  assert.match(source,/p_expected_account_revision IS NULL/);
  assert.match(source,/p_expected_account_revision<1/);
});
test('62D-C14B2A row locks are acquired for review and account authority',()=>{
  for(const table of ['enrollment_requests','enrollment_invitations',
    'enrollment_reviewer_authorities','enrollment_approvals','accounts'])
    assert.ok(source.includes('FROM ldos_app_auth.'+table),table);
  assert.equal((source.match(/FOR UPDATE;/g)||[]).length,6);
});
test('62D-C14B2A review request must match subject and exact pinned issuer',()=>{
  assert.match(source,/WHERE request_id=p_request_id AND subject=p_subject AND issuer=p_issuer/);
  assert.match(source,/WHERE invite_id=v_request.invite_id AND subject=p_subject/);
  assert.match(source,/AND issuer=p_issuer FOR UPDATE/);
});
test('62D-C14B2A reviewer must be separate from applicant and inviter',()=>{
  assert.match(source,/v_reviewer.reviewer_subject=p_subject/);
  assert.match(source,/v_reviewer.reviewer_subject=v_invitation.issued_by/);
  assert.match(source,/v_invitation.issued_by=p_subject/);
});
test('62D-C14B2A reviewer authority remains live, active and purpose scoped',()=>{
  assert.match(source,/v_reviewer.authority_state<>'active'/);
  assert.match(source,/v_reviewer.authority_scope<>'account_enrollment_review'/);
  assert.match(source,/v_reviewer.revision<1/);
});
test('62D-C14B2A request and invitation must be unexpired and correct state',()=>{
  assert.match(source,/v_request.expires_at<=v_now/);
  assert.match(source,/v_invitation.expires_at<=v_now/);
  assert.match(source,/v_invitation.invitation_state<>'redeemed'/);
  assert.match(source,/approved_for_enrollment/);
  assert.match(source,/enrolled_suspended/);
});
test('62D-C14B2A approval must be unconsumed, distinct, fresh and matched',()=>{
  for(const frag of ["v_approval.purpose<>p_phase",
    "v_approval.decision<>'approve'",
    "v_approval.approval_state<>'unconsumed'",
    "v_approval.consumed_at IS NOT NULL",
    'v_approval.expires_at<=v_now',
    'v_approval.nonce_digest=v_invitation.nonce_digest'])
    assert.ok(source.includes(frag),frag);
});
test('62D-C14B2A enrollment never upserts or reuses account',()=>{
  assert.match(source,/IF FOUND THEN\s+RAISE EXCEPTION 'Subject already has an account'/);
  assert.match(source,/INSERT INTO ldos_app_auth.accounts\(subject\) VALUES \(p_subject\)/);
  assert.match(source,/v_state<>'suspended' OR v_revision<>1/);
  assert.doesNotMatch(source,/ON CONFLICT|UPSERT|DELETE FROM ldos_app_auth.accounts/);
});
test('62D-C14B2A activation has revision-checked suspended-only update',()=>{
  assert.match(source,/v_account.account_state<>'suspended'/);
  assert.match(source,/v_account.revision<>p_expected_account_revision/);
  assert.match(source,/SET account_state='active'/);
  assert.match(source,/AND revision=p_expected_account_revision/);
  assert.match(source,/v_revision<>p_expected_account_revision\+1/);
});
test('62D-C14B2A refuses near-overflow revisions before SQL writes',()=>{
  assert.match(source,/p_expected_account_revision>=9223372036854775807/);
  assert.match(source,/v_request.revision>=9223372036854775807/);
  assert.match(source,/v_approval.revision>=9223372036854775807/);
});
test('62D-C14B2A consumes one approved record under lock',()=>{
  assert.match(source,/UPDATE ldos_app_auth.enrollment_approvals/);
  assert.match(source,/SET approval_state='consumed',consumed_at=clock_timestamp\(\)/);
  assert.match(source,/WHERE approval_id=p_approval_id AND approval_state='unconsumed'/);
  assert.match(source,/AND revision=v_approval.revision/);
});
test('62D-C14B2A request transition follows the account mutation',()=>{
  const a=source.indexOf('INSERT INTO ldos_app_auth.accounts(subject)');
  const b=source.indexOf('UPDATE ldos_app_auth.enrollment_approvals');
  const c=source.indexOf('UPDATE ldos_app_auth.enrollment_requests');
  assert.ok(a>0&&b>a&&c>b);
  assert.match(source,/WHERE request_id=p_request_id AND revision=v_request.revision/);
});
test('62D-C14B2A mandatory audit insert precedes returned revision',()=>{
  const audit=source.indexOf('INSERT INTO ldos_app_auth.enrollment_audit_events (');
  const ret=source.indexOf('RETURN v_revision;');
  assert.ok(audit>0&&ret>audit);
  assert.match(source,/p_audit_id,p_request_id,p_subject,v_reviewer_subject/);
  assert.match(source,/THEN 'enrolled_suspended' ELSE 'activated' END/);
});
test('62D-C14B2A audit replay or failure remains inside the caller transaction',()=>{
  assert.match(source,/The statement's insert failure aborts the transaction/);
  assert.match(source,/caller\s+-- must COMMIT exactly once/);
  assert.doesNotMatch(source,/COMMIT;[\s\S]*COMMIT;[\s\S]*COMMIT;/);
});
test('62D-C14B2A source contains no persistent connections or enrollment UI',()=>{
  assert.doesNotMatch(source,/password|sb_secret_|curl |CREATE SERVER|CREATE TRIGGER|CREATE TABLE|CREATE ROLE|INSERT INTO ldos_app_auth.sessions|INSERT INTO ldos_app_auth.county_grants/i);
  assert.match(C14B2A_PLAN_PASS,/no database connection or writes/);
});
