import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createUnroutedReviewerIssuanceReview} from '../../../server/providers/bdp-unrouted-reviewer-issuance-review.js';

const ISSUER='https://abcdefghijabcdefghij.supabase.co/auth/v1';
const APPLICANT='11111111-1111-4111-8111-111111111111';
const REVIEWER='22222222-2222-4222-8222-222222222222';
const INVITER='33333333-3333-4333-8333-333333333333';
const INVITE='44444444-4444-4444-8444-444444444444';
const REQUEST='55555555-5555-4555-8555-555555555555';
const APPROVAL='66666666-6666-4666-8666-666666666666';
const NOW=1795000000000;
const policy=createUnroutedReviewerIssuanceReview({expectedIssuer:ISSUER});
const identity=subject=>({
  provider:'supabase',subject,issuer:ISSUER,providerIdentityConfirmed:true,
  mfaConfirmed:false,appCountyGrantConfirmed:false,appSessionIssued:false,
  releaseAuthorized:false,
});
const fixture=(phase='enroll_suspended')=>({
  phase,
  applicantIdentity:identity(APPLICANT),
  reviewerIdentity:identity(REVIEWER),
  reviewerAuthority:{
    subject:REVIEWER,state:'active',permission:'account_enrollment_review',
    revision:'3',source:'app-owned-primary',current:true,
  },
  invitation:{
    inviteId:INVITE,subject:APPLICANT,issuer:ISSUER,issuedBy:INVITER,
    nonceDigest:'a'.repeat(64),state:'redeemed',expiresAtMs:NOW+3600000,
  },
  request:{
    requestId:REQUEST,inviteId:INVITE,subject:APPLICANT,issuer:ISSUER,
    state:phase==='activate'?'enrolled_suspended':'pending',
    revision:'3',expiresAtMs:NOW+3600000,
  },
  approvalIntent:{
    approvalId:APPROVAL,requestId:REQUEST,subject:APPLICANT,issuer:ISSUER,
    reviewerSubject:REVIEWER,purpose:phase,
    nonceDigest:'b'.repeat(64),expiresAtMs:NOW+60000,
  },
  existingPurposeApproval:null,
  account:phase==='activate'?{
    subject:APPLICANT,account_state:'suspended',revision:'1',
    source:'app-owned-primary',current:true,
  }:null,
  nowMs:NOW,
});
const change=(base,key,patch)=>policy.reviewSnapshots({
  ...base,[key]:{...base[key],...patch},
});
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
const source=read('../../../server/providers/bdp-unrouted-reviewer-issuance-review.js');

