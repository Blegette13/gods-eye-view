import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {
  ROUNDTRIP_PASS,requireDevUserRoundtripOptIn,
  parsePipedDevTestCredentials,readPipedDevTestCredentials,
  checkRealDevSupabaseUserRoundtrip,runDevUserRoundtripCLI,
} from '../../../scripts/bdp/supabase-dev-user-identity-roundtrip.mjs';

const PROJECT='https://abcdefghijabcdefghij.supabase.co';
const KEY='sb_publishable_'+'p'.repeat(24);
const JWT=['a'.repeat(48),'b'.repeat(48),'c'.repeat(48)].join('.');
const USER_ID='123e4567-e89b-42d3-a456-426614174000';
const config={projectUrl:PROJECT,publishableKey:KEY};
const creds={email:'only-test@example.invalid',password:'OnlyTestPassword!123'};
const env={LDOS_SUPABASE_DEV_URL:PROJECT,LDOS_SUPABASE_DEV_PUBLISHABLE_KEY:KEY};
const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json'},
});
const legit=()=>json({id:USER_ID,role:'authenticated',is_anonymous:false,
  email:'SECRET_TEST@example.invalid',app_metadata:{role:'admin'}});
const signIn=()=>json({access_token:JWT,token_type:'bearer',
  refresh_token:'SECRET_REFRESH_TOKEN',user:{email:creds.email}});
function mockTransport({loginResponse=signIn(),userResponse=legit(),denyStatus,
  onRequest=()=>{}}={}) {
  return async (url,opts)=>{
    onRequest(url,opts);
    if(url.startsWith('http://127.0.0.1:')){
      if(denyStatus!==undefined && opts.headers.Authorization==='Bearer invalid.test.jwt')
        return json({providerIdentityConfirmed:true},denyStatus);
      return globalThis.fetch(url,opts);
    }
    if(url===PROJECT+'/auth/v1/token?grant_type=password') return loginResponse;
    if(url===PROJECT+'/auth/v1/user')return userResponse;
    throw Error('Unexpected external endpoint');
  };
}

