import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRIMARY_ACCOUNT_SQL} from '../../../server/providers/bdp-primary-account-reader.js';
import {AUTH_DEV_ROLE_SWITCH_ATTEST_SQL} from '../../../server/providers/bdp-auth-dev-role-switch-pg.js';
import {createUnroutedAuthDevIdentityAccountBridge} from '../../../server/providers/bdp-auth-dev-verified-account-bridge.js';

const ISSUER='https://abcdefghijabcdefghij.supabase.co/auth/v1';
const SUBJECT='123e4567-e89b-42d3-a456-426614174000';
const TOKEN=['a'.repeat(50),'b'.repeat(50),'c'.repeat(50)].join('.');
const SETTINGS={
  host:'127.0.0.1',port:54338,database:'ldos_auth_dev',
  user:'ldos_auth_gateway_login',password:'a'.repeat(64),
};
const BOOL_NAMES=['correct_db','primary_db','correct_login','effective_reader',
  'read_only_tx','safe_login','safe_reader','exact_membership','schema_usage',
  'no_schema_create','subject_read','state_read','revision_read','no_created_at',
  'no_account_writes','no_session_rights','no_county_rights',
  'no_guard_execution','no_candidate_rpc'];
const proof=(changes={})=>({
  command:'SELECT',rowCount:1,
  rows:[{...Object.fromEntries(BOOL_NAMES.map(n=>[n,true])),...changes}],
});
const account=(state='active',revision='3')=>({
  command:'SELECT',rowCount:1,
  fields:['subject','account_state','revision'].map(name=>({name})),
  rows:[[SUBJECT,state,revision]],
});
const absent=()=>({
  command:'SELECT',rowCount:0,
  fields:['subject','account_state','revision'].map(name=>({name})),
  rows:[],
});
const evidence=()=>({
  provider:'supabase',subject:SUBJECT,issuer:ISSUER,
  providerIdentityConfirmed:true,mfaConfirmed:false,
  appCountyGrantConfirmed:false,appSessionIssued:false,
  releaseAuthorized:false,
});
const request=(signal=new AbortController().signal)=>({
  accessToken:TOKEN,signal,
});
function fixture({identity=evidence(),dbRow=account(),attestation=proof(),
  onVerify,onSql,failSql,settings=SETTINGS}={}){
  const calls=[],configs=[],releases=[],closed=[];
  const identityVerifier={async verifyUserToken(input){
    calls.push(['verify',input]);
    if(onVerify)return onVerify(input);
    return identity;
  }};
  const client={
    async query(q){
      const sql=typeof q==='string'?q:q.text;
      calls.push(['sql',sql,q]);
      if(failSql===sql)throw new Error('SECRET_DATABASE_ERROR');
      if(onSql)return onSql(sql,q);
      if(sql===AUTH_DEV_ROLE_SWITCH_ATTEST_SQL)return attestation;
      if(sql===PRIMARY_ACCOUNT_SQL)return dbRow;
      return {command:'OK',rowCount:0,rows:[]};
    },
    release(error){releases.push(error)},
  };
  class Pool {
    constructor(config){configs.push(config)}
    async connect(){calls.push(['connect']);return client}
    on(event,handler){assert.equal(event,'error');assert.equal(typeof handler,'function')}
    async end(){closed.push(true)}
  }
  const bridge=createUnroutedAuthDevIdentityAccountBridge({
    identityVerifier,expectedIssuer:ISSUER,Pool,settings,
  });
  return {bridge,calls,configs,releases,closed};
}