test('62D-C14B2C2A demands exact trusted project issuer',()=>{
  for(const expectedIssuer of [null,undefined,'',ISSUER+'/', 'http://wrong',
    'https://anything.example/auth/v1'])
    assert.throws(()=>createUnroutedReviewerIssuanceReview({expectedIssuer}),TypeError);
});
test('62D-C14B2C2A exports one frozen server-only evaluator',()=>{
  assert.deepEqual(Object.keys(policy),['reviewSnapshots']);
  assert.equal(Object.isFrozen(policy),true);
});
test('62D-C14B2C2A enrollment returns immutable NON-AUTHORIZING review proposal',()=>{
  const got=policy.reviewSnapshots(fixture());
  assert.deepEqual(got,{
    kind:'unrouted-review-issuance-design-proposal',
    phase:'enroll_suspended',subject:APPLICANT,reviewerSubject:REVIEWER,
    issuer:ISSUER,requestId:REQUEST,approvalId:APPROVAL,
    expectedAccountRevision:null,
    authorization:'none',approvalMutation:'none',accountMutation:'none',
    requiresIndependentLiveVerification:true,
    requiresPrimaryRowLocks:true,requiresAtomicAudit:true,
    reviewerMfaConfirmed:false,appSessionIssued:false,
    countyGrantConfirmed:false,releaseAuthorized:false,
  });
  assert.ok(Object.isFrozen(got));
  assert.equal(Object.hasOwn(got,'approved'),false);
});
test('62D-C14B2C2A activation is distinct and requires suspended rev',()=>{
  const got=policy.reviewSnapshots(fixture('activate'));
  assert.equal(got.phase,'activate');
  assert.equal(got.expectedAccountRevision,'1');
  assert.equal(got.authorization,'none');
});
test('62D-C14B2C2A no arbitrary phase or incomplete top-level input',()=>{
  for(const input of [null,undefined,{},[],{phase:'enroll_suspended'},
    {...fixture(),phase:'approve_anything'},
    {...fixture(),clientRole:'admin'}])
    assert.equal(policy.reviewSnapshots(input),null);
});
test('62D-C14B2C2A refuses inherited and accessor top-level evidence',()=>{
  const a=Object.create({grant:'admin'});Object.assign(a,fixture());
  assert.equal(policy.reviewSnapshots(a),null);
  const b=fixture();Object.defineProperty(b,'phase',{get(){throw Error('untrusted getter')}});
  assert.equal(policy.reviewSnapshots(b),null);
});
test('62D-C14B2C2A reviewer identity must be separately verified',()=>{
  const base=fixture();
  for(const patch of [{providerIdentityConfirmed:false},{provider:'other'},
    {issuer:'https://wrongproject.supabase.co/auth/v1'},
    {subject:'not-uuid'},{releaseAuthorized:true}])
    assert.equal(change(base,'reviewerIdentity',patch),null);
});
test('62D-C14B2C2A applicant identity must be separately verified',()=>{
  const base=fixture();
  for(const patch of [{providerIdentityConfirmed:false},{provider:'other'},
    {issuer:'https://wrongproject.supabase.co/auth/v1'},
    {subject:'not-uuid'},{releaseAuthorized:true}])
    assert.equal(change(base,'applicantIdentity',patch),null);
});
test('62D-C14B2C2A reviewer cannot equal applicant',()=>{
  const base=fixture();
  assert.equal(change(base,'reviewerIdentity',{subject:APPLICANT}),null);
});
test('62D-C14B2C2A user-provided role or metadata cannot become authority',()=>{
  const base=fixture();
  assert.equal(change(base,'reviewerIdentity',{role:'admin'}),null);
  assert.equal(change(base,'applicantIdentity',{app_metadata:{role:'admin'}}),null);
});
test('62D-C14B2C2A identities cannot fabricate MFA or county clearance',()=>{
  const base=fixture();
  for(const key of ['reviewerIdentity','applicantIdentity']){
    for(const patch of [{mfaConfirmed:true},{appCountyGrantConfirmed:true},
      {appSessionIssued:true}])
      assert.equal(change(base,key,patch),null);
  }
});
test('62D-C14B2C2A reviewer authority must match live reviewer subject',()=>{
  const base=fixture();
  assert.equal(change(base,'reviewerAuthority',{subject:INVITER}),null);
  assert.equal(change(base,'reviewerAuthority',{subject:APPLICANT}),null);
});
test('62D-C14B2C2A reviewer authority must be active and permission-limited',()=>{
  const base=fixture();
  for(const patch of [{state:'revoked'},{state:'unknown'},
    {permission:'superuser'},{permission:'any'},{current:false},
    {source:'user-metadata'},{source:'replica'}])
    assert.equal(change(base,'reviewerAuthority',patch),null);
});
test('62D-C14B2C2A authority revisions cannot be missing or overflow',()=>{
  const base=fixture();
  for(const revision of ['0','01','-2','9223372036854775808',42,null])
    assert.equal(change(base,'reviewerAuthority',{revision}),null);
});
test('62D-C14B2C2A invitation must bind applicant, issuer and inviter',()=>{
  const base=fixture();
  for(const patch of [{inviteId:'bad'},{subject:REVIEWER},
    {issuer:'https://wrongproject.supabase.co/auth/v1'},
    {issuedBy:APPLICANT},{issuedBy:REVIEWER},{issuedBy:'bad'}])
    assert.equal(change(base,'invitation',patch),null);
});
test('62D-C14B2C2A invitation must be redeemed and have hashed nonce',()=>{
  const base=fixture();
  for(const patch of [{state:'pending'},{state:'revoked'},
    {nonceDigest:'not-a-digest'},{nonceDigest:'F'.repeat(64)}])
    assert.equal(change(base,'invitation',patch),null);
});
test('62D-C14B2C2A invitation expires after at most one day',()=>{
  const base=fixture();
  for(const expiresAtMs of [NOW-1,NOW,NOW+86400001,NaN,'tomorrow'])
    assert.equal(change(base,'invitation',{expiresAtMs}),null);
});
test('62D-C14B2C2A request must bind exact invite, applicant and issuer',()=>{
  const base=fixture();
  for(const patch of [{requestId:'bad'},{inviteId:REQUEST},
    {subject:REVIEWER},{issuer:'https://wrongproject.supabase.co/auth/v1'}])
    assert.equal(change(base,'request',patch),null);
});
test('62D-C14B2C2A enrollment issuance is from pending request only',()=>{
  const base=fixture();
  for(const state of ['approved_for_enrollment','enrolled_suspended',
    'activated','denied','revoked'])
    assert.equal(change(base,'request',{state}),null);
});
test('62D-C14B2C2A activation issuance is from enrolled-suspended only',()=>{
  const base=fixture('activate');
  for(const state of ['pending','approved_for_enrollment','activated',
    'denied','revoked'])
    assert.equal(change(base,'request',{state}),null);
});
test('62D-C14B2C2A request freshness/revision must be primary-safe',()=>{
  const base=fixture();
  for(const revision of ['0','01','-1','9223372036854775808'])
    assert.equal(change(base,'request',{revision}),null);
  for(const expiresAtMs of [NOW-1,NOW,NOW+86400001,Infinity])
    assert.equal(change(base,'request',{expiresAtMs}),null);
});
test('62D-C14B2C2A any preexisting same-purpose approval is denied',()=>{
  for(const existingPurposeApproval of [undefined,{},false,{state:'consumed'}])
    assert.equal(policy.reviewSnapshots({
      ...fixture(),existingPurposeApproval,
    }),null);
});
test('62D-C14B2C2A intent must match request, applicant, reviewer, issuer',()=>{
  const base=fixture();
  for(const patch of [{approvalId:'bad'},{requestId:INVITE},
    {subject:REVIEWER},{reviewerSubject:INVITER},
    {issuer:'https://wrongproject.supabase.co/auth/v1'}])
    assert.equal(change(base,'approvalIntent',patch),null);
});
test('62D-C14B2C2A purpose is not interchangeable or elevated',()=>{
  const base=fixture();
  assert.equal(change(base,'approvalIntent',{purpose:'activate'}),null);
  assert.equal(change(fixture('activate'),'approvalIntent',{
    purpose:'enroll_suspended',
  }),null);
});
test('62D-C14B2C2A approval nonce is independent hashed and bounded',()=>{
  const base=fixture();
  for(const patch of [{nonceDigest:'a'.repeat(64)},{nonceDigest:'F'.repeat(64)},
    {nonceDigest:'raw-secret'},{expiresAtMs:NOW},
    {expiresAtMs:NOW+900001},{expiresAtMs:NOW+3600000}])
    assert.equal(change(base,'approvalIntent',patch),null);
});
test('62D-C14B2C2A expiry cannot extend beyond invitation/request expiry',()=>{
  const base=fixture();
  assert.equal(change(base,'request',{expiresAtMs:NOW+50000}),null);
  assert.equal(change(base,'invitation',{expiresAtMs:NOW+50000}),null);
});
test('62D-C14B2C2A enrollment refuses any existing or malformed account',()=>{
  const base=fixture();
  for(const account of [undefined,{},false,{subject:APPLICANT,
    account_state:'suspended',revision:'1',source:'app-owned-primary',current:true}])
    assert.equal(policy.reviewSnapshots({...base,account}),null);
});
test('62D-C14B2C2A activation requires fresh suspended primary account',()=>{
  const base=fixture('activate');
  for(const account of [null,{...base.account,account_state:'active'},
    {...base.account,account_state:'closed'},
    {...base.account,subject:INVITER},{...base.account,current:false},
    {...base.account,source:'cache'},{...base.account,revision:'0'}])
    assert.equal(policy.reviewSnapshots({...base,account}),null);
});
test('62D-C14B2C2A activation refuses revision overflow',()=>{
  const base=fixture('activate');
  assert.equal(change(base,'account',{revision:'9223372036854775807'}),null);
});
test('62D-C14B2C2A rejects invalid, nonintegral or forged clock',()=>{
  const base=fixture();
  for(const nowMs of [-1,0,'1795000000000',NaN,Infinity,1.5])
    assert.equal(policy.reviewSnapshots({...base,nowMs}),null);
});
test('62D-C14B2C2A nested extra fields and getters cannot confer grants',()=>{
  const base=fixture();
  for(const key of ['reviewerAuthority','invitation','request','approvalIntent'])
    assert.equal(change(base,key,{role:'admin'}),null);
  const input=fixture();
  Object.defineProperty(input.approvalIntent,'purpose',{get(){
    throw Error('untrusted getter');
  }});
  assert.equal(policy.reviewSnapshots(input),null);
});
test('62D-C14B2C2A pure evaluator has no SQL, network, writer, token or GIS API',()=>{
  assert.match(source,/SOURCE-ONLY, UNROUTED/);
  assert.match(source,/authorization:'none'/);
  assert.match(source,/approvalMutation:'none',accountMutation:'none'/);
  assert.doesNotMatch(source,/createServer\(|fetch\(|process\.env|new Pool\(|INSERT INTO |UPDATE ldos_app_auth|CREATE ROLE|SET ROLE|sb_secret_|service_role|ST_AsGeoJSON/);
});
