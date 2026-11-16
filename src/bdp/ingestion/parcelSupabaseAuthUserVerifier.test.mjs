import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createUnroutedSupabaseAuthVerifier} from
  '../../../server/providers/bdp-supabase-auth-user-verifier.js';

const PROJECT='https://abcdefghijabcdefghij.supabase.co';
const PUBLISHABLE='sb_publishable_'+'p'.repeat(24);
const USER_ID='123e4567-e89b-42d3-a456-426614174000';
const TOKEN=['a'.repeat(40),'b'.repeat(40),'c'.repeat(40)].join('.');
const payload=(extra={})=>({
  id:USER_ID,role:'authenticated',is_anonymous:false,
  email:'test-only@example.invalid',...extra,
});
const response=(body=payload(),status=200,headers={})=>
  new Response(JSON.stringify(body),{
    status,headers:{'content-type':'application/json',...headers},
  });
const input=(more={})=>({
  accessToken:TOKEN,signal:new AbortController().signal,...more,
});
const create=(fetchImpl,more={})=>createUnroutedSupabaseAuthVerifier({
  projectUrl:PROJECT,publishableKey:PUBLISHABLE,fetchImpl,...more,
});
const expected=Object.freeze({
  provider:'supabase',subject:USER_ID,
  issuer:PROJECT+'/auth/v1',
  providerIdentityConfirmed:true,
  mfaConfirmed:false,appCountyGrantConfirmed:false,
  appSessionIssued:false,releaseAuthorized:false,
});

