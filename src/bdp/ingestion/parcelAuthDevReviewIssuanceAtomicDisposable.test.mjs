import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  C14B2C2B_SQL_BLOB,C14B2C2B_PASS,requireC14B2C2BOnly,
  verifyC14B2C2BSource,syntheticReviewRequest,syntheticIssue,
} from '../../../scripts/bdp/app-auth-review-issuance-atomic-disposable-smoke.mjs';
import {
  c14b2aGitBlob,
} from '../../../scripts/bdp/app-auth-enrollment-atomic-disposable-plan.mjs';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const sql=read('../../../server/standalone/sql/landOsReviewIssuanceAtomicDisposable.sql');
const runner=read('../../../scripts/bdp/app-auth-review-issuance-atomic-disposable-smoke.mjs');
const S='11111111-1111-4111-8111-111111111111';
const R='33333333-3333-4333-8333-333333333333';
const REQUEST='55555555-5555-4555-8555-555555555555';
const INV='44444444-4444-4444-8444-444444444444';
const APPR='66666666-6666-4666-8666-666666666666';
const AUD='88888888-8888-4888-8888-888888888888';
const basic={phase:'enroll_suspended',subject:S,request:REQUEST,reviewer:R,
  approval:APPR,digest:'b'.repeat(64),audit:AUD};

