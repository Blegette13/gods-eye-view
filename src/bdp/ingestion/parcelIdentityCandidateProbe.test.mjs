import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createUnroutedCandidateIdentityProbe} from
  '../../../server/providers/bdp-parcel-identity-candidate-probe.js';

const DIGEST='a'.repeat(64);
const COUNTY='48453';
const TIME=1_000_000;
const row=(more={})=>({
  sessionDigest:DIGEST,countyFips:COUNTY,accountState:'active',
  sessionState:'active',mfaState:'verified',countyGrantState:'allowed',
  accountEpoch:'7',sessionEpoch:'11',mfaEpoch:'3',countyGrantEpoch:'5',
  issuedAtMs:900_000,expiresAtMs:1_500_000,observedAtMs:999_990,
  ...more,
});
const request=(more={})=>({
  sessionDigest:DIGEST,countyFips:COUNTY,
  signal:new AbortController().signal,...more,
});
const refused=Object.freeze({
  candidateConsistent:false,releaseAuthorized:false,actualProviderConnected:false,
});
const consistent=Object.freeze({
  candidateConsistent:true,releaseAuthorized:false,actualProviderConnected:false,
});
const setup=(makeRows=[row(),row()],clock=()=>TIME)=>{
  const calls=[];
  const adapter=createUnroutedCandidateIdentityProbe({
    fetchCandidate:async input=>{
      calls.push(input);
      return typeof makeRows==='function'
        ?makeRows(calls.length,input)
        :makeRows[calls.length-1];
    },
    now:clock,
  });
  return {adapter,calls};
};

