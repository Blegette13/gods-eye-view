import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  validateDevSupabaseHealthConfig,
  checkDevSupabaseAuthHealth,
  runDevSupabaseAuthHealthSmoke,
} from '../../../scripts/bdp/supabase-dev-auth-health-smoke.mjs';

const PROJECT='https://abcdefghijabcdefghij.supabase.co';
const KEY='sb_publishable_'+'p'.repeat(24);
const valid=()=>({projectUrl:PROJECT,publishableKey:KEY});
const response=(data={name:'GoTrue',version:'v2.0.0'},status=200,headers={})=>
  new Response(JSON.stringify(data),{
    status,headers:{'content-type':'application/json',...headers},
  });
const mock=async()=>response();
const env={
  LDOS_SUPABASE_DEV_URL:PROJECT,
  LDOS_SUPABASE_DEV_PUBLISHABLE_KEY:KEY,
};

test('55 accepts exactly HTTPS hosted origin with publishable key',()=>{
  const out=validateDevSupabaseHealthConfig(valid());
  assert.deepEqual(out,{origin:PROJECT,publishableKey:KEY});
  assert.equal(Object.isFrozen(out),true);
});

test('55 denies non-HTTPS, wrong host, credentials, arbitrary endpoints and query strings',()=>{
  for(const projectUrl of [
    'http://abcdefghijabcdefghij.supabase.co',
    'https://abcdefghijabcdefghij.supabase.co.evil.test',
    'https://evil.example',
    'https://127.0.0.1:54321',
    'https://localhost',
    'https://user:password@abcdefghijabcdefghij.supabase.co',
    'https://abcdefghijabcdefghij.supabase.co/auth/v1/admin',
    'https://abcdefghijabcdefghij.supabase.co?token=x',
    'https://abcdefghijabcdefghij.supabase.co/#x',
    'ftp://abcdefghijabcdefghij.supabase.co',
  ])assert.equal(validateDevSupabaseHealthConfig({
    projectUrl,publishableKey:KEY,
  }),null);
});

test('55 denies secret, service-role, legacy JWT and malformed publishable keys',()=>{
  for(const publishableKey of [
    '',null,123,'service_role','sb_secret_123456789abcdef',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb28ifQ.sig',
    'sb_publishable_short','sb_publishable_abc!@#',
  ])assert.equal(validateDevSupabaseHealthConfig({
    projectUrl:PROJECT,publishableKey,
  }),null);
});

test('55 rejects absent, non-plain, extra, accessor or symbol-bearing settings',()=>{
  const getter={projectUrl:PROJECT};
  Object.defineProperty(getter,'publishableKey',{
    get(){throw Error('UNTRUSTED_KEY_GETTER')},enumerable:true,
  });
  const withSymbol={...valid(),[Symbol('secret')]:'x'};
  for(const config of [
    null,undefined,{},[],{projectUrl:PROJECT},
    {...valid(),secret:'no'},getter,withSymbol,
  ])assert.equal(validateDevSupabaseHealthConfig(config),null);
});

test('55 performs only bounded no-store GET /auth/v1/health using apikey',async()=>{
  const calls=[];
  const ok=await checkDevSupabaseAuthHealth(valid(),{
    fetchImpl:async(...args)=>{calls.push(args);return response()},
  });
  assert.equal(ok,true);
  assert.equal(calls.length,1);
  const [url,options]=calls[0];
  assert.equal(url,PROJECT+'/auth/v1/health');
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.cache,'no-store');
  assert.equal(options.credentials,'omit');
  assert.equal(options.headers.apikey,KEY);
  assert.equal(options.headers.Accept,'application/json');
  assert.equal(options.headers['Cache-Control'],'no-store');
  assert.equal(Object.hasOwn(options.headers,'Authorization'),false);
  assert.equal(Object.isFrozen(options.headers),true);
  assert.equal(options.signal.aborted,false);
});

test('55 invalid options cannot trigger a remote request',async()=>{
  let hits=0;
  const fetchImpl=async()=>{hits++;return response()};
  for(const options of [
    {fetchImpl,session:'user'}, {fetchImpl,accessToken:'secret'},
    {fetchImpl,signal:'not-signal'}, {fetchImpl:null},
    {fetchImpl,signal:null}, null, [],
  ])assert.equal(await checkDevSupabaseAuthHealth(valid(),options),false);
  assert.equal(hits,0);
});