test('62D-C14B2C2B requires precisely explicit disposable-only mode',()=>{
  assert.equal(requireC14B2C2BOnly(['--disposable-only']),true);
  for(const args of [[],null,undefined,['--plan-only'],['--apply'],
    ['--disposable-only','--force'],['--apply-local-auth-only']])
    assert.throws(()=>requireC14B2C2BOnly(args));
});
test('62D-C14B2C2B pinned SQL source matches exact reviewed Git blob',()=>{
  assert.equal(c14b2aGitBlob(sql),C14B2C2B_SQL_BLOB);
  assert.equal(C14B2C2B_SQL_BLOB.length,40);
  assert.equal(verifyC14B2C2BSource(sql),true);
  assert.throws(()=>verifyC14B2C2BSource(sql+'\n'));
});
test('62D-C14B2C2B prototype refuses persistent auth-dev and nonprimary',()=>{
  assert.match(sql,/current_database\(\)<>'ldos_c14b_disposable'/);
  assert.match(sql,/current_user<>'postgres'/);
  assert.match(sql,/pg_is_in_recovery\(\)/);
  assert.doesNotMatch(sql,/current_database\(\)<>'ldos_auth_dev'/);
});
test('62D-C14B2C2B installation requires exact reviewed enrollment relations',()=>{
  for(const name of ['accounts','enrollment_reviewer_authorities',
    'enrollment_invitations','enrollment_requests','enrollment_approvals',
    'enrollment_audit_events'])
    assert.ok(sql.includes("to_regclass('ldos_app_auth."+name+"') IS NULL"),name);
  assert.match(sql,/disposable_enrollment_transition\(text,uuid,text,uuid,uuid,uuid,bigint\)/);
});
test('62D-C14B2C2B installation rejects preexisting private SQL roles',()=>{
  for(const role of ['ldos_auth_gateway_login','ldos_auth_account_reader',
    'ldos_auth_enrollment_executor_login','ldos_auth_review_issuer_login',
    'ldos_auth_enrollment_writer','ldos_auth_review_issuer_writer'])
    assert.ok(sql.includes("'"+role+"'"),role);
});
test('62D-C14B2C2B SQL declares one fixed SECURITY INVOKER function',()=>{
  assert.equal((sql.match(/^CREATE FUNCTION /gm)||[]).length,1);
  assert.match(sql,/CREATE FUNCTION ldos_app_auth.disposable_issue_enrollment_review\(/);
  assert.match(sql,/RETURNS bigint\s+LANGUAGE plpgsql\s+SECURITY INVOKER/);
  assert.match(sql,/SET search_path=pg_catalog,pg_temp/);
  assert.doesNotMatch(sql,/SECURITY DEFINER/);
});
test('62D-C14B2C2B revokes public function rights and grants no membership',()=>{
  assert.match(sql,/REVOKE ALL ON FUNCTION ldos_app_auth.disposable_issue_enrollment_review\(/);
  assert.match(sql,/\) FROM PUBLIC;\s*COMMIT;\s*$/);
  assert.doesNotMatch(sql,/^\s*(GRANT|CREATE ROLE|ALTER ROLE|CREATE TABLE)\s/gm);
});
test('62D-C14B2C2B owner-only function requires writable SERIALIZABLE transaction',()=>{
  assert.match(sql,/current_setting\('transaction_isolation'\)<>'serializable'/);
  assert.match(sql,/current_setting\('transaction_read_only'\)<>'off'/);
  assert.match(sql,/current_user<>'postgres'/);
  assert.match(sql,/pg_is_in_recovery\(\)/);
});
test('62D-C14B2C2B only accepts bounded phase, exact issuer, nonce digest',()=>{
  assert.match(sql,/p_phase NOT IN \('enroll_suspended','activate'\)/);
  assert.match(sql,/p_issuer !~ '\^https:\/\/\[a-z0-9\]\{8,40\}\[\.\]supabase\[\.\]co\/auth\/v1\$'/);
  assert.match(sql,/p_nonce_digest !~ '\^\[0-9a-f\]\{64\}\$'/);
  for(const val of ['p_subject IS NULL','p_reviewer_subject IS NULL',
    'p_approval_id IS NULL','p_audit_id IS NULL'])
    assert.ok(sql.includes(val));
});
test('62D-C14B2C2B locks request, invitation and reviewer in fixed order',()=>{
  const a=sql.indexOf('FROM ldos_app_auth.enrollment_requests\n');
  const b=sql.indexOf('FROM ldos_app_auth.enrollment_invitations\n');
  const c=sql.indexOf('FROM ldos_app_auth.enrollment_reviewer_authorities\n');
  assert.ok(a>0&&b>a&&c>b);
  assert.match(sql,/request_id=p_request_id AND subject=p_subject AND issuer=p_issuer/);
  assert.match(sql,/reviewer_subject=p_reviewer_subject FOR UPDATE/);
});
test('62D-C14B2C2B reviewer must be active, scoped, and distinct',()=>{
  for(const expr of ["v_reviewer.authority_state<>'active'",
    "v_reviewer.authority_scope<>'account_enrollment_review'",
    'v_invitation.issued_by=p_subject','v_invitation.issued_by=p_reviewer_subject',
    'p_reviewer_subject=p_subject'])
    assert.ok(sql.includes(expr),expr);
});
test('62D-C14B2C2B enrollment requires pending request and no account',()=>{
  assert.match(sql,/THEN 'pending' ELSE 'enrolled_suspended' END/);
  assert.match(sql,/IF p_phase='enroll_suspended' THEN/);
  assert.match(sql,/IF FOUND THEN\s+RAISE EXCEPTION 'C14B2C2B account exists'/);
  assert.match(sql,/SET request_state='approved_for_enrollment'/);
});
test('62D-C14B2C2B activation requires existing suspended account revision',()=>{
  assert.match(sql,/v_account.account_state<>'suspended'/);
  assert.match(sql,/v_account.revision<>p_expected_account_revision/);
  assert.match(sql,/p_expected_account_revision>=9223372036854775807/);
});
test('62D-C14B2C2B denies reused purpose/nonce with locked DB binding',()=>{
  assert.match(sql,/WHERE request_id=p_request_id AND purpose=p_phase/);
  assert.match(sql,/p_nonce_digest=v_invitation.nonce_digest/);
  assert.match(sql,/C14B2C2B duplicate purpose/);
});
test('62D-C14B2C2B expires approvals within ten minutes and before request',()=>{
  assert.match(sql,/v_expiry:=LEAST\(v_now\+interval '10 minutes'/);
  assert.match(sql,/v_request.expires_at-interval '1 second'/);
  assert.match(sql,/v_invitation.expires_at-interval '1 second'/);
});
test('62D-C14B2C2B approval issuance occurs with request and mandatory audit',()=>{
  const a=sql.indexOf('INSERT INTO ldos_app_auth.enrollment_approvals (');
  const b=sql.indexOf("SET request_state='approved_for_enrollment'");
  const c=sql.indexOf('INSERT INTO ldos_app_auth.enrollment_audit_events (');
  const d=sql.indexOf('RETURN v_revision;');
  assert.ok(a>0&&b>a&&c>b&&d>c);
  assert.match(sql,/p_audit_id,p_request_id,p_subject,p_reviewer_subject,'reviewed',NULL/);
});
test('62D-C14B2C2B does not create sessions, county grants or app access',()=>{
  assert.doesNotMatch(sql,/INSERT INTO ldos_app_auth\.(accounts|sessions|county_grants)/);
  assert.doesNotMatch(sql,/UPDATE ldos_app_auth.accounts|ST_AsGeoJSON|sb_secret_|CREATE SERVER/);
});
test('62D-C14B2C2B synthetic request contains pending then redeemed only',()=>{
  const req=syntheticReviewRequest({subject:S,invitation:INV,request:REQUEST,
    digest:'a'.repeat(64)});
  assert.match(req,/enrollment_requests/);
  assert.match(req,/invitation_state='redeemed'/);
  assert.doesNotMatch(req,/enrollment_approvals|INSERT INTO ldos_app_auth.accounts/);
});
test('62D-C14B2C2B synthetic issuer generates one fixed function call',()=>{
  const expr=syntheticIssue(basic);
  assert.match(expr,/^SELECT ldos_app_auth.disposable_issue_enrollment_review\('/);
  assert.match(expr,/,'88888888-8888-4888-8888-888888888888',NULL\);$/);
  assert.doesNotMatch(expr,/BEGIN|COMMIT|GRANT |CREATE ROLE/);
});
test('62D-C14B2C2B synthetic fixture rejects unknown parameters',()=>{
  assert.throws(()=>syntheticIssue({...basic,phase:'self_approve'}));
  assert.throws(()=>syntheticIssue({...basic,digest:'RAW'}));
  assert.throws(()=>syntheticIssue({...basic,revision:7}));
  assert.throws(()=>syntheticReviewRequest({subject:'bad',invitation:INV,
    request:REQUEST,digest:'a'.repeat(64)}));
});
test('62D-C14B2C2B runner isolates network and host storage',()=>{
  assert.match(runner,/'--network','none'/);
  assert.match(runner,/'--pull','never'/);
  assert.match(runner,/'ldos-c14b2c2b-issuer-'\+randomBytes\(6\)/);
  assert.doesNotMatch(runner,/'--publish'|'--mount'|'--volume'/);
  assert.doesNotMatch(runner,/ldos-auth-dev-auth-postgres-1|54338|docker compose down/);
});
test('62D-C14B2C2B runner checks prior pinned SQL and role matrix',()=>{
  assert.match(runner,/validC14BSource\(enrollment\)/);
  assert.match(runner,/verifyC14B2ASource\(atomic\)/);
  assert.match(runner,/verifyC14B2C2BSource\(issuance\)/);
  assert.match(runner,/exactRoleSql\(roles,executor,issuer\)/);
});
test('62D-C14B2C2B logged-in synthetic principals cannot execute issuance',()=>{
  assert.match(runner,/has_function_privilege/);
  assert.match(runner,/ldos_auth_review_issuer_login/);
  assert.match(runner,/ldos_auth_enrollment_executor_login/);
  assert.match(runner,/assert\.match\(String\(d\.stderr\|\|''\),\/\\b42501\\b\/\)/);
});
test('62D-C14B2C2B proves separate reviewer/inviter and denial cases',()=>{
  assert.match(runner,/for\(const who of \[INVITER,REVIEWER\]\)/);
  assert.match(runner,/rejected.*nonserializable/);
  assert.match(runner,/reviewer:INVITER/);
  assert.match(runner,/reviewer:S1/);
});
test('62D-C14B2C2B prove issue, enroll, activate, replay, and audit rollback',()=>{
  for(const phrase of [
    'atomic issuance of enrollment approval with reviewed audit',
    'deny same-purpose replay before any account mutation',
    'consume independently issued enrollment approval',
    'separately issue activation-purpose approval',
    'consume independent activation approval and verify revision',
    'verify mandatory audit conflict aborts approval issuance',
  ])assert.ok(runner.includes(phrase),phrase);
  assert.match(runner,/denied\(tx\(syntheticIssue\(second\)\),'23505'\)/);
});
test('62D-C14B2C2B denies untrusted claims of authenticated administrator',()=>{
  assert.match(runner,/A real reviewer is NOT authenticated/);
  assert.match(runner,/no real reviewer authentication/);
  assert.doesNotMatch(runner,/SUPABASE_SERVICE_ROLE|process\.env|createServer\(|fetch\(/);
});
test('62D-C14B2C2B cleans up only its isolated scoped Docker container',()=>{
  assert.match(runner,/if\(created\)\{/);
  assert.match(runner,/\['rm','--force','--volumes',name\]/);
  assert.doesNotMatch(runner,/docker system prune|docker rm -f/);
  assert.match(C14B2C2B_PASS,/no real reviewer authentication or persistent auth-dev writes/);
});