test('51 factory requires explicit candidate fixture source and clock',()=>{
  for(const invalid of [undefined,null,{},[],{fetchCandidate:()=>row()},
    {now:()=>TIME}, {fetchCandidate:null,now:()=>TIME}])
    assert.throws(()=>createUnroutedCandidateIdentityProbe(invalid),TypeError);
});
test('51 rejects caller-injected permission, reader, public-route or debug options',()=>{
  for(const extra of [
    {approved:true}, {readSessionCountyEpoch:async()=>({})},
    {allowGeometryRelease:true},{bypassMfa:true},
  ])assert.throws(()=>createUnroutedCandidateIdentityProbe({
    fetchCandidate:async()=>row(),now:()=>TIME,...extra,
  }),TypeError);
});
test('51 two exact copies are consistent evidence but never release permission',async()=>{
  const {adapter,calls}=setup();
  const result=await adapter.inspectTwoCandidateReads(request());
  assert.deepEqual(result,consistent);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(calls.length,2);
  assert.deepEqual(Object.keys(adapter),['inspectTwoCandidateReads']);
});
test('51 accepts a later nondecreasing timestamp while keeping revisions stable',async()=>{
  const {adapter}=setup([row(),row({observedAtMs:999_995})]);
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),consistent);
});
test('51 detects account epoch A→B→A despite identical final account state',async()=>{
  const {adapter}=setup([row(),row({accountEpoch:'9'})]);
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
});
test('51 detects session epoch changes even when both session flags are active',async()=>{
  const {adapter}=setup([row(),row({sessionEpoch:'13'})]);
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
});
test('51 detects MFA epoch changes even when both say verified',async()=>{
  const {adapter}=setup([row(),row({mfaEpoch:'5'})]);
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
});
test('51 detects county grant epoch change even when both say allowed',async()=>{
  const {adapter}=setup([row(),row({countyGrantEpoch:'7'})]);
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
});
test('51 account suspended during private lookup denies',async()=>{
  const {adapter}=setup([row(),row({accountState:'suspended'})]);
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
});
test('51 session revoked during private lookup denies',async()=>{
  const {adapter}=setup([row(),row({sessionState:'revoked'})]);
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
});
test('51 MFA removed or county grant revoked denies',async()=>{
  for(const delta of [{mfaState:'expired'},{countyGrantState:'denied'}]){
    const {adapter}=setup([row(),row(delta)]);
    assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
  }
});
test('51 wrong digest or county in second lookup denies',async()=>{
  for(const delta of [
    {sessionDigest:'b'.repeat(64)},
    {countyFips:'48029'},
  ]){
    const {adapter}=setup([row(),row(delta)]);
    assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
  }
});
test('51 unknown or missing first candidate cannot access second lookup',async()=>{
  for(const first of [null,{},row({unverified:true}),row({epoch:'4'})]){
    const {adapter,calls}=setup([first,row()]);
    assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
    assert.equal(calls.length,1);
  }
});
test('51 unknown, duplicate, extra or stale second snapshot refuses',async()=>{
  for(const second of [null,[],row({extra:true}),
    row({observedAtMs:999_989}),row({expiresAtMs:TIME})]){
    const {adapter,calls}=setup([row(),second]);
    assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
    assert.equal(calls.length,2);
  }
});
test('51 revoked session cannot be resurrected with the old candidate',async()=>{
  const {adapter}=setup([row({sessionState:'revoked'}),row()]);
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
});
test('51 rejecting malformed request must not contact injected source',async()=>{
  const {adapter,calls}=setup();
  for(const input of [null,{},[],request({countyFips:'06037'}),
    request({sessionDigest:'A'.repeat(64)}),
    request({sessionDigest:'a'.repeat(63)}),
    request({signal:'untrusted'}),
    request({browserSaysAuthorized:true})]){
    assert.deepEqual(await adapter.inspectTwoCandidateReads(input),refused);
  }
  assert.equal(calls.length,0);
});
test('51 abort before first read never calls provider',async()=>{
  const controller=new AbortController();controller.abort();
  const {adapter,calls}=setup();
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request({
    signal:controller.signal,
  })),refused);
  assert.equal(calls.length,0);
});
test('51 abort after first read prevents second read',async()=>{
  const controller=new AbortController();
  const {adapter,calls}=setup(async n=>{
    if(n===1)controller.abort();
    return row();
  });
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request({
    signal:controller.signal,
  })),refused);
  assert.equal(calls.length,1);
});
test('51 abort during second read discards prior matching snapshot',async()=>{
  const controller=new AbortController();
  const {adapter,calls}=setup(async n=>{
    if(n===2)controller.abort();
    return row();
  });
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request({
    signal:controller.signal,
  })),refused);
  assert.equal(calls.length,2);
});
test('51 provider error after first read fails closed without source details',async()=>{
  const {adapter,calls}=setup(async n=>{
    if(n===2)throw Error('RAW_AUTHENTICATION_PROVIDER_SECRETS');
    return row();
  });
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
  assert.equal(calls.length,2);
});
test('51 clock rejection or rollback fails closed',async()=>{
  for(const values of [[0],[TIME,TIME-1],[TIME,TIME,TIME-1],
    [TIME,NaN],[TIME,Infinity],[TIME,TIME,1.2]]){
    let i=0;const {adapter}=setup([row(),row()],
      ()=>values[Math.min(i++,values.length-1)]);
    assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
  }
});
test('51 expiration between first and second observation fails closed',async()=>{
  const first=TIME-10;
  let idx=0;const {adapter}=setup([
    row({expiresAtMs:TIME+1}),row({expiresAtMs:TIME+1}),
  ],()=>[first,TIME,TIME+2][idx++]);
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
});
test('51 mutable provider object cannot rewrite earlier copied epoch snapshot',async()=>{
  const mutable=row();
  const {adapter}=setup(async n=>{
    if(n===2)mutable.countyGrantEpoch='7';
    return mutable;
  });
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request()),refused);
});
test('51 each injected request is minimal frozen and uses the same live signal',async()=>{
  const signal=new AbortController().signal;
  const {adapter,calls}=setup();
  assert.deepEqual(await adapter.inspectTwoCandidateReads(request({signal})),consistent);
  for(const call of calls){
    assert.deepEqual(Object.keys(call),['sessionDigest','countyFips','signal']);
    assert.equal(call.sessionDigest,DIGEST);
    assert.equal(call.countyFips,COUNTY);
    assert.strictEqual(call.signal,signal);
    assert.equal(Object.isFrozen(call),true);
  }
});
test('51 identical candidates can miss later revocation; no on-wire release permitted',async()=>{
  let revoked=false;
  const {adapter}=setup(async()=>revoked?row({sessionState:'revoked'}):row());
  const result=await adapter.inspectTwoCandidateReads(request());
  revoked=true; // The real authority might change AFTER a pair of reads.
  assert.equal(result.candidateConsistent,true);
  assert.equal(revoked,true);
  assert.equal(result.releaseAuthorized,false,
    'Pre/post equality is never an atomic network response release');
  assert.equal(result.actualProviderConnected,false);
});
test('51 review probe is unrouted and creates no real authentication or transport',()=>{
  const src=readFileSync(new URL(
    '../../../server/providers/bdp-parcel-identity-candidate-probe.js',
    import.meta.url),'utf8');
  assert.match(src,/UNROUTED \/ REVIEW-ONLY \/ SYNTHETIC/);
  assert.match(src,/returns releaseAuthorized:false in ALL cases/);
  assert.match(src,/not proof of source/);
  assert.doesNotMatch(src,/new Pool\(|createServer\(|\.listen\(|app\.get\(/);
  assert.doesNotMatch(src,/signJwt|issueToken|setCookie|GRANT EXECUTE|ST_AsGeoJSON/);
});
