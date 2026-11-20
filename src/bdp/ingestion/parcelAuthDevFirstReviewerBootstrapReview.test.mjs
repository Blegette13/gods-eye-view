import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createUnroutedFirstReviewerBootstrapReview} from '../../../server/providers/bdp-unrouted-first-reviewer-bootstrap-review.js';

const ISS='https://abcdefghijabcdefghij.supabase.co/auth/v1';
const SUBJECT='11111111-1111-4111-8111-111111111111';
const SECURITY='22222222-2222-4222-8222-222222222222';
const OPERATIONS='33333333-3333-4333-8333-333333333333';
const NOW=1795000000000;
const policy=createUnroutedFirstReviewerBootstrapReview({expectedIssuer:ISS});
const fixture=()=>({
  candidate:{subject:SUBJECT,issuer:ISS},
  custodianReviews:[
    {custodianSubject:SECURITY,channel:'out_of_band_security',
      intent:'request_external_verification_only',digest:'a'.repeat(64),
      issuedAtMs:NOW-60000,expiresAtMs:NOW+60000},
    {custodianSubject:OPERATIONS,channel:'out_of_band_operations',
      intent:'request_external_verification_only',digest:'b'.repeat(64),
      issuedAtMs:NOW-60000,expiresAtMs:NOW+60000},
  ],
  databaseSnapshot:{database:'ldos_c14b_disposable',
    source:'untrusted-review-snapshot',currentPrimary:true,readOnly:true,
    reviewerCount:0,sessionCount:0,countyGrantCount:0,revision:'1'},
  nowMs:NOW,
});
const change=(key,patch)=>policy.reviewPlan({
  ...fixture(),[key]:{...fixture()[key],...patch},
});
const witness=(i,patch)=>{const f=fixture();f.custodianReviews[i]={...f.custodianReviews[i],...patch};return policy.reviewPlan(f)};
const src=readFileSync(new URL(
  '../../../server/providers/bdp-unrouted-first-reviewer-bootstrap-review.js',import.meta.url
),'utf8');

