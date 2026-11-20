import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createUnroutedEnrollmentReviewPolicy} from '../../../server/providers/bdp-unrouted-account-enrollment-review-policy.js';

const ISSUER='https://abcdefghijabcdefghij.supabase.co/auth/v1';
const SUBJECT='123e4567-e89b-42d3-a456-426614174000';
const INVITER='22222222-2222-4222-8222-222222222222';
const REVIEWER='33333333-3333-4333-8333-333333333333';
const INVITE='44444444-4444-4444-8444-444444444444';
const REQUEST='55555555-5555-4555-8555-555555555555';
const APPROVAL='66666666-6666-4666-8666-666666666666';
const NOW=1795000000000;
const policy=createUnroutedEnrollmentReviewPolicy({expectedIssuer:ISSUER});
const proposal=phase=>({
  phase,
  identity:{
    provider:'supabase',subject:SUBJECT,issuer:ISSUER,
    providerIdentityConfirmed:true,mfaConfirmed:false,
    appCountyGrantConfirmed:false,appSessionIssued:false,releaseAuthorized:false,
  },
  invitation:{
    inviteId:INVITE,subject:SUBJECT,issuer:ISSUER,issuedBy:INVITER,
    nonceDigest:'a'.repeat(64),state:'redeemed',expiresAtMs:NOW+3600000,
  },
  request:{
    requestId:REQUEST,inviteId:INVITE,subject:SUBJECT,issuer:ISSUER,
    state:phase==='activate'?'enrolled_suspended':'approved_for_enrollment',
    revision:'2',expiresAtMs:NOW+3600000,
  },
  reviewer:{
    subject:REVIEWER,state:'active',permission:'account_enrollment_review',
    revision:'1',source:'app-owned-primary',
  },
  approval:{
    approvalId:APPROVAL,requestId:REQUEST,subject:SUBJECT,issuer:ISSUER,
    reviewerSubject:REVIEWER,purpose:phase,decision:'approve',
    state:'unconsumed',nonceDigest:'b'.repeat(64),
    expiresAtMs:NOW+60000,revision:'1',
  },
  account:phase==='activate'?{
    subject:SUBJECT,account_state:'suspended',revision:'1',
    source:'app-owned-primary',current:true,
  }:null,
  nowMs:NOW,
});
const evaluate=(base,changes={})=>policy.evaluateSnapshots({...base,...changes});
const change=(base,key,patch)=>evaluate(base,{[key]:{...base[key],...patch}});
const source=readFileSync(new URL(
  '../../../server/providers/bdp-unrouted-account-enrollment-review-policy.js',
  import.meta.url,
),'utf8');
const schema=readFileSync(new URL(
  '../../../docs/STEP-40C-62D-C14A-ENROLLMENT-SCHEMA-PRIVILEGE-REVIEW.md',
  import.meta.url,
),'utf8');

