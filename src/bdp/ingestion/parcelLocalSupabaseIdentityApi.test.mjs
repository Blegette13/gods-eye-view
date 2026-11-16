import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {readFileSync} from 'node:fs';
import {createUnroutedSupabaseAuthVerifier} from
  '../../../server/providers/bdp-supabase-auth-user-verifier.js';
import {
  requireLocalIdentityDevOptIn,
  createLocalIdentityHandler,
  startLocalIdentityDevApi,
} from '../../../server/standalone/land-os-identity-verification-dev.mjs';

const URL='https://abcdefghijabcdefghij.supabase.co';
const KEY='sb_publishable_'+ 'p'.repeat(24);
const TOKEN=['a'.repeat(50),'b'.repeat(50),'c'.repeat(50)].join('.');
const USER_ID='123e4567-e89b-42d3-a456-426614174000';
const healthy=()=>new Response(JSON.stringify({
  id:USER_ID,role:'authenticated',is_anonymous:false,
  email:'PRIVATE_EMAIL@example.invalid',
  app_metadata:{role:'admin',countyGrants:['48453']},
}),{status:200,headers:{'Content-Type':'application/json'}});
const verifier=(fetchImpl)=>createUnroutedSupabaseAuthVerifier({
  projectUrl:URL,publishableKey:KEY,fetchImpl,
});
async function start(t,fetchImpl=async()=>healthy()) {
  const server=await startLocalIdentityDevApi({
    port:0,verifier:verifier(fetchImpl),
  });
  t.after(async()=>{if(server.listening)await new Promise(ok=>server.close(ok))});
  assert.equal(server.address().address,'127.0.0.1');
  return server.address().port;
}
function send(port,{method='GET',path='/dev/identity/check',headers={}}={}) {
  return new Promise((done,fail)=>{
    const req=httpRequest({
      hostname:'127.0.0.1',port,method,path,timeout:2500,
      headers:{Host:'127.0.0.1:'+port,...headers},
    },res=>{
      const list=[];
      res.on('data',chunk=>list.push(chunk));
      res.on('end',()=>done({
        status:res.statusCode,headers:res.headers,
        body:Buffer.concat(list).toString('utf8'),
      }));
    });
    req.once('error',fail);
    req.once('timeout',()=>req.destroy(new Error('Local test request timed out')));
    req.end();
  });
}
const bearer={Authorization:'Bearer '+TOKEN};
const denial=Object.freeze({
  providerIdentityConfirmed:false,mfaConfirmed:false,
  appAccountAuthorized:false,appCountyGrantConfirmed:false,
  appSessionIssued:false,releaseAuthorized:false,
});
const verified=Object.freeze({...denial,providerIdentityConfirmed:true});

