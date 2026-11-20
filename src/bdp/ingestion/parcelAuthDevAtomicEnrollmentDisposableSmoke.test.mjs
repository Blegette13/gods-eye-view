import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  C14B2B_PASS,requireC14B2BDisposableOnly,
  syntheticReviewFixture,syntheticTransition,
} from '../../../scripts/bdp/app-auth-enrollment-atomic-disposable-smoke.mjs';
import {
  C14B2A_SQL_BLOB,c14b2aGitBlob,verifyC14B2ASource,
} from '../../../scripts/bdp/app-auth-enrollment-atomic-disposable-plan.mjs';
import {
  C14B_SQL_BLOB,c14bGitBlob,validC14BSource,
} from '../../../scripts/bdp/app-auth-enrollment-schema-disposable-smoke.mjs';

const src=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-enrollment-atomic-disposable-smoke.mjs',
  import.meta.url),'utf8');
const schema=readFileSync(new URL(
  '../../../server/standalone/sql/landOsEnrollmentReviewDisposable.sql',
  import.meta.url),'utf8');
const atomic=readFileSync(new URL(
  '../../../server/standalone/sql/landOsEnrollmentAtomicDisposable.sql',
  import.meta.url),'utf8');
const fixture=Object.freeze({
  subject:'11111111-1111-4111-8111-111111111111',
  invite:'44444444-4444-4444-8444-444444444444',
  request:'55555555-5555-4555-8555-555555555555',
  approval:'66666666-6666-4666-8666-666666666666',
  digest:'a'.repeat(64),approvalDigest:'f'.repeat(64),
});
const transition=Object.freeze({
  phase:'enroll_suspended',subject:fixture.subject,
  request:fixture.request,approval:fixture.approval,
  audit:'88888888-8888-4888-8888-888888888888',
});