test('62D-C14A requires a fixed valid Supabase issuer',()=>{
  for(const expectedIssuer of [null,undefined,'', 'http://invalid',
    'https://evil.example/auth/v1',
    'https://abcdefghijabcdefghij.supabase.co/auth/v1?x=1'])
    assert.throws(()=>createUnroutedEnrollmentReviewPolicy({expectedIssuer}),TypeError);
  assert.ok(createUnroutedEnrollmentReviewPolicy({expectedIssuer:ISSUER}));
});
test('62D-C14A policy exposes only one frozen, non-writing evaluator',()=>{
  assert.deepEqual(Object.keys(policy),['evaluateSnapshots']);
  assert.equal(Object.isFrozen(policy),true);
  assert.equal(typeof policy.evaluateSnapshots,'function');
});
test('62D-C14A enrollment returns a frozen NON-AUTHORIZING proposal, not an account',()=>{
  const output=policy.evaluateSnapshots(proposal('enroll_suspended'));
  assert.deepEqual(output,{
    kind:'unrouted-account-enrollment-review-proposal',
    phase:'enroll_suspended',subject:SUBJECT,issuer:ISSUER,
    requestId:REQUEST,approvalId:APPROVAL,expectedAccountRevision:null,
    accountMutation:'none',requiresPrimaryTransaction:true,
    requiresDurableAudit:true,mfaConfirmed:false,appSessionIssued:false,
    countyGrantConfirmed:false,releaseAuthorized:false,
  });
  assert.equal(Object.isFrozen(output),true);
  assert.ok(!Object.hasOwn(output,'authorized'));
  assert.ok(!Object.hasOwn(output,'accountState'));
});
test('62D-C14A activation is distinct and requires suspended account revision',()=>{
  const output=policy.evaluateSnapshots(proposal('activate'));
  assert.equal(output.phase,'activate');
  assert.equal(output.expectedAccountRevision,'1');
  assert.equal(output.accountMutation,'none');
  assert.equal(output.releaseAuthorized,false);
});
test('62D-C14A refuses unknown phase or malformed input container',()=>{
  for(const input of [null,undefined,[],{}, {phase:'enroll_suspended'},
    {...proposal('enroll_suspended'),phase:'auto_activate'},
    {...proposal('enroll_suspended'),clientRole:'admin'}])
    assert.equal(policy.evaluateSnapshots(input),null);
});
test('62D-C14A never accepts accessor properties or inherited input',()=>{
  const a=proposal('enroll_suspended');
  Object.defineProperty(a,'phase',{get(){throw Error('untrusted accessor')}});
  assert.equal(policy.evaluateSnapshots(a),null);
  const b=Object.create({role:'admin'});
  Object.assign(b,proposal('enroll_suspended'));
  assert.equal(policy.evaluateSnapshots(b),null);
});
test('62D-C14A only verified real Supabase identity can proceed',()=>{
  const base=proposal('enroll_suspended');
  for(const patch of [{provider:'other'},{providerIdentityConfirmed:false},
    {providerIdentityConfirmed:'true'},{subject:'not-a-uuid'},
    {issuer:'https://otherproject.supabase.co/auth/v1'}])
    assert.equal(change(base,'identity',patch),null);
});
test('62D-C14A identity flags cannot be promoted to MFA or county authority',()=>{
  const base=proposal('enroll_suspended');
  for(const patch of [{mfaConfirmed:true},{appCountyGrantConfirmed:true},
    {appSessionIssued:true},{releaseAuthorized:true}])
    assert.equal(change(base,'identity',patch),null);
});
test('62D-C14A untrusted identity metadata or browser role denied',()=>{
  const base=proposal('enroll_suspended');
  assert.equal(change(base,'identity',{user_metadata:{role:'admin'}}),null);
  assert.equal(change(base,'identity',{email:'untrusted@example.invalid'}),null);
});
test('62D-C14A invitation must match identity, issuer and exact request',()=>{
  const base=proposal('enroll_suspended');
  for(const patch of [{subject:REVIEWER},{issuer:'https://otherproject.supabase.co/auth/v1'},
    {inviteId:'invalid'},{issuedBy:'not-uuid'},{state:'pending'},
    {state:'revoked'}])
    assert.equal(change(base,'invitation',patch),null);
});
test('62D-C14A invitation digests are never raw tokens',()=>{
  const base=proposal('enroll_suspended');
  for(const digest of ['', 'a'.repeat(63),'G'.repeat(64),'a'.repeat(65),'jwt.x.y'])
    assert.equal(change(base,'invitation',{nonceDigest:digest}),null);
});
test('62D-C14A invitation expiry must be fresh and at most one day',()=>{
  const base=proposal('enroll_suspended');
  for(const expiresAtMs of [NOW-1,NOW,NOW+86400001,Infinity,'tomorrow'])
    assert.equal(change(base,'invitation',{expiresAtMs}),null);
});
test('62D-C14A request binds verified subject, issuer and invitation id',()=>{
  const base=proposal('enroll_suspended');
  for(const patch of [{subject:INVITER},{issuer:'https://otherproject.supabase.co/auth/v1'},
    {inviteId:REQUEST},{requestId:'not-uuid'},
    {expiresAtMs:NOW-1}])
    assert.equal(change(base,'request',patch),null);
});
test('62D-C14A request must have correct phase-specific reviewed status',()=>{
  const enroll=proposal('enroll_suspended');
  const activate=proposal('activate');
  for(const state of ['pending','denied','activated','revoked','enrolled_suspended'])
    assert.equal(change(enroll,'request',{state}),null);
  assert.equal(change(activate,'request',{state:'approved_for_enrollment'}),null);
});
test('62D-C14A request revisions are exact bounded positive bigint strings',()=>{
  const base=proposal('enroll_suspended');
  for(const revision of ['0','01','-1','9223372036854775808',1,1.5,'3.0',NaN])
    assert.equal(change(base,'request',{revision}),null);
});
test('62D-C14A applicant never self-reviews',()=>{
  const base=proposal('enroll_suspended');
  assert.equal(change(base,'reviewer',{subject:SUBJECT}),null);
  assert.equal(change(base,'invitation',{issuedBy:SUBJECT}),null);
});
test('62D-C14A inviter and approving reviewer must be different people',()=>{
  const base=proposal('enroll_suspended');
  assert.equal(change(base,'reviewer',{subject:INVITER}),null);
});
test('62D-C14A reviewer must be currently active, policy-backed and exact',()=>{
  const base=proposal('enroll_suspended');
  for(const patch of [{state:'revoked'},{state:'unknown'},
    {permission:'owner'}, {source:'browser_metadata'},
    {source:'supabase_claim'}, {revision:'0'},
    {subject:'not-uuid'}])
    assert.equal(change(base,'reviewer',patch),null);
});
test('62D-C14A approval binds subject, request, issuer and independent reviewer',()=>{
  const base=proposal('enroll_suspended');
  for(const patch of [{subject:INVITER},{requestId:INVITE},
    {issuer:'https://otherproject.supabase.co/auth/v1'},
    {reviewerSubject:INVITER},{approvalId:'invalid'}])
    assert.equal(change(base,'approval',patch),null);
});
test('62D-C14A revoked, consumed or denied approval never allows proposal',()=>{
  const base=proposal('enroll_suspended');
  for(const patch of [{state:'consumed'}, {state:'revoked'},
    {decision:'deny'},{decision:'pending'}, {revision:'0'}])
    assert.equal(change(base,'approval',patch),null);
});
test('62D-C14A approval is purpose-specific; activation requires a distinct approval',()=>{
  const base=proposal('enroll_suspended');
  assert.equal(change(base,'approval',{purpose:'activate'}),null);
  assert.equal(change(proposal('activate'),'approval',{purpose:'enroll_suspended'}),null);
});
test('62D-C14A approval nonce must be distinct, hashed and unexpired',()=>{
  const base=proposal('enroll_suspended');
  for(const patch of [{nonceDigest:'a'.repeat(64)},
    {nonceDigest:'secret'}, {expiresAtMs:NOW},
    {expiresAtMs:NOW+900001}, {expiresAtMs:NOW-1}])
    assert.equal(change(base,'approval',patch),null);
});
test('62D-C14A enrollment refuses existing or fabricated account rows',()=>{
  const base=proposal('enroll_suspended');
  for(const account of [{subject:SUBJECT,account_state:'suspended',revision:'1',
    source:'app-owned-primary',current:true}, {}, undefined, false])
    assert.equal(evaluate(base,{account}),null);
});
test('62D-C14A activation refuses missing, active, closed, stale or mismatched accounts',()=>{
  const base=proposal('activate');
  for(const account of [null,{...base.account,account_state:'active'},
    {...base.account,account_state:'closed'},
    {...base.account,current:false},
    {...base.account,source:'replica'},
    {...base.account,subject:INVITER},
    {...base.account,revision:'0'}])
    assert.equal(evaluate(base,{account}),null);
});
test('62D-C14A activation rejects revision overflow that cannot be bumped',()=>{
  const base=proposal('activate');
  assert.equal(change(base,'account',{revision:'9223372036854775807'}),null);
});
test('62D-C14A clock cannot be missing, forged as text, or nonintegral',()=>{
  const base=proposal('enroll_suspended');
  for(const nowMs of [-1,0,'1795000000000',NaN,Infinity,1.5])
    assert.equal(evaluate(base,{nowMs}),null);
});
test('62D-C14A extra fields on any authority evidence fail closed',()=>{
  const base=proposal('enroll_suspended');
  for(const key of ['invitation','request','reviewer','approval']){
    assert.equal(change(base,key,{county_grants:['48453']}),null,key);
  }
});
test('62D-C14A policy module never issues SQL, routes, users or credentials',()=>{
  assert.match(source,/SOURCE-ONLY, UNROUTED/);
  assert.match(source,/accountMutation:'none'/);
  assert.doesNotMatch(source,/createServer\(|new Pool\(|fetch\(|process\.env|INSERT INTO|UPDATE ldos_app_auth|GRANT SELECT|CREATE ROLE|sb_secret_|ST_AsGeoJSON/);
});
test('62D-C14A schema is review-only, not an executable PostgreSQL migration',()=>{
  assert.match(schema,/NON-EXECUTABLE DESIGN/);
  for(const table of ['enrollment_reviewer_authorities','enrollment_invitations',
    'enrollment_requests','enrollment_approvals','enrollment_audit_events'])
    assert.ok(schema.includes(table),table);
  assert.doesNotMatch(schema,/^CREATE TABLE /m);
});
test('62D-C14A schema requires frozen replay tokens, audit and separate approval',()=>{
  for(const term of ['UNIQUE(request_id,purpose)','UNIQUE(invite_id,subject,issuer)',
    'FOREIGN KEY(invite_id,subject,issuer)','account_enrollment_review',
    'append-only','SERIALIZABLE','suspended','separate approval for activation'])
    assert.ok(schema.toLowerCase().includes(term.toLowerCase()),term);
});
test('62D-C14A privilege matrix preserves existing NOLOGIN reader as read only',()=>{
  assert.match(schema,/ldos_auth_account_reader/);
  assert.match(schema,/ldos_auth_gateway_login/);
  assert.match(schema,/ldos_auth_enrollment_writer/);
  assert.match(schema,/No direct grants/);
  assert.match(schema,/Existing .*NO CHANGE/);
  assert.match(schema,/DENY/);
});