test('62D-C14B2C3A requires exact fixed trusted Supabase issuer',()=>{
  for(const expectedIssuer of [undefined,null,'','http://invalid','https://bad.test/auth/v1',ISS+'/'])
    assert.throws(()=>createUnroutedFirstReviewerBootstrapReview({expectedIssuer}),TypeError);
});
test('62D-C14B2C3A has one frozen review-only entrypoint',()=>{
  assert.ok(Object.isFrozen(policy));
  assert.deepEqual(Object.keys(policy),['reviewPlan']);
  assert.equal(typeof policy.reviewPlan,'function');
});
test('62D-C14B2C3A baseline returns frozen NON-AUTHORIZING review proposal',()=>{
  const got=policy.reviewPlan(fixture());
  assert.ok(Object.isFrozen(got));
  assert.equal(got.kind,'unrouted-first-reviewer-bootstrap-design-review');
  assert.equal(got.issuer,ISS);
  assert.equal(got.candidateSubject,SUBJECT);
  assert.equal(got.independentCustodianReviewCount,2);
  assert.equal(got.authorization,'none');
  assert.equal(got.reviewerAuthorityMutation,'none');
  assert.equal(got.accountMutation,'none');
  assert.equal(got.canExecute,false);
  assert.equal(got.gisAccessGranted,false);
});
test('62D-C14B2C3A never emits witness digest or raw secret',()=>{
  const got=policy.reviewPlan(fixture());
  const txt=JSON.stringify(got);
  assert.doesNotMatch(txt,/a{64}|b{64}|token|password|secret|credentialValue/i);
  assert.equal(Object.hasOwn(got,'custodianReviews'),false);
});
test('62D-C14B2C3A bootstrap review still requires independent verification',()=>{
  const got=policy.reviewPlan(fixture());
  for(const key of ['requiresOperatorCeremony','requiresIndependentProviderVerification',
    'requiresProtectedCredentialChannels','requiresLivePrimaryAttestation',
    'requiresAuditedAtomicBootstrap','requiresRecoveryAndRevocationDrill'])
    assert.equal(got[key],true,key);
});
test('62D-C14B2C3A review never grants session, county or GIS clearance',()=>{
  const got=policy.reviewPlan(fixture());
  assert.equal(got.sessionIssued,false);
  assert.equal(got.countyPermissionGranted,false);
  assert.equal(got.gisAccessGranted,false);
  assert.equal(got.credentialCreation,'none');
  assert.equal(got.auditMutation,'none');
});
test('62D-C14B2C3A missing fields or extra caller claims deny',()=>{
  for(const input of [null,undefined,{},[],{...fixture(),admin:true},
    {candidate:fixture().candidate},{...fixture(),reviewerRole:'superuser'}])
    assert.equal(policy.reviewPlan(input),null);
});
test('62D-C14B2C3A prototype pollution is not authority',()=>{
  const proto=Object.create({admin:true});Object.assign(proto,fixture());
  assert.equal(policy.reviewPlan(proto),null);
  const bad=fixture();Object.defineProperty(bad,'candidate',{get(){throw Error('malicious getter')}});
  assert.equal(policy.reviewPlan(bad),null);
});
test('62D-C14B2C3A candidate must have exact identity shape',()=>{
  assert.equal(change('candidate',{role:'admin'}),null);
  assert.equal(change('candidate',{metadata:{is_admin:true}}),null);
  assert.equal(change('candidate',{subject:'not-uuid'}),null);
});
test('62D-C14B2C3A candidate issuer is fixed to project',()=>{
  assert.equal(change('candidate',{issuer:'https://wrongproject.supabase.co/auth/v1'}),null);
});
test('62D-C14B2C3A custodian reviews must be exactly two',()=>{
  const a=fixture();a.custodianReviews=[];
  const b=fixture();b.custodianReviews=[b.custodianReviews[0]];
  const c=fixture();c.custodianReviews.push({...c.custodianReviews[0]});
  for(const input of [a,b,c])assert.equal(policy.reviewPlan(input),null);
});
test('62D-C14B2C3A no forged array properties or sparse reviews',()=>{
  const f=fixture();f.custodianReviews.extra='role';
  assert.equal(policy.reviewPlan(f),null);
  const g=fixture();delete g.custodianReviews[0];
  assert.equal(policy.reviewPlan(g),null);
});
test('62D-C14B2C3A candidate cannot be custodian',()=>{
  assert.equal(witness(0,{custodianSubject:SUBJECT}),null);
  assert.equal(witness(1,{custodianSubject:SUBJECT}),null);
});
test('62D-C14B2C3A same custodian cannot attest twice',()=>{
  assert.equal(witness(1,{custodianSubject:SECURITY}),null);
});
test('62D-C14B2C3A custodians must use distinct review channels',()=>{
  assert.equal(witness(1,{channel:'out_of_band_security'}),null);
  assert.equal(witness(0,{channel:'out_of_band_operations'}),null);
});
test('62D-C14B2C3A arbitrary channel or purpose denies',()=>{
  assert.equal(witness(1,{channel:'browser_metadata'}),null);
  assert.equal(witness(0,{intent:'create_administrator_now'}),null);
});
test('62D-C14B2C3A witness digests are unique opaque lower-hex values',()=>{
  assert.equal(witness(1,{digest:'a'.repeat(64)}),null);
  assert.equal(witness(1,{digest:'not-a-digest'}),null);
  assert.equal(witness(1,{digest:'A'.repeat(64)}),null);
});
test('62D-C14B2C3A witness UUID and exact data shape required',()=>{
  assert.equal(witness(0,{custodianSubject:'bad-uuid'}),null);
  assert.equal(witness(1,{role:'admin'}),null);
  const f=fixture();Object.defineProperty(f.custodianReviews[0],'channel',{
    get(){throw Error('accessor')},
  });assert.equal(policy.reviewPlan(f),null);
});
test('62D-C14B2C3A witness issue times cannot be future or stale',()=>{
  for(const issuedAtMs of [NOW+1,NOW-900001,'now',null,NaN])
    assert.equal(witness(0,{issuedAtMs}),null);
});
test('62D-C14B2C3A expiry must be positive within fifteen-minute window',()=>{
  for(const expiresAtMs of [NOW,NOW-1,NOW+1000000,'tomorrow',null])
    assert.equal(witness(0,{expiresAtMs}),null);
});
test('62D-C14B2C3A review envelope may not be expired at review time',()=>{
  const f=fixture();
  f.custodianReviews[1].expiresAtMs=NOW;
  assert.equal(policy.reviewPlan(f),null);
});
test('62D-C14B2C3A snapshot must be synthetic disposable review only',()=>{
  assert.equal(change('databaseSnapshot',{database:'ldos_auth_dev'}),null);
  assert.equal(change('databaseSnapshot',{source:'production-database'}),null);
  assert.equal(change('databaseSnapshot',{source:'signed-backup'}),null);
});
test('62D-C14B2C3A snapshot cannot imply writable or standby primary',()=>{
  assert.equal(change('databaseSnapshot',{currentPrimary:false}),null);
  assert.equal(change('databaseSnapshot',{readOnly:false}),null);
});
test('62D-C14B2C3A first reviewer assumes zero current reviewers and grants',()=>{
  for(const key of ['reviewerCount','sessionCount','countyGrantCount'])
    assert.equal(change('databaseSnapshot',{[key]:1}),null,key);
});
test('62D-C14B2C3A revision guard rejects zero, negatives and overflow',()=>{
  for(const revision of [0,'0','01','-1','9223372036854775808',null])
    assert.equal(change('databaseSnapshot',{revision}),null);
});
test('62D-C14B2C3A no caller authority from snapshot role metadata',()=>{
  assert.equal(change('databaseSnapshot',{canBootstrap:true}),null);
  assert.equal(change('databaseSnapshot',{password:'something'}),null);
});
test('62D-C14B2C3A timestamp must be finite positive safe integer',()=>{
  for(const nowMs of [null,0,-1,Infinity,NaN,1.25,String(NOW)])
    assert.equal(policy.reviewPlan({...fixture(),nowMs}),null);
});
test('62D-C14B2C3A module is pure, unrouted and cannot create reviewer rights',()=>{
  assert.match(src,/NON-AUTHORIZING review proposal/);
  assert.match(src,/canExecute:false/);
  assert.match(src,/reviewerAuthorityMutation:'none'/);
  assert.doesNotMatch(src,/fetch\(|process\.env|createServer\(|new Pool\(|CREATE ROLE|GRANT EXECUTE|INSERT INTO|UPDATE ldos_app_auth|sb_secret_|ST_AsGeoJSON/);
});
