import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createUnroutedCurrentAccountLink} from '../../../server/providers/bdp-current-account-link-candidate.js';
const ISSUER='https://abcdefghijabcdefghij.supabase.co/auth/v1';
const SUBJECT='123e4567-e89b-42d3-a456-426614174000';
const TOKEN=['a'.repeat(50),'b'.repeat(50),'c'.repeat(50)].join('.');
const evidence=()=>({
  provider:'supabase',subject:SUBJECT,issuer:ISSUER,
  providerIdentityConfirmed:true,mfaConfirmed:false,
  appCountyGrantConfirmed:false,appSessionIssued:false,releaseAuthorized:false,
});
const account=()=>({
  subject:SUBJECT,account_state:'active',revision:'3',
  source:'app-owned-primary',current:true,
});
const request=()=>({accessToken:TOKEN,signal:new AbortController().signal});
function setup({verification=evidence(),accountRow=account(),onIdentity,onRead}={}){
  const calls=[];
  const identityVerifier={async verifyUserToken(payload){
    calls.push(['verify',payload]); if(onIdentity)return onIdentity(payload);
    return verification;
  }};
  const readPrimaryAccount=async payload=>{
    calls.push(['read',payload]);if(onRead)return onRead(payload);
    return accountRow;
  };
  return {calls,link:createUnroutedCurrentAccountLink({
    identityVerifier,readPrimaryAccount,expectedIssuer:ISSUER,
  })};
}
test('62 requires explicit trusted verifier, primary account reader and Supabase issuer',()=>{
  for(const options of [undefined,{}, {identityVerifier:{}},
    {identityVerifier:{verifyUserToken:()=>{}},readPrimaryAccount:()=>{},expectedIssuer:'http://bad'},
    {identityVerifier:{verifyUserToken:()=>{}},readPrimaryAccount:()=>{},expectedIssuer:'https://evil.example/auth/v1'},
  ])assert.throws(()=>createUnroutedCurrentAccountLink(options),TypeError);
});
test('62 rejects absent, malformed and unsolicited input fields before any external call',async()=>{
  const {link,calls}=setup();
  for(const value of [undefined,null,{},[],{accessToken:TOKEN},
    {accessToken:TOKEN,signal:'not signal'},
    {accessToken:'invalid',signal:new AbortController().signal},
    {accessToken:TOKEN,signal:new AbortController().signal,role:'admin'},
  ])assert.equal(await link.getCandidate(value),null);
  assert.equal(calls.length,0);
});
test('62 blocks an already cancelled request before verification',async()=>{
  const {link,calls}=setup();const input=request();
  const abort=new AbortController();abort.abort();
  assert.equal(await link.getCandidate({...input,signal:abort.signal}),null);
  assert.equal(calls.length,0);
});
test('62 returns a frozen identity-account candidate with no county grant or session',async()=>{
  const {link}=setup();const result=await link.getCandidate(request());
  assert.deepEqual(result,{
    kind:'unrouted-account-link-candidate',issuer:ISSUER,
    subject:SUBJECT,accountEpoch:'3',mfaConfirmed:false,
    appSessionIssued:false,countyGrantConfirmed:false,releaseAuthorized:false,
  });
  assert.equal(Object.isFrozen(result),true);
  assert.ok(!Object.hasOwn(result,'canPublish'));
  assert.ok(!Object.hasOwn(result,'accountAuthorized'));
});
test('62 verifies through the existing provider before reading private current account',async()=>{
  const {link,calls}=setup();const input=request();
  await link.getCandidate(input);
  assert.deepEqual(calls.map(x=>x[0]),['verify','read']);
  assert.deepEqual(calls[0][1],input);
  assert.deepEqual(calls[1][1],{subject:SUBJECT,signal:input.signal});
});
test('62 an unavailable provider never queries app accounts',async()=>{
  const {link,calls}=setup({verification:null});
  assert.equal(await link.getCandidate(request()),null);
  assert.deepEqual(calls.map(x=>x[0]),['verify']);
});
test('62 a forged user metadata role is never used as account evidence',async()=>{
  const {link,calls}=setup({verification:{...evidence(),raw_user_meta_data:{role:'admin'}}});
  assert.equal(await link.getCandidate(request()),null);
  assert.deepEqual(calls.map(x=>x[0]),['verify']);
});
test('62 wrong identity issuer or provider never reaches application account',async()=>{
  for(const changes of [{issuer:'https://different12345.supabase.co/auth/v1'},
    {provider:'other'}, {providerIdentityConfirmed:false},
  ]){
    const {link,calls}=setup({verification:{...evidence(),...changes}});
    assert.equal(await link.getCandidate(request()),null);
    assert.equal(calls.length,1);
  }
});
test('62 unverified MFA or county metadata never upgrades a candidate to authority',async()=>{
  for(const patch of [{mfaConfirmed:true},{appCountyGrantConfirmed:true},
    {appSessionIssued:true},{releaseAuthorized:true}]){
    const {link,calls}=setup({verification:{...evidence(),...patch}});
    assert.equal(await link.getCandidate(request()),null);
    assert.equal(calls.length,1);
  }
});
test('62 provider subject must be a syntactically valid UUID',async()=>{
  for(const id of ['',null,'not-a-uuid','123e4567-e89b-42d3-a456-426614174000;drop']){
    const {link}=setup({verification:{...evidence(),subject:id}});
    assert.equal(await link.getCandidate(request()),null);
  }
});
test('62 missing private account and suspended or closed account fail closed',async()=>{
  for(const row of [null,{...account(),account_state:'suspended'},
    {...account(),account_state:'closed'}]){
    const {link}=setup({accountRow:row});
    assert.equal(await link.getCandidate(request()),null);
  }
});
test('62 a primary reader returning undefined denies account linking',async()=>{
  const {link}=setup({onRead:async()=>undefined});
  assert.equal(await link.getCandidate(request()),null);
});
test('62 mismatched account subject is not linked to a verified provider identity',async()=>{
  const {link}=setup({accountRow:{...account(),subject:'22222222-2222-4222-8222-222222222222'}});
  assert.equal(await link.getCandidate(request()),null);
});
test('62 stale replicas, unknown source and unconfirmed primary reads are denied',async()=>{
  for(const patch of [
    {source:'read-replica'}, {source:'provider-claims'},
    {source:null}, {current:false},{current:'true'},
  ]){
    const {link}=setup({accountRow:{...account(),...patch}});
    assert.equal(await link.getCandidate(request()),null);
  }
});
test('62 rejects zero, unsafe numeric, malformed, overflow or padded revisions',async()=>{
  for(const revision of ['0','-1','01',0,3,3.5,NaN,'3.0',
    '9223372036854775808','999999999999999999999999',' 3','3 ']){
    const {link}=setup({accountRow:{...account(),revision}});
    assert.equal(await link.getCandidate(request()),null,String(revision));
  }
});
test('62 exact private account row rejects extra properties and accessor tricks',async()=>{
  for(const row of [{...account(),countyGrants:['48453']},
    {...account(),email:'private@example.invalid'},
    Object.defineProperty({...account()},'revision',{get(){throw Error('bad accessor')}}),
  ]){
    const {link}=setup({accountRow:row});
    assert.equal(await link.getCandidate(request()),null);
  }
});
test('62 provider and primary account errors are generic null and never leaked',async()=>{
  for(const opts of [
    {onIdentity:async()=>{throw Error('RAW_JWT_SHOULD_NOT_LEAK')}},
    {onRead:async()=>{throw Error('DATABASE_PASSWORD_SHOULD_NOT_LEAK')}},
  ]){
    const {link}=setup(opts);const result=await link.getCandidate(request());
    assert.equal(result,null);
  }
});
test('62 cancellation after provider verification prevents any primary read',async()=>{
  const abort=new AbortController();let queried=0;
  const {link}=setup({onIdentity:async()=>{abort.abort();return evidence()},
    onRead:async()=>{queried++;return account()}});
  assert.equal(await link.getCandidate({accessToken:TOKEN,signal:abort.signal}),null);
  assert.equal(queried,0);
});
test('62 cancellation during primary read prevents a candidate being returned',async()=>{
  const abort=new AbortController();
  const {link}=setup({onRead:async()=>{abort.abort();return account()}});
  assert.equal(await link.getCandidate({accessToken:TOKEN,signal:abort.signal}),null);
});
test('62 no HTTP, PostGIS, Supabase Admin, account writes or cookies are introduced',()=>{
  const source=readFileSync(new URL(
    '../../../server/providers/bdp-current-account-link-candidate.js',import.meta.url,
  ),'utf8');
  assert.match(source,/SERVER-ONLY, UNROUTED/);
  assert.match(source,/source!=='app-owned-primary'/);
  assert.match(source,/releaseAuthorized:false/);
  assert.doesNotMatch(source,/createServer\(|fetch\(|new Pool\(|ST_AsGeoJSON|INSERT INTO|UPDATE ldos_app_auth/);
  assert.doesNotMatch(source,/Set-Cookie|signInWithPassword|sb_secret_|service_role/);
});