test('55 status failures never falsely confirm the Auth service',async()=>{
  for(const status of [201,202,204,301,302,400,401,403,404,429,500,503]){
    const body=status===204?null:JSON.stringify({name:'GoTrue',version:'v2.0.0'});
    const fetchImpl=async()=>new Response(body,{
      status,headers:{'content-type':'application/json'},
    });
    assert.equal(await checkDevSupabaseAuthHealth(valid(),{fetchImpl}),false,
      String(status));
  }
});

test('55 invalid JSON, absent body, wrong content type, bad version and oversized length deny',async()=>{
  const responses=[
    new Response(null,{status:200,headers:{'content-type':'application/json'}}),
    new Response('not-json',{status:200,headers:{'content-type':'application/json'}}),
    new Response('<xml/>',{status:200,headers:{'content-type':'text/xml'}}),
    response({name:'another service',version:'v1'}),
    response({name:'GoTrue',version:''}),
    response({name:'GoTrue'}),
    response(undefined,200,{'content-length':'9999999'}),
    response(undefined,200,{'content-length':'not-number'}),
    new Response('x'.repeat(3000),{
      status:200,headers:{'content-type':'application/json'},
    }),
  ];
  for(const r of responses)
    assert.equal(await checkDevSupabaseAuthHealth(valid(),{
      fetchImpl:async()=>r,
    }),false);
});

test('55 malformed UTF8 cannot pass as a valid service',async()=>{
  const fetchImpl=async()=>new Response(new Uint8Array([255,254,253]),{
    status:200,headers:{'content-type':'application/json'},
  });
  assert.equal(await checkDevSupabaseAuthHealth(valid(),{fetchImpl}),false);
});

test('55 network outage and abort before request fail closed',async()=>{
  const fetchImpl=async()=>{throw Error('URL_AND_CREDENTIALS_SHOULD_NOT_LEAK')};
  assert.equal(await checkDevSupabaseAuthHealth(valid(),{fetchImpl}),false);
  let hits=0;
  const controller=new AbortController();
  controller.abort();
  assert.equal(await checkDevSupabaseAuthHealth(valid(),{
    signal:controller.signal,
    fetchImpl:async()=>{hits++;return response()},
  }),false);
  assert.equal(hits,0);
});

test('55 abort during request prevents accepting a healthy result',async()=>{
  const controller=new AbortController();
  const fetchImpl=async()=>{controller.abort();return response()};
  assert.equal(await checkDevSupabaseAuthHealth(valid(),{
    signal:controller.signal,fetchImpl,
  }),false);
});

test('55 exact --dev-only flag mandatory and missing environment fails',async()=>{
  for(const args of [[],['--production'],['--dev-only','--extra'],null])
    await assert.rejects(runDevSupabaseAuthHealthSmoke(args,env,{
      fetchImpl:mock,
    }),/exactly --dev-only/);
  await assert.rejects(runDevSupabaseAuthHealthSmoke(
    ['--dev-only'],{}, {fetchImpl:mock},
  ),/configuration invalid/);
});

test('55 opt-in dev-only PASS never implies user auth, MFA or county rights',async()=>{
  const result=await runDevSupabaseAuthHealthSmoke(
    ['--dev-only'],env,{fetchImpl:mock},
  );
  assert.match(result,/^PASS: development Supabase Auth health endpoint reachable/);
  assert.match(result,/no user or land permissions tested/);
  assert.doesNotMatch(result, new RegExp(KEY));
  assert.doesNotMatch(result, /authenticated user|MFA verified|GIS rights approved/);
});

test('55 script contains no login, browser router, geometry, database or token exchange',()=>{
  const src=readFileSync(new URL(
    '../../../scripts/bdp/supabase-dev-auth-health-smoke.mjs',
    import.meta.url,
  ),'utf8');
  assert.match(src,/DEV-ONLY authenticated gateway reachability check/);
  assert.match(src,/NO HTTP server mounted/);
  assert.match(src,/LDOS_SUPABASE_DEV_URL/);
  assert.match(src,/LDOS_SUPABASE_DEV_PUBLISHABLE_KEY/);
  assert.match(src,/MAX_BYTES = 2048/);
  assert.doesNotMatch(src,/new Pool\(|createServer\(|\.listen\(|app\.get\(/);
  assert.doesNotMatch(src,/password=|service_role|sb_secret_|Bearer |signInWithPassword|auth\.signUp/);
  assert.doesNotMatch(src,/ST_AsGeoJSON|grantGeometry|countyGrantApproved/);
});