test('62D-C13 requires trusted verifier, exact issuer, Pool and auth-dev settings',()=>{
  for(const opts of [undefined,{}, {identityVerifier:{}},
    {identityVerifier:{verifyUserToken(){}}},
    {identityVerifier:{verifyUserToken(){}},expectedIssuer:'http://bad'},
    {identityVerifier:{verifyUserToken(){}},expectedIssuer:ISSUER,Pool:null,settings:SETTINGS},
    {identityVerifier:{verifyUserToken(){}},expectedIssuer:ISSUER,Pool:class {},settings:{}},
  ])assert.throws(()=>createUnroutedAuthDevIdentityAccountBridge(opts),TypeError);
});
test('62D-C13 factory constructs only one local auth pool, without connecting',async()=>{
  const v=fixture();
  assert.equal(v.configs.length,1);
  assert.equal(v.configs[0].host,'127.0.0.1');
  assert.equal(v.configs[0].port,54338);
  assert.equal(v.configs[0].database,'ldos_auth_dev');
  assert.equal(v.configs[0].user,'ldos_auth_gateway_login');
  assert.equal(v.configs[0].ssl,false);
  assert.deepEqual(v.calls,[]);
  assert.deepEqual(Object.keys(v.bridge).sort(),['close','getCandidate']);
  assert.equal(Object.isFrozen(v.bridge),true);
  await v.bridge.close();
});
test('62D-C13 rejects extra, missing or invalid request metadata before external calls',async()=>{
  const v=fixture();
  for(const input of [null,undefined,{},[],{accessToken:TOKEN},
    {accessToken:TOKEN,signal:42},
    {accessToken:TOKEN,signal:new AbortController().signal,subject:SUBJECT},
    {accessToken:'bad',signal:new AbortController().signal}])
    assert.equal(await v.bridge.getCandidate(input),null);
  assert.deepEqual(v.calls,[]);
  await v.bridge.close();
});
test('62D-C13 rejects already-aborted input before Supabase identity verification',async()=>{
  const v=fixture(),abort=new AbortController();
  abort.abort();
  assert.equal(await v.bridge.getCandidate(request(abort.signal)),null);
  assert.equal(v.calls.length,0);
  await v.bridge.close();
});
test('62D-C13 provider verification MUST happen before SQL checkout',async()=>{
  const v=fixture();
  assert.ok(await v.bridge.getCandidate(request()));
  assert.equal(v.calls[0][0],'verify');
  assert.equal(v.calls[1][0],'connect');
  assert.equal(v.calls[2][1],'BEGIN READ ONLY');
  assert.equal(v.calls[3][1],'SET LOCAL ROLE ldos_auth_account_reader');
  await v.bridge.close();
});
test('62D-C13 candidate uses only provider-verified UUID as query parameter',async()=>{
  const v=fixture(),input=request();
  const got=await v.bridge.getCandidate(input);
  assert.equal(got.subject,SUBJECT);
  const lookups=v.calls.filter(v=>v[1]===PRIMARY_ACCOUNT_SQL);
  assert.equal(lookups.length,1);
  assert.deepEqual(lookups[0][2].values,[SUBJECT]);
  assert.equal(lookups[0][2].rowMode,'array');
  assert.equal(lookups[0][2].text,PRIMARY_ACCOUNT_SQL);
  // The trusted PG adapter consumes AbortSignal before/after the SQL read;
  // it deliberately passes only {text,values,rowMode} to node-postgres.
  assert.deepEqual(Object.keys(lookups[0][2]).sort(),['rowMode','text','values']);
  const verifyCall=v.calls.find(call=>call[0]==='verify');
  assert.equal(verifyCall[1].signal,input.signal);
  await v.bridge.close();
});
test('62D-C13 valid active account returns immutable candidate, never authority',async()=>{
  const v=fixture();
  const got=await v.bridge.getCandidate(request());
  assert.deepEqual(got,{
    kind:'unrouted-account-link-candidate',issuer:ISSUER,
    subject:SUBJECT,accountEpoch:'3',mfaConfirmed:false,
    appSessionIssued:false,countyGrantConfirmed:false,releaseAuthorized:false,
  });
  assert.ok(Object.isFrozen(got));
  assert.ok(!Object.hasOwn(got,'sessionToken'));
  await v.bridge.close();
});
test('62D-C13 each SQL read reattests same pinned client then rolls back',async()=>{
  const v=fixture();
  await v.bridge.getCandidate(request());
  assert.deepEqual(v.calls.filter(x=>x[0]==='sql').map(x=>x[1]),[
    'BEGIN READ ONLY','SET LOCAL ROLE ldos_auth_account_reader',
    AUTH_DEV_ROLE_SWITCH_ATTEST_SQL,PRIMARY_ACCOUNT_SQL,'ROLLBACK',
  ]);
  assert.equal(v.releases.length,1);
  assert.equal(v.releases[0],undefined);
  await v.bridge.close();
});
test('62D-C13 unverified provider result is denied without any DB connection',async()=>{
  for(const identity of [null,{...evidence(),provider:'other'},
    {...evidence(),providerIdentityConfirmed:false},
    {...evidence(),subject:'unverified'},
    {...evidence(),issuer:'https://different12345.supabase.co/auth/v1'},
    {...evidence(),mfaConfirmed:true},
    {...evidence(),appCountyGrantConfirmed:true},
    {...evidence(),appSessionIssued:true},
    {...evidence(),releaseAuthorized:true}]){
    const v=fixture({identity});
    assert.equal(await v.bridge.getCandidate(request()),null);
    assert.deepEqual(v.calls.map(c=>c[0]),['verify']);
    await v.bridge.close();
  }
});
test('62D-C13 metadata accounts, roles and counties never become identity',async()=>{
  const v=fixture({identity:{...evidence(),role:'admin'}});
  assert.equal(await v.bridge.getCandidate(request()),null);
  assert.equal(v.calls.filter(c=>c[0]==='connect').length,0);
  await v.bridge.close();
});
test('62D-C13 nonexistent private account denies and exposes no candidate',async()=>{
  const v=fixture({dbRow:absent()});
  assert.equal(await v.bridge.getCandidate(request()),null);
  assert.equal(v.releases.length,1);
  await v.bridge.close();
});
test('62D-C13 suspended and closed accounts deny even after verified provider',async()=>{
  for(const state of ['suspended','closed']){
    const v=fixture({dbRow:account(state)});
    assert.equal(await v.bridge.getCandidate(request()),null);
    await v.bridge.close();
  }
});
test('62D-C13 zero, malformed, or overflow revisions never produce a link',async()=>{
  for(const revision of ['0','01','-1','9223372036854775808']){
    const v=fixture({dbRow:account('active',revision)});
    assert.equal(await v.bridge.getCandidate(request()),null);
    await v.bridge.close();
  }
});
test('62D-C13 database row for wrong subject fails closed',async()=>{
  const wrong=account();
  wrong.rows=[[ '22222222-2222-4222-8222-222222222222','active','3']];
  const v=fixture({dbRow:wrong});
  assert.equal(await v.bridge.getCandidate(request()),null);
  await v.bridge.close();
});
test('62D-C13 SQL proof failure denies before running account SELECT',async()=>{
  const v=fixture({attestation:proof({no_session_rights:false})});
  assert.equal(await v.bridge.getCandidate(request()),null);
  assert.equal(v.calls.some(c=>c[1]===PRIMARY_ACCOUNT_SQL),false);
  assert.equal(v.calls.at(-1)[1],'ROLLBACK');
  await v.bridge.close();
});
test('62D-C13 PG query errors do not leak SQL details or issue candidates',async()=>{
  const v=fixture({failSql:PRIMARY_ACCOUNT_SQL});
  assert.equal(await v.bridge.getCandidate(request()),null);
  assert.equal(v.calls.at(-1)[1],'ROLLBACK');
  await v.bridge.close();
});
test('62D-C13 provider rejection never checks the private account',async()=>{
  const v=fixture({onVerify:async()=>{throw new Error('PRIVATE_PROVIDER_TOKEN')}});
  assert.equal(await v.bridge.getCandidate(request()),null);
  assert.equal(v.calls.filter(c=>c[0]==='connect').length,0);
  await v.bridge.close();
});
test('62D-C13 abort after provider verification does not touch DB',async()=>{
  const abort=new AbortController();
  const v=fixture({onVerify:async()=>{abort.abort();return evidence()}});
  assert.equal(await v.bridge.getCandidate(request(abort.signal)),null);
  assert.equal(v.calls.filter(c=>c[0]==='connect').length,0);
  await v.bridge.close();
});
test('62D-C13 abort during SQL read denies candidate and returns SQL session',async()=>{
  const abort=new AbortController();
  const v=fixture({onSql:async(sql)=>{
    if(sql===AUTH_DEV_ROLE_SWITCH_ATTEST_SQL)return proof();
    if(sql===PRIMARY_ACCOUNT_SQL){abort.abort();return account();}
    return {command:'OK'};
  }});
  assert.equal(await v.bridge.getCandidate(request(abort.signal)),null);
  assert.equal(v.releases.length,1);
  await v.bridge.close();
});
test('62D-C13 close is idempotent, tears down PG pool, and disables reads',async()=>{
  const v=fixture();
  await v.bridge.close();await v.bridge.close();
  assert.equal(v.closed.length,1);
  assert.equal(await v.bridge.getCandidate(request()),null);
  assert.deepEqual(v.calls,[]);
});
test('62D-C13 closing during provider verification suppresses any later candidate',async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  const v=fixture({onVerify:async()=>{await pending;return evidence()}});
  const wait=v.bridge.getCandidate(request());
  await v.bridge.close();
  release();
  assert.equal(await wait,null);
  assert.equal(v.calls.filter(c=>c[0]==='connect').length,0);
});
test('62D-C13 bridge is deliberately unrouted, not an app-session or GIS API',()=>{
  const source=readFileSync(new URL(
    '../../../server/providers/bdp-auth-dev-verified-account-bridge.js',import.meta.url,
  ),'utf8');
  assert.match(source,/UNROUTED, SERVER-ONLY/);
  assert.match(source,/createUnroutedAuthDevRoleSwitchPg/);
  assert.match(source,/createUnroutedPrimaryAccountReader/);
  assert.match(source,/createUnroutedCurrentAccountLink/);
  assert.doesNotMatch(source,/createServer\(|fetch\(|setCookie|Set-Cookie|sb_secret_|service_role|INSERT INTO|UPDATE ldos_app_auth|ST_AsGeoJSON|grantCounty/);
});