test('61 requires exact --dev-only and piped-credentials opt-in',()=>{
  assert.equal(requireDevUserRoundtripOptIn(['--dev-only','--stdin-credentials']),true);
  for(const args of [[],null,undefined,['--dev-only'],['--stdin-credentials'],
    ['--dev-only','--stdin-credentials','--prod'],['--production','--stdin-credentials']])
    assert.throws(()=>requireDevUserRoundtripOptIn(args),/Refusing user probe/);
});
test('61 accepts a minimal development test user JSON credential object',()=>{
  const parsed=parsePipedDevTestCredentials(JSON.stringify(creds));
  assert.deepEqual(parsed,creds);
  assert.equal(Object.isFrozen(parsed),true);
});
test('61 rejects arbitrary extra credential properties, arrays and invalid emails',()=>{
  for(const sample of [
    '',null,{},[],{...creds,admin:true}, {password:creds.password},
    {email:'bad-address',password:creds.password},
    {email:'bad with spaces@test.org',password:creds.password},
    {email:creds.email,password:''},
    {email:creds.email,password:'1234567'},
    {email:creds.email,password:'line\nsecret'},
  ])assert.equal(parsePipedDevTestCredentials(
    typeof sample==='string'?sample:JSON.stringify(sample)),null);
});
test('61 rejects malformed or oversized incoming JSON before use',()=>{
  assert.equal(parsePipedDevTestCredentials('not json'),null);
  assert.equal(parsePipedDevTestCredentials('{"email":"oops"'),null);
  assert.equal(parsePipedDevTestCredentials(' '.repeat(4097)),null);
});
test('61 reads credentials only from a piped stream, not an interactive TTY',async()=>{
  assert.equal(await readPipedDevTestCredentials({isTTY:true}),null);
  assert.equal(await readPipedDevTestCredentials(null),null);
  const cred=await readPipedDevTestCredentials(Readable.from([
    Buffer.from(JSON.stringify(creds)),
  ]));
  assert.deepEqual(cred,creds);
});
test('61 rejects oversized piped streams and malformed UTF-8',async()=>{
  assert.equal(await readPipedDevTestCredentials(Readable.from([
    Buffer.from(' '.repeat(5000)),
  ])),null);
  assert.equal(await readPipedDevTestCredentials(Readable.from([
    Buffer.from([0xff,0xfe,0xfd]),
  ])),null);
});
test('61 real localhost socket and mocked Supabase login validate true identity only',async()=>{
  const calls=[];
  const ok=await checkRealDevSupabaseUserRoundtrip({config,credentials:creds,
    fetchImpl:mockTransport({onRequest:(url,opts)=>calls.push([url,opts])})});
  assert.equal(ok,true);
  assert.equal(calls.filter(([url])=>url===PROJECT+'/auth/v1/token?grant_type=password').length,1);
  assert.equal(calls.filter(([url])=>url===PROJECT+'/auth/v1/user').length,1);
  assert.equal(calls.filter(([url])=>url.startsWith('http://127.0.0.1:')).length,2);
});
test('61 no user token or password ever enters an HTTP query string',async()=>{
  const calls=[];
  assert.equal(await checkRealDevSupabaseUserRoundtrip({config,credentials:creds,
    fetchImpl:mockTransport({onRequest:(url,opts)=>calls.push([url,opts])})}),true);
  for(const [url] of calls){
    for(const value of [JWT,creds.email,creds.password,KEY])assert.ok(!url.includes(value));
  }
});
test('61 remote password exchange uses publishable API key, HTTPS, POST and no redirects',async()=>{
  const calls=[];
  assert.equal(await checkRealDevSupabaseUserRoundtrip({config,credentials:creds,
    fetchImpl:mockTransport({onRequest:(url,opts)=>calls.push([url,opts])})}),true);
  const tokenCall=calls.find(([url])=>url.includes('/auth/v1/token?grant_type=password'));
  assert.equal(tokenCall[0],PROJECT+'/auth/v1/token?grant_type=password');
  assert.equal(tokenCall[1].method,'POST');
  assert.equal(tokenCall[1].headers.apikey,KEY);
  assert.equal(tokenCall[1].headers['Content-Type'],'application/json');
  assert.equal(tokenCall[1].redirect,'error');
  assert.equal(tokenCall[1].credentials,'omit');
  assert.deepEqual(JSON.parse(tokenCall[1].body),creds);
  assert.equal(tokenCall[1].headers.Authorization,undefined);
});
test('61 a malformed sign-in response or missing bearer token fails closed',async()=>{
  for(const data of [
    {},{access_token:'bad-token',token_type:'bearer'},
    {access_token:JWT,token_type:'bad'},
    {access_token:'a'.repeat(9000),token_type:'bearer'},
  ])assert.equal(await checkRealDevSupabaseUserRoundtrip({config,credentials:creds,
    fetchImpl:mockTransport({loginResponse:json(data)})}),false);
});
test('61 invalid credentials never result in local identity verification',async()=>{
  let authRequests=0;
  const fetchImpl=mockTransport({loginResponse:json({error:'invalid_grant'},400),
    onRequest:(url)=>{if(url===PROJECT+'/auth/v1/user')authRequests++}});
  assert.equal(await checkRealDevSupabaseUserRoundtrip({config,credentials:creds,fetchImpl}),false);
  assert.equal(authRequests,0);
});
test('61 Supabase /user rejects an anonymous or revoked user even after password grant',async()=>{
  for(const data of [
    {id:USER_ID,role:'authenticated',is_anonymous:true},
    {id:USER_ID,role:'anon',is_anonymous:false},
  ])assert.equal(await checkRealDevSupabaseUserRoundtrip({config,credentials:creds,
    fetchImpl:mockTransport({userResponse:json(data)})}),false);
});
test('61 upstream Auth outage fails closed without exposing provider internals',async()=>{
  const fetchImpl=async(url,opts)=>{
    if(url.startsWith('http://127.0.0.1:'))return globalThis.fetch(url,opts);
    throw Error('PRIVATE_PASSWORD_SHOULD_NOT_LEAK');
  };
  assert.equal(await checkRealDevSupabaseUserRoundtrip({config,credentials:creds,fetchImpl}),false);
});
test('61 local invalid-token control must reject before sending any real password',async()=>{
  let signin=0;
  const fetchImpl=mockTransport({denyStatus:200,onRequest:url=>{
    if(url.includes('grant_type=password'))signin++;
  }});
  assert.equal(await checkRealDevSupabaseUserRoundtrip({config,credentials:creds,fetchImpl}),false);
  assert.equal(signin,0);
});
test('61 missing project config or secret/service-role key makes no HTTP requests',async()=>{
  let called=0;
  const fetchImpl=async()=>{called++;throw Error('not allowed')};
  for(const c of [null,{}, {...config,publishableKey:'sb_secret_AAAAAAAA'},
    {...config,projectUrl:'https://evil.example'}])
    assert.equal(await checkRealDevSupabaseUserRoundtrip({config:c,credentials:creds,fetchImpl}),false);
  assert.equal(called,0);
});
test('61 development loopback verdict requires all authorization dimensions explicitly false',async()=>{
  const fetchImpl=async(url,opts)=>{
    if(url.startsWith('http://127.0.0.1:')){
      if(opts.headers.Authorization==='Bearer invalid.test.jwt')return globalThis.fetch(url,opts);
      return json({providerIdentityConfirmed:true,mfaConfirmed:true,
        appAccountAuthorized:false,appCountyGrantConfirmed:false,
        appSessionIssued:false,releaseAuthorized:false});
    }
    return mockTransport()(url,opts);
  };
  assert.equal(await checkRealDevSupabaseUserRoundtrip({config,credentials:creds,fetchImpl}),false);
});
test('61 real user proof never accepts unknown extra authorization fields in verdict',async()=>{
  const fetchImpl=async(url,opts)=>{
    if(url.startsWith('http://127.0.0.1:')){
      if(opts.headers.Authorization==='Bearer invalid.test.jwt')return globalThis.fetch(url,opts);
      return json({providerIdentityConfirmed:true,mfaConfirmed:false,
        appAccountAuthorized:false,appCountyGrantConfirmed:false,
        appSessionIssued:false,releaseAuthorized:false,allowExport:true});
    }
    return mockTransport()(url,opts);
  };
  assert.equal(await checkRealDevSupabaseUserRoundtrip({config,credentials:creds,fetchImpl}),false);
});
test('61 CLI rejects interactive TTY, bad flags and absent environment without network',async()=>{
  await assert.rejects(runDevUserRoundtripCLI({args:['--dev-only'],env,stream:Readable.from([])}),
    /Refusing user probe/);
  await assert.rejects(runDevUserRoundtripCLI({args:['--dev-only','--stdin-credentials'],
    env,stream:{isTTY:true}}),/over stdin/);
  await assert.rejects(runDevUserRoundtripCLI({args:['--dev-only','--stdin-credentials'],
    env:{},stream:Readable.from([])}),/environment not configured/);
});
test('61 CLI runs a piped development test user proof and returns a fixed safe PASS',async()=>{
  const out=await runDevUserRoundtripCLI({
    args:['--dev-only','--stdin-credentials'],env,
    stream:Readable.from([Buffer.from(JSON.stringify(creds))]),
    fetchImpl:mockTransport(),
  });
  assert.equal(out,ROUNDTRIP_PASS);
  for(const sensitive of [JWT,KEY,creds.email,creds.password,'SECRET_REFRESH_TOKEN',USER_ID])
    assert.ok(!out.includes(sensitive));
});
test('61 source never stores session, creates GIS routes or prints credentials',()=>{
  const src=readFileSync(new URL('../../../scripts/bdp/supabase-dev-user-identity-roundtrip.mjs',
    import.meta.url),'utf8');
  assert.match(src,/--dev-only/);
  assert.match(src,/--stdin-credentials/);
  assert.match(src,/\/auth\/v1\/token\?grant_type=password/);
  assert.match(src,/\/dev\/identity\/check/);
  assert.match(src,/startServer\(\{port:0/);
  assert.doesNotMatch(src,/new Pool\(|ST_AsGeoJSON|CREATE ROLE|auth\.signUp/);
  assert.doesNotMatch(src,/console\.log\(password|process\.stdout\.write\(credentials|createWriteStream/);
});
