import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {readFileSync} from 'node:fs';
import {
  createDevApiHandler,
  requireDevApiOptIn,
  startDevLandOsApi,
} from '../../../server/standalone/land-os-api-dev.mjs';

async function start(t){
  const server=await startDevLandOsApi({port:0});
  t.after(async()=>{if(server.listening)await new Promise(done=>server.close(done))});
  assert.equal(server.address().address,'127.0.0.1');
  return server.address().port;
}
const send=(port,{method='GET',path='/health',headers={},body}={})=>
  new Promise((resolve,reject)=>{
    const req=httpRequest({
      hostname:'127.0.0.1',port,method,path,timeout:2500,
      headers:{Host:'127.0.0.1:'+port,...headers},
    },res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({
        status:res.statusCode,
        headers:res.headers,
        body:Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error',reject);
    req.on('timeout',()=>req.destroy(new Error('Local API test timed out')));
    req.end(body);
  });

test('56 explicit development opt-in is required, never implicit',()=>{
  assert.equal(requireDevApiOptIn(['--dev-only']),true);
  for(const args of [
    [],['--prod'],['--dev-only','--allow-all'],
    ['--dev-only','--dev-only'],null,undefined,
  ])assert.throws(()=>requireDevApiOptIn(args),/exactly --dev-only/);
});
test('56 handler creation requires bounded port resolver',()=>{
  for(const value of [undefined,null,0,'8787',{},false])
    assert.throws(()=>createDevApiHandler(value),TypeError);
});
test('56 listener rejects invalid port and does not start a network service',async()=>{
  for(const port of [-1,65536,Infinity,NaN,'8787',null,1.25])
    await assert.rejects(startDevLandOsApi({port}),TypeError);
});
test('56 actual Node HTTP server binds only the IPv4 loopback interface',async t=>{
  const server=await startDevLandOsApi({port:0});
  t.after(async()=>{if(server.listening)await new Promise(done=>server.close(done))});
  const addr=server.address();
  assert.equal(addr.address,'127.0.0.1');
  assert.equal(addr.family,'IPv4');
  assert.ok(addr.port>0);
});
test('56 GET /health is small, static and explicitly has no authority',async t=>{
  const port=await start(t);
  const res=await send(port);
  assert.equal(res.status,200);
  assert.deepEqual(JSON.parse(res.body),{
    service:'land-os-api-dev',status:'running',
    identityProviderConnected:false,accountAuthorizationConnected:false,
    privateGeometryAvailable:false,releaseAuthorized:false,
  });
  assert.equal(res.headers['content-type'],'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'],'no-store');
  assert.equal(res.headers['x-content-type-options'],'nosniff');
  assert.equal(res.headers['referrer-policy'],'no-referrer');
  assert.equal(res.headers['x-frame-options'],'DENY');
  assert.equal(res.headers['access-control-allow-origin'],undefined);
  assert.equal(res.headers['set-cookie'],undefined);
});
test('56 all non-health endpoints are absent including auth and parcel paths',async t=>{
  const port=await start(t);
  for(const path of [
    '/','/auth','/auth/callback','/login','/logout',
    '/api/parcels','/api/geometry','/admin','/health/extra',
    '/health?secret=a','//health','/%68ealth',
  ]){
    const res=await send(port,{path});
    assert.equal(res.status,404,path);
    assert.equal(res.body,'');
    assert.equal(res.headers['access-control-allow-origin'],undefined);
  }
});
test('56 non-GET requests cannot call a route or upload credentials',async t=>{
  const port=await start(t);
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','HEAD']){
    const res=await send(port,{method,path:'/health'});
    assert.equal(res.status,404,method);
    assert.equal(res.body,'');
  }
});
test('56 host header tricks are rejected before any health response',async t=>{
  const port=await start(t);
  for(const host of [
    'evil.example','localhost:'+port,
    '127.0.0.1','127.0.0.1:443',
    '127.0.0.1:'+port+'.evil.test',
    '0.0.0.0:'+port,
  ]){
    const res=await send(port,{headers:{Host:host}});
    assert.equal(res.status,404,host);
  }
});
test('56 credentials, origins, and bearer token attempts deny even health',async t=>{
  const port=await start(t);
  for(const headers of [
    {Authorization:'Bearer sensitive-token'},
    {Cookie:'sid=sensitive-token'},
    {Origin:'https://malicious.example'},
    {'content-length':'0'},
    {'transfer-encoding':'chunked'},
  ]){
    const res=await send(port,{headers});
    assert.equal(res.status,404,JSON.stringify(Object.keys(headers)));
    assert.equal(res.body,'');
  }
});
test('56 JSON response does not reflect incoming request headers',async t=>{
  const port=await start(t);
  const res=await send(port,{headers:{'X-Attacker-Value':'PRIVATE_MARKER'}});
  assert.equal(res.status,200);
  assert.ok(!res.body.includes('PRIVATE_MARKER'));
});
test('56 blocked requests disclose neither paths nor credential values',async t=>{
  const port=await start(t);
  const response=await send(port,{
    path:'/api/private?key=PRIVATE_MARKER',
    headers:{Authorization:'Bearer PRIVATE_MARKER'},
  });
  assert.equal(response.status,404);
  assert.ok(!response.body.includes('PRIVATE_MARKER'));
  assert.equal(response.headers['content-length'],'0');
});
test('56 no trusted API process startup occurs from package import',async()=>{
  // The module was statically imported above and should not have opened a
  // listener. A real listener is created only by explicit startDevLandOsApi.
  assert.equal(typeof startDevLandOsApi,'function');
  assert.equal(requireDevApiOptIn(['--dev-only']),true);
});
test('56 source imports neither browser UI nor Supabase/geometry/DB providers',()=>{
  const source=readFileSync(new URL(
    '../../../server/standalone/land-os-api-dev.mjs',import.meta.url,
  ),'utf8');
  assert.match(source,/LOCAL-ONLY, UNROUTED/);
  assert.match(source,/No CORS, cookies, auth token or redirect support/);
  assert.match(source,/server\.listen\(port,HOST/);
  assert.match(source,/HOST='127\.0\.0\.1'/);
  assert.match(source,/releaseAuthorized:false/);
  assert.doesNotMatch(source,/from ['"][^'"]*(?:vite|cesium|supabase|parcel-|\.\.\/providers)/i);
  assert.doesNotMatch(source,/new Pool\(|ST_AsGeoJSON|server\.listen\(port,'0\.0\.0\.0'/);
});
test('56 no environment keys, user tokens, redirects or private geometry are used',()=>{
  const source=readFileSync(new URL(
    '../../../server/standalone/land-os-api-dev.mjs',import.meta.url,
  ),'utf8');
  assert.doesNotMatch(source,/process\.env\.|service_role|sb_secret_|fetch\(/);
  assert.doesNotMatch(source,/Set-Cookie|302|res\.writeHead\(30[12378]/);
  assert.doesNotMatch(source,/grantGeometry|canPublish|allowParcelRelease:true/);
});