test('53 rejects missing project, publishable key or service-role configuration',()=>{
  for(const config of [
    undefined,null,{},[],{projectUrl:PROJECT},
    {projectUrl:PROJECT,publishableKey:'sb_secret_not_allowed'},
    {projectUrl:PROJECT,publishableKey:'service_role'},
    {projectUrl:PROJECT,publishableKey:'ey.bad.jwt'},
    {projectUrl:PROJECT,publishableKey:PUBLISHABLE,serviceKey:'secret'},
    {projectUrl:PROJECT,publishableKey:PUBLISHABLE,allowAll:true},
    {projectUrl:PROJECT,publishableKey:PUBLISHABLE,fetchImpl:4},
  ])assert.throws(()=>createUnroutedSupabaseAuthVerifier(config),TypeError);
});
test('53 only exact hosted HTTPS Supabase project origins are accepted',()=>{
  for(const projectUrl of [
    'http://abcdefghijabcdefghij.supabase.co',
    'https://abcdefghijabcdefghij.supabase.co.evil.test',
    'https://localhost:3000',
    'https://127.0.0.1:8080',
    'https://abcdefghijabcdefghij.supabase.co:4432',
    'https://user:pass@abcdefghijabcdefghij.supabase.co',
    'https://abcdefghijabcdefghij.supabase.co/auth/v1/user',
    'https://abcdefghijabcdefghij.supabase.co/?token=secret',
    'https://abcdefghijabcdefghij.supabase.co/#secret',
    'https://evil.example/auth/v1/user',
  ])assert.throws(()=>createUnroutedSupabaseAuthVerifier({
    projectUrl,publishableKey:PUBLISHABLE,fetchImpl:async()=>response(),
  }),TypeError,projectUrl);
});
test('53 returns server-confirmed minimal identity after a 200 getUser',async()=>{
  const calls=[];
  const verifier=create(async(...args)=>{calls.push(args);return response()});
  const output=await verifier.verifyUserToken(input());
  assert.deepEqual(output,expected);
  assert.equal(Object.isFrozen(output),true);
  assert.deepEqual(Object.keys(verifier),['verifyUserToken']);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],PROJECT+'/auth/v1/user');
});
test('53 never marks MFA, app county grant, app session or release as verified',async()=>{
  const verifier=create(async()=>response(payload({
    user_metadata:{mfaVerified:true,countyGrants:['48453']},
    app_metadata:{role:'admin',allowExport:true},
  })));
  const result=await verifier.verifyUserToken(input());
  assert.equal(result.mfaConfirmed,false);
  assert.equal(result.appCountyGrantConfirmed,false);
  assert.equal(result.appSessionIssued,false);
  assert.equal(result.releaseAuthorized,false);
  assert.ok(!JSON.stringify(result).includes('admin'));
  assert.ok(!JSON.stringify(result).includes('48453'));
});
test('53 uses exactly one no-store, non-redirecting HTTPS Auth request',async()=>{
  let url,options;
  const verifier=create(async(u,o)=>{url=u;options=o;return response()});
  const controller=new AbortController();
  assert.deepEqual(await verifier.verifyUserToken(input({
    signal:controller.signal,
  })),expected);
  assert.equal(url,PROJECT+'/auth/v1/user');
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.cache,'no-store');
  assert.equal(options.credentials,'omit');
  assert.equal(options.headers.apikey,PUBLISHABLE);
  assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
  assert.equal(options.headers.Accept,'application/json');
  assert.equal(options.headers['Cache-Control'],'no-store');
  assert.equal(options.signal.aborted,false);
});
test('53 publishable key is pinned on creation, not mutable caller config',async()=>{
  let used;
  const cfg={projectUrl:PROJECT,publishableKey:PUBLISHABLE,
    fetchImpl:async(u,o)=>{used=o.headers.apikey;return response()}};
  const verifier=createUnroutedSupabaseAuthVerifier(cfg);
  cfg.publishableKey='sb_secret_naughty';
  assert.deepEqual(await verifier.verifyUserToken(input()),expected);
  assert.equal(used,PUBLISHABLE);
});
test('53 missing or invalid token and missing AbortSignal never issue HTTP',async()=>{
  let count=0;
  const verifier=create(async()=>{count++;return response()});
  for(const request of [
    null,{},[],input({accessToken:''}),input({accessToken:'a.b.c'}),
    input({accessToken:'a'.repeat(9000)}),
    input({accessToken:'sb_publishable_xxx'}),
    input({accessToken:'a.b.c\nAuthorization: Bearer bad'}),
    input({accessToken:TOKEN+'?admin=true'}),
    input({signal:null}),input({signal:'x'}),
    input({browserRole:'owner'}),
  ])assert.equal(await verifier.verifyUserToken(request),null);
  assert.equal(count,0);
});
test('53 already-aborted request cannot send a token',async()=>{
  let called=0;
  const controller=new AbortController();
  controller.abort();
  const verifier=create(async()=>{called++;return response()});
  assert.equal(await verifier.verifyUserToken(input({
    signal:controller.signal,
  })),null);
  assert.equal(called,0);
});
test('53 abort during pending fetch discards returned identity',async()=>{
  const controller=new AbortController();
  const verifier=create(async()=>{
    controller.abort();
    return response();
  });
  assert.equal(await verifier.verifyUserToken(input({
    signal:controller.signal,
  })),null);
});
test('53 failed authentication statuses never become user identity',async()=>{
  for(const status of [201,204,301,302,400,401,403,404,429,500,503]){
    const verifier=create(async()=>new Response(
      status===204?null:JSON.stringify(payload()),
      {status,headers:{'content-type':'application/json'}},
    ));
    assert.equal(await verifier.verifyUserToken(input()),null,String(status));
  }
});
test('53 anonymous, untrusted role, or invalid user id fails closed',async()=>{
  for(const data of [
    payload({is_anonymous:true}),payload({is_anonymous:null}),
    payload({role:'service_role'}),payload({role:'anon'}),
    payload({role:null}),payload({id:'not-uuid'}),
    payload({id:'123E4567-E89B-42D3-A456-426614174000'}),
    payload({id:undefined}),
    {user:payload()},
    null,
  ]){
    const verifier=create(async()=>response(data));
    assert.equal(await verifier.verifyUserToken(input()),null);
  }
});
test('53 denied response, content type mismatch and no body fail closed',async()=>{
  for(const r of [
    new Response('not json',{status:200,headers:{'content-type':'text/plain'}}),
    new Response(null,{status:200,headers:{'content-type':'application/json'}}),
    new Response('<xml>user</xml>',{status:200,headers:{'content-type':'application/json'}}),
    response(payload(),200,{'content-length':'999999999'}),
    response(payload(),200,{'content-length':'NaN'}),
  ])assert.equal(await create(async()=>r).verifyUserToken(input()),null);
});
test('53 unexpected or oversized JSON body fails closed without truncation',async()=>{
  for(const body of [
    'x'.repeat(17000),
    JSON.stringify({...payload(),garbage:'x'.repeat(17000)}),
  ]){
    const verifier=create(async()=>new Response(body,{
      status:200,headers:{'content-type':'application/json'},
    }));
    assert.equal(await verifier.verifyUserToken(input()),null);
  }
});
test('53 malformed UTF8 response fails closed',async()=>{
  const bad=new Uint8Array([0xff,0xfe,0xfd]);
  const verifier=create(async()=>new Response(bad,{
    status:200,headers:{'content-type':'application/json'},
  }));
  assert.equal(await verifier.verifyUserToken(input()),null);
});
test('53 fetch outage and thrown errors never disclose provider details',async()=>{
  const verifier=create(async()=>{throw Error('SECRET_PROVIDER_DEBUG_TOKEN')});
  assert.equal(await verifier.verifyUserToken(input()),null);
});
test('53 query URL never contains the user token, county or browser role',async()=>{
  let target;
  const verifier=create(async(u)=>{target=u;return response()});
  await verifier.verifyUserToken(input());
  assert.equal(target,PROJECT+'/auth/v1/user');
  assert.ok(!target.includes(TOKEN));
  assert.ok(!target.includes('county'));
  assert.ok(!target.includes('?'));
});
test('53 server identity evidence does not copy user email or metadata',async()=>{
  const verifier=create(async()=>response(payload({
    email:'PRIVATE_TEST_EMAIL@example.invalid',
    phone:'999-9999',
    app_metadata:{countyFips:'48453',role:'admin'},
  })));
  const result=await verifier.verifyUserToken(input());
  const encoded=JSON.stringify(result);
  for(const text of [
    TOKEN,PUBLISHABLE,'PRIVATE_TEST_EMAIL','999-9999',
    'countyFips','role','admin',
  ])assert.ok(!encoded.includes(text),text);
});
test('53 response body is always read as a bounded stream',()=>{
  const src=readFileSync(new URL(
    '../../../server/providers/bdp-supabase-auth-user-verifier.js',
    import.meta.url),'utf8');
  assert.match(src,/MAX_RESPONSE_BYTES = 16384/);
  assert.match(src,/response\.body\.getReader\(\)/);
  assert.match(src,/bytes > MAX_RESPONSE_BYTES/);
  assert.match(src,/TextDecoder\('utf-8',\{fatal:true\}\)/);
  assert.match(src,/AbortSignal\.timeout\(TIMEOUT_MS\)/);
});
test('53 module has no HTTP routes, cookies, DB pools, JWT claim trust or geometry',()=>{
  const src=readFileSync(new URL(
    '../../../server/providers/bdp-supabase-auth-user-verifier.js',
    import.meta.url),'utf8');
  assert.match(src,/UNROUTED/);
  assert.match(src,/releaseAuthorized:false/);
  assert.match(src,/mfaConfirmed:false/);
  assert.match(src,/appCountyGrantConfirmed:false/);
  assert.doesNotMatch(src,/new Pool\(|createServer\(|\.listen\(|app\.get\(/);
  assert.doesNotMatch(src,/JWT\.parse|jwtDecode|JSON\.parse\(atob\(|issueToken|signJwt/);
  assert.doesNotMatch(src,/service_role|sb_secret_/);
});