test('62D-C14B2B accepts only explicit disposable-only flag',()=>{
  assert.equal(requireC14B2BDisposableOnly(['--disposable-only']),true);
  for(const x of [null,undefined,[],['--plan-only'],['--prod'],
    ['--disposable-only','--force'],['--apply-local-auth-only']])
    assert.throws(()=>requireC14B2BDisposableOnly(x));
});
test('62D-C14B2B invokes only the exact previously reviewed SQL blobs',()=>{
  assert.equal(c14bGitBlob(schema),C14B_SQL_BLOB);
  assert.equal(c14b2aGitBlob(atomic),C14B2A_SQL_BLOB);
  assert.equal(validC14BSource(schema),true);
  assert.equal(verifyC14B2ASource(atomic),true);
  assert.match(src,/if\(!validC14BSource\(schema\)\|\|!verifyC14B2ASource\(atomic\)\)/);
});
test('62D-C14B2B creates a randomized container without external networking',()=>{
  assert.match(src,/'ldos-c14b2b-atomic-'\+randomBytes\(6\)/);
  assert.match(src,/'--network','none'/);
  assert.match(src,/'--pull','never'/);
  assert.doesNotMatch(src,/'--publish'|'--mount'|'--volume'|'--network','bridge'/);
});
test('62D-C14B2B only targets new synthetic ldos_c14b_disposable',()=>{
  assert.match(src,/C14B_DB/);
  assert.match(src,/'POSTGRES_DB='\+C14B_DB/);
  assert.match(src,/'image','inspect',C14B_IMAGE/);
  assert.doesNotMatch(src,/ldos-auth-dev-auth-postgres-1|ldos_auth_dev|54338/);
});
test('62D-C14B2B fixture is synthetic only and contains no real bearer tokens',()=>{
  assert.match(src,/https:\/\/abcdefghijabcdefghij\.supabase\.co\/auth\/v1/);
  assert.doesNotMatch(src,/process\.env|sb_secret_|SUPABASE_SERVICE_ROLE|auth\.users|fetch\(|createServer\(/);
  assert.doesNotMatch(src,/ST_AsGeoJSON|INSERT INTO ldos_app_auth.sessions|INSERT INTO ldos_app_auth.county_grants/);
});
test('62D-C14B2B disposal removes only the freshly created container',()=>{
  assert.match(src,/let created=false/);
  assert.match(src,/if\(created\)\{/);
  assert.match(src,/\['rm','--force','--volumes',container\]/);
  assert.doesNotMatch(src,/docker compose down|docker system prune|docker rm -f/);
});
test('62D-C14B2B approvals require unique hashed nonces per synthetic request',()=>{
  const first=syntheticReviewFixture(fixture);
  const second=syntheticReviewFixture({
    ...fixture,subject:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    invite:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    request:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    approval:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    digest:'c'.repeat(64),approvalDigest:'e'.repeat(64),
  });
  assert.ok(first.includes("'"+'f'.repeat(64)+"'"));
  assert.ok(second.includes("'"+'e'.repeat(64)+"'"));
  assert.ok(!second.includes("'"+'f'.repeat(64)+"'"));
  assert.throws(()=>syntheticReviewFixture({...fixture,approvalDigest:fixture.digest}));
});
test('62D-C14B2B synthetic fixture never inserts active account by default',()=>{
  const sql=syntheticReviewFixture(fixture);
  assert.match(sql,/enrollment_invitations/);
  assert.match(sql,/enrollment_requests/);
  assert.match(sql,/enrollment_approvals/);
  assert.match(sql,/invitation_state='redeemed'/);
  assert.match(sql,/request_state='approved_for_enrollment'/);
  assert.doesNotMatch(sql,/INSERT INTO ldos_app_auth.accounts|session_digest|county_fips/);
});
test('62D-C14B2B transition generates fixed function call only',()=>{
  const sql=syntheticTransition(transition);
  assert.match(sql,/^SELECT ldos_app_auth\.disposable_enrollment_transition\('/);
  assert.match(sql,/,'88888888-8888-4888-8888-888888888888',NULL\);$/);
  assert.doesNotMatch(sql,/COMMIT|INSERT INTO|DROP TABLE/);
});
test('62D-C14B2B rejects malformed transition shapes',()=>{
  for(const phase of ['apply','enroll','',null,'create_active']){
    assert.throws(()=>syntheticTransition({...transition,phase}));
  }
  for(const revision of [-1,0,100,NaN,'1']){
    assert.throws(()=>syntheticTransition({...transition,revision}));
  }
  assert.throws(()=>syntheticTransition({...transition,subject:'bad'}));
});
test('62D-C14B2B requires SERIALIZABLE in a caller-owned transaction',()=>{
  assert.match(src,/BEGIN ISOLATION LEVEL /);
  assert.match(src,/'SERIALIZABLE'/);
  assert.match(src,/const tx=\(body,isolation='SERIALIZABLE'\)/);
  assert.match(src,/rejected\(syntheticTransition\(enroll\),'42501'\)/);
});
test('62D-C14B2B seeds separate reviewer and inviter only',()=>{
  assert.match(src,/for\(const who of \[INVITER,REVIEWER\]\)/);
  assert.doesNotMatch(src,/for\(const who of \[INVITER,REVIEWER,S1\]\)/);
});
test('62D-C14B2B denied subject mismatch precedes successful enrollment',()=>{
  const mismatch=src.indexOf('rejected(acceptance({...enroll,subject:S2})');
  const success=src.indexOf("assert.equal(psql(acceptance(enroll)),'1')");
  assert.ok(mismatch>=0&&success>mismatch);
});
test('62D-C14B2B suspended-first account and revision one are required',()=>{
  assert.match(src,/stage='atomic suspended-first enrollment'/);
  assert.match(src,/assert.equal\(psql\(acceptance\(enroll\)\),'1'\)/);
  assert.match(src,/assert.equal\(state\(\),'suspended\|1'\)/);
  assert.match(src,/totals\(\),'1\|0\|0\|1\|1\|1'/);
});
test('62D-C14B2B consumed approval, request transition and replay denial',()=>{
  assert.match(src,/'consumed\|2'/);
  assert.match(src,/'enrolled_suspended\|3'/);
  assert.match(src,/rejected\(acceptance\(\{\.\.\.enroll,audit:AUDIT2\}\),'42501'\)/);
});
test('62D-C14B2B separate purpose activation must have new approval',()=>{
  assert.match(src,/APPROVE_ACTIVE/);
  assert.match(src,/REVIEWER,'activate'/);
  assert.match(src,/stage='seed independently purposed activation approval'/);
  assert.match(src,/stage='atomic separate activation with revision bump and mandatory audit'/);
});
test('62D-C14B2B stale revision denies before activation',()=>{
  const stale=src.indexOf("rejected(acceptance({...activate,revision:999}),'42501')");
  const valid=src.indexOf("assert.equal(psql(acceptance(activate)),'2')");
  assert.ok(stale>=0&&valid>stale);
  assert.match(src,/assert.equal\(state\(\),'active\|2'\)/);
});
test('62D-C14B2B requires exactly two distinct immutable audit events',()=>{
  assert.match(src,/AUDIT1='88888888/);
  assert.match(src,/AUDIT2='99999999/);
  assert.match(src,/enrolled_suspended\|activated/);
  assert.match(src,/totals\(\),'1\|0\|0\|1\|2\|2'/);
});
test('62D-C14B2B duplicate audit event must reject entire enrollment',()=>{
  assert.match(src,/stage='test required audit insertion failure rolls entire enrollment back'/);
  assert.match(src,/const second=\{phase:'enroll_suspended',subject:S2/);
  assert.match(src,/rejected\(acceptance\(second\),'23505'\)/);
  assert.match(src,/approval_state FROM /);
  assert.match(src,/'unconsumed'/);
  assert.match(src,/'approved_for_enrollment'/);
});
test('62D-C14B2B audit rollback leaves second account absent',()=>{
  assert.match(src,/WHERE subject='\+/);
  assert.match(src,/assert.equal\(totals\(\),'1\|0\|0\|2\|3\|2'\)/);
  assert.match(src,/assert.equal\(psql\('SELECT count\(\*\) FROM '\+P\+'accounts WHERE subject='\+/);
});
test('62D-C14B2B avoids persistent SQL roles and confirms no sessions/counties',()=>{
  assert.match(src,/ldos_auth_gateway_login/);
  assert.match(src,/ldos_auth_enrollment_writer/);
  assert.match(src,/'1\|0\|0\|2\|3\|2'/);
  assert.match(C14B2B_PASS,/no persistent databases touched/);
});
test('62D-C14B2B fails closed without printing SQL, secrets or account data',()=>{
  assert.match(src,/no persistent database targeted/);
  assert.match(src,/cleanup unconfirmed/);
  assert.doesNotMatch(src,/console\.log|console\.error|Write-Output|process\.stdout\.write\(result\./);
});
