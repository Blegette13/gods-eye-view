import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  isCanonicalCandidateIdentitySnapshot,
  sameCandidateIdentityRevision,
  inspectCandidateIdentityContract,
} from '../../../server/providers/bdp-parcel-identity-authority-contract.js';

const DIGEST='a'.repeat(64);
const CTX=Object.freeze({
  sessionDigest:DIGEST,countyFips:'48453',nowMs:1_000_000,
});
const candidate=(other={})=>({
  sessionDigest:DIGEST,countyFips:'48453',accountState:'active',
  sessionState:'active',mfaState:'verified',countyGrantState:'allowed',
  accountEpoch:'7',sessionEpoch:'11',mfaEpoch:'3',countyGrantEpoch:'5',
  issuedAtMs:900_000,expiresAtMs:1_500_000,observedAtMs:999_990,
  ...other,
});
test('50 canonical synthetic candidate matches strictly specified shape',()=>{
  assert.equal(isCanonicalCandidateIdentitySnapshot(candidate(),CTX),true);
});
test('50 even a perfect candidate never claims authorization or a connected provider',()=>{
  assert.deepEqual(inspectCandidateIdentityContract(candidate(),CTX),{
    contractMatches:true,releaseAuthorized:false,actualProviderConnected:false,
  });
});
test('50 malformed, absent or forged candidates never claim release authorization',()=>{
  for(const row of [null,{},[],{...candidate(),allowPublic:true}]){
    const result=inspectCandidateIdentityContract(row,CTX);
    assert.equal(result.contractMatches,false);
    assert.equal(result.releaseAuthorized,false);
    assert.equal(result.actualProviderConnected,false);
    assert.equal(Object.isFrozen(result),true);
  }
});
test('50 wrong digest, wrong county, untrusted digest format fail closed',()=>{
  for(const bad of [
    {sessionDigest:'b'.repeat(64)},
    {sessionDigest:'A'.repeat(64)},
    {sessionDigest:'a'.repeat(63)},
    {countyFips:'48029'},
    {countyFips:'06037'},
    {countyFips:'4845'},
  ])assert.equal(isCanonicalCandidateIdentitySnapshot(candidate(bad),CTX),false);
});
test('50 inactive accounts and revoked sessions fail candidate shape',()=>{
  for(const bad of [
    {accountState:'suspended'},
    {accountState:'locked'},
    {sessionState:'revoked'},
    {sessionState:'expired'},
    {accountState:true},
    {sessionState:null},
  ])assert.equal(isCanonicalCandidateIdentitySnapshot(candidate(bad),CTX),false);
});
test('50 missing current MFA and denied county grant cannot pass shape',()=>{
  for(const bad of [
    {mfaState:'pending'},
    {mfaState:false},
    {mfaState:'expired'},
    {countyGrantState:'denied'},
    {countyGrantState:false},
  ])assert.equal(isCanonicalCandidateIdentitySnapshot(candidate(bad),CTX),false);
});
test('50 all four epochs must be canonical positive PG bigint strings',()=>{
  for(const field of ['accountEpoch','sessionEpoch','mfaEpoch','countyGrantEpoch']){
    for(const value of [
      '0','-1','01','2.5',' 4','4 ','9223372036854775808',3,null,
    ])assert.equal(isCanonicalCandidateIdentitySnapshot(
      candidate({[field]:value}),CTX),false,field+': '+value);
  }
  assert.equal(isCanonicalCandidateIdentitySnapshot(candidate({
    countyGrantEpoch:'9007199254740993',
  }),CTX),true);
});
test('50 extra, missing, symbols, accessors and inherited prototypes are denied',()=>{
  const absent=candidate();delete absent.accountEpoch;
  const symbol=candidate();symbol[Symbol('secret')]='x';
  const getter=candidate();
  Object.defineProperty(getter,'accountEpoch',{get(){return '7'},enumerable:true});
  for(const value of [
    absent,symbol,getter,new (class Identity {})(),
    Object.assign(Object.create({sessionDigest:DIGEST}),candidate()),
  ])assert.equal(isCanonicalCandidateIdentitySnapshot(value,CTX),false);
});
test('50 a throwing untrusted getter or proxy returns denial, not exception',()=>{
  const getter=candidate();
  Object.defineProperty(getter,'countyFips',{
    enumerable:true,get(){throw Error('UNTRUSTED_PROVIDER_VALUE')},
  });
  const proxy=new Proxy(candidate(),{
    ownKeys(){throw Error('HOSTILE_PROXY_TRAP')},
  });
  for(const value of [getter,proxy]){
    assert.doesNotThrow(()=>isCanonicalCandidateIdentitySnapshot(value,CTX));
    assert.equal(isCanonicalCandidateIdentitySnapshot(value,CTX),false);
  }
});
test('50 review context must be exact server digest, Texas county and safe now',()=>{
  for(const value of [
    null,{},[],{...CTX,extra:true},
    {...CTX,sessionDigest:'A'.repeat(64)},
    {...CTX,countyFips:'06037'},
    {...CTX,nowMs:0},{...CTX,nowMs:1.2},
    {...CTX,nowMs:Number.MAX_SAFE_INTEGER+1},
  ])assert.equal(isCanonicalCandidateIdentitySnapshot(candidate(),value),false);
});
test('50 expired, inverted, future-issued or malformed session timing denies',()=>{
  for(const bad of [
    {expiresAtMs:CTX.nowMs},
    {expiresAtMs:CTX.nowMs-1},
    {issuedAtMs:0},
    {issuedAtMs:CTX.nowMs+1},
    {expiresAtMs:899_999},
    {issuedAtMs:900_000.5},
    {expiresAtMs:'1500000'},
  ])assert.equal(isCanonicalCandidateIdentitySnapshot(candidate(bad),CTX),false);
});
test('50 future observed timestamp and observation before session issuance deny',()=>{
  for(const bad of [
    {observedAtMs:CTX.nowMs+1},
    {observedAtMs:899_999},
    {observedAtMs:0},
    {observedAtMs:'999999'},
  ])assert.equal(isCanonicalCandidateIdentitySnapshot(candidate(bad),CTX),false);
});
test('50 overlong session lifetime is denied even if state looks active',()=>{
  assert.equal(isCanonicalCandidateIdentitySnapshot(candidate({
    issuedAtMs:1,expiresAtMs:CTX.nowMs+8*60*60*1000+2,
  }),CTX),false);
});
test('50 identical snapshot revisions match for review only, not release',()=>{
  const a=candidate();
  const b=candidate({observedAtMs:999_995});
  assert.equal(sameCandidateIdentityRevision(a,b,CTX),true);
  assert.equal(inspectCandidateIdentityContract(b,CTX).releaseAuthorized,false);
});
test('50 account/session/MFA/grant revocation ABA revisions invalidate equality',()=>{
  const old=candidate();
  for(const epoch of ['accountEpoch','sessionEpoch','mfaEpoch','countyGrantEpoch']){
    assert.equal(sameCandidateIdentityRevision(old,candidate({
      [epoch]:String(BigInt(old[epoch])+2n),
    }),CTX),false,epoch);
  }
});
test('50 changing expiration, issuance or decreasing observation invalidates equality',()=>{
  const old=candidate();
  for(const bad of [
    {expiresAtMs:1_600_000},
    {issuedAtMs:899_000},
    {observedAtMs:999_989},
  ])assert.equal(sameCandidateIdentityRevision(old,candidate(bad),CTX),false);
});
test('50 malformed after snapshot or missing revision never passes comparison',()=>{
  assert.equal(sameCandidateIdentityRevision(candidate(),null,CTX),false);
  assert.equal(sameCandidateIdentityRevision(candidate(),candidate({
    countyGrantEpoch:'0',
  }),CTX),false);
});
test('50 review-only module does not create auth, routes, tokens or DB pools',()=>{
  const code=readFileSync(new URL(
    '../../../server/providers/bdp-parcel-identity-authority-contract.js',
    import.meta.url),'utf8');
  assert.match(code,/REVIEW-ONLY/);
  assert.match(code,/NEVER treat a true result as authority/);
  assert.match(code,/actualProviderConnected:false/);
  assert.match(code,/releaseAuthorized:false/);
  assert.doesNotMatch(code,/new Pool\(|createServer\(|\.listen\(|app\.get\(/);
  assert.doesNotMatch(code,/signJwt|issueToken|setCookie|GRANT EXECUTE/);
});