test('60 local identity API is an explicit --dev-only opt-in',()=>{
  assert.equal(requireLocalIdentityDevOptIn(['--dev-only']),true);
  for(const x of [null,undefined,[],['--prod'],['--dev-only','--expose'],['--dev-only','--dev-only']])
    assert.throws(()=>requireLocalIdentityDevOptIn(x),/exactly --dev-only/);
});
test('60 an actual local Node listener is restricted to IPv4 loopback',async t=>{
  const port=await start(t);
  assert.ok(port>0);
  const response=await send(port,{headers:bearer});
  assert.equal(response.status,200);
});
test('60 a fresh Supabase /user response confirms only identity and no rights',async t=>{
  const calls=[];
  const port=await start(t,async(url,options)=>{
    calls.push([url,options]);return healthy();
  });
  const result=await send(port,{headers:bearer});
  assert.equal(result.status,200);
  assert.deepEqual(JSON.parse(result.body),verified);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],URL+'/auth/v1/user');
  assert.equal(calls[0][1].method,'GET');
  assert.equal(calls[0][1].headers.Authorization,'Bearer '+TOKEN);
  assert.equal(calls[0][1].headers.apikey,KEY);
  assert.equal(calls[0][1].redirect,'error');
  assert.equal(calls[0][1].cache,'no-store');
});
test('60 user UUID, email, metadata, publishable key and bearer token are never returned',async t=>{
  const port=await start(t);
  const result=await send(port,{headers:bearer});
  assert.equal(result.status,200);
  for(const secret of [USER_ID,'PRIVATE_EMAIL','48453','admin',KEY,TOKEN])
    assert.ok(!result.body.includes(secret),secret);
  assert.equal(result.headers['set-cookie'],undefined);
  assert.equal(result.headers['access-control-allow-origin'],undefined);
  assert.equal(result.headers['cache-control'],'no-store');
  assert.equal(result.headers['pragma'],'no-cache');
});
test('60 no bearer token means deny and never contact Supabase',async t=>{
  let called=0;
  const port=await start(t,async()=>{called++;return healthy()});
  const result=await send(port);
  assert.equal(result.status,401);
  assert.deepEqual(JSON.parse(result.body),denial);
  assert.equal(called,0);
});
test('60 malformed bearer token is rejected before contacting Supabase',async t=>{
  let calls=0;
  const port=await start(t,async()=>{calls++;return healthy()});
  for(const auth of [
    'Basic abc','Bearer ', 'Bearer short.jwt.x',
    'Bearer '+KEY,'Bearer '+'a'.repeat(8200),
    'bearer '+TOKEN,'Bearer '+TOKEN+' extra',
  ]){
    const r=await send(port,{headers:{Authorization:auth}});
    assert.equal(r.status,401);
    assert.deepEqual(JSON.parse(r.body),denial);
  }
  assert.equal(calls,0);
});
test('60 a 401 response from Supabase never authenticates a user',async t=>{
  const port=await start(t,async()=>new Response('{}',{
    status:401,headers:{'Content-Type':'application/json'},
  }));
  const r=await send(port,{headers:bearer});
  assert.equal(r.status,401);
  assert.deepEqual(JSON.parse(r.body),denial);
});
test('60 an Auth server error, timeout or invalid JSON fails closed',async t=>{
  const port=await start(t,async()=>{throw Error('SECRET_UPSTREAM_STACK')});
  const r=await send(port,{headers:bearer});
  assert.equal(r.status,401);
  assert.deepEqual(JSON.parse(r.body),denial);
  assert.ok(!r.body.includes('SECRET_UPSTREAM_STACK'));
});
test('60 an anonymous Supabase user is denied even with authenticated role',async t=>{
  const port=await start(t,async()=>new Response(JSON.stringify({
    id:USER_ID,role:'authenticated',is_anonymous:true,
  }),{status:200,headers:{'Content-Type':'application/json'}}));
  const r=await send(port,{headers:bearer});
  assert.equal(r.status,401);
  assert.deepEqual(JSON.parse(r.body),denial);
});
test('60 unknown paths, login, account, counties, parcels and export never exist',async t=>{
  const port=await start(t);
  for(const path of [
    '/','/health','/auth','/login','/logout','/dev/identity',
    '/dev/identity/check?admin=true','/api/counties',
    '/api/parcels','/api/geometry','/api/export',
    '//dev/identity/check','/%64ev/identity/check',
  ]){
    const r=await send(port,{path,headers:bearer});
    assert.equal(r.status,404,path);
    assert.equal(r.body,'');
  }
});
test('60 non-GET methods cannot invoke the provider, including POST',async t=>{
  let calls=0;
  const port=await start(t,async()=>{calls++;return healthy()});
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','HEAD']){
    const r=await send(port,{method,headers:bearer});
    assert.equal(r.status,404,method);
    assert.equal(r.body,'');
  }
  assert.equal(calls,0);
});
test('60 browser Origin, cookies and any content length reject before a fetch',async t=>{
  let calls=0;
  const port=await start(t,async()=>{calls++;return healthy()});
  for(const header of [
    {Origin:'http://localhost:5173'},
    {Origin:'null'},
    {Cookie:'sid=private'},
    {'Content-Length':'0'},
    {'Transfer-Encoding':'chunked'},
  ]){
    const r=await send(port,{headers:{...bearer,...header}});
    assert.equal(r.status,404);
    assert.equal(r.body,'');
  }
  assert.equal(calls,0);
});
test('60 forged Host is rejected with no provider calls',async t=>{
  let calls=0;
  const port=await start(t,async()=>{calls++;return healthy()});
  for(const host of [
    'localhost:'+port,'evil.test','127.0.0.1',
    '0.0.0.0:'+port,'127.0.0.1:8788.evil.test',
  ]){
    const r=await send(port,{headers:{...bearer,Host:host}});
    assert.equal(r.status,404,host);
  }
  assert.equal(calls,0);
});
test('60 repeated Authorization headers are denied before a remote request',async t=>{
  let calls=0;
  const port=await start(t,async()=>{calls++;return healthy()});
  const res=await new Promise((done,fail)=>{
    const req=httpRequest({
      hostname:'127.0.0.1',port,path:'/dev/identity/check',
      headers:{Host:'127.0.0.1:'+port,
        Authorization:['Bearer '+TOKEN,'Bearer '+TOKEN]},
    },r=>{
      r.resume();r.on('end',()=>done(r.statusCode));
    });
    req.on('error',fail);req.end();
  });
  assert.equal(res,401);
  assert.equal(calls,0);
});
test('60 HTTP response hardening never enables CORS or authentication cookies',async t=>{
  const port=await start(t);
  const r=await send(port,{headers:bearer});
  assert.equal(r.headers['x-content-type-options'],'nosniff');
  assert.equal(r.headers['referrer-policy'],'no-referrer');
  assert.equal(r.headers['x-frame-options'],'DENY');
  assert.equal(r.headers['content-security-policy'],"default-src 'none'");
  assert.equal(r.headers['access-control-allow-origin'],undefined);
  assert.equal(r.headers['set-cookie'],undefined);
});
test('60 factory rejects missing verifier and invalid listen ports before binding',async()=>{
  for(const p of [-1,65536,NaN,'8788',null,1.7])
    await assert.rejects(startLocalIdentityDevApi({
      port:p,verifier:verifier(async()=>healthy()),
    }),TypeError);
  for(const p of [undefined,null,{},'fake'])
    assert.throws(()=>createLocalIdentityHandler(()=>8788,p),TypeError);
});
test('60 no private database or GIS service is imported or deployed',()=>{
  const source=readFileSync(new URL(
    '../../../server/standalone/land-os-identity-verification-dev.mjs',
    import.meta.url,
  ),'utf8');
  assert.match(source,/LOCAL-ONLY HTTP binding/);
  assert.match(source,/createUnroutedSupabaseAuthVerifier/);
  assert.match(source,/server.listen\(port,HOST/);
  assert.match(source,/releaseAuthorized:false/);
  assert.doesNotMatch(source,/new Pool\(|ST_AsGeoJSON|postgis|geometryRpc|auth\.signIn/i);
  assert.doesNotMatch(source,/setHeader\(['"](?:Set-Cookie|Access-Control-Allow-Origin)['"]|listen\(port,'0\.0\.0\.0'/);
});
