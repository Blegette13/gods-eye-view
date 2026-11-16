import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Step 40C-56 — LOCAL-ONLY, UNROUTED trusted API process foundation.
 *
 * This is NOT an authentication API. It has exactly one route: GET /health.
 * It does not accept or verify Supabase tokens, issue cookies, call databases,
 * expose any parcel data or allow any remote clients. It never imports Vite,
 * Cesium, or private geometry providers. The public Vite interface is unchanged.
 *
 * Deployment, account authorization, MFA, final response-release decisions
 * and source-redistribution licensing must be independently implemented.
 */
const HOST='127.0.0.1';
const DEFAULT_PORT=8787;
const MAX_PORT=65535;
const HEALTH=JSON.stringify(Object.freeze({
  service:'land-os-api-dev',
  status:'running',
  identityProviderConnected:false,
  accountAuthorizationConnected:false,
  privateGeometryAvailable:false,
  releaseAuthorized:false,
}));
const HEALTH_BYTES=Buffer.byteLength(HEALTH,'utf8');

export function requireDevApiOptIn(args) {
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--dev-only')
    throw new Error('Refusing local API without exactly --dev-only');
  return true;
}
export function createDevApiHandler(getPort) {
  if(typeof getPort!=='function')throw new TypeError('Bound server port required');
  return function handleRequest(req,res) {
    // No CORS, cookies, auth token or redirect support. Never log headers.
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'none'");
    // Intentionally omit Access-Control-Allow-Origin for every route.
    // No request may impersonate a public hostname or enter from LAN.
    const port=getPort();
    const allowed=Number.isInteger(port)&&port>0&&port<=MAX_PORT
      &&req?.headers?.host===HOST+':'+port
      &&req?.socket?.remoteAddress===HOST;
    const safeHealth=allowed&&req.method==='GET'&&req.url==='/health'
      &&req.headers.authorization===undefined
      &&req.headers.cookie===undefined
      &&req.headers['content-length']===undefined
      &&req.headers['transfer-encoding']===undefined
      &&req.headers.origin===undefined;
    if(!safeHealth){
      res.statusCode=404;
      res.setHeader('Content-Length','0');
      res.end();
      return;
    }
    res.statusCode=200;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Content-Length',String(HEALTH_BYTES));
    res.end(HEALTH);
  };
}
export async function startDevLandOsApi({port=DEFAULT_PORT}={}) {
  if(!Number.isInteger(port)||port<0||port>MAX_PORT)
    throw new TypeError('Invalid loopback development port');
  let server;
  const handler=createDevApiHandler(()=>server?.address()?.port);
  server=createServer(handler);
  // Reject unexpectedly large headers before routing, no body processing.
  server.maxHeadersCount=32;
  server.requestTimeout=5000;
  server.headersTimeout=5000;
  server.keepAliveTimeout=1000;
  try{
    await new Promise((done,fail)=>{
      server.once('error',fail);
      server.listen(port,HOST,()=>{
        server.off('error',fail);
        done();
      });
    });
  }catch{
    server.close();
    throw new Error('Local-only development API unavailable');
  }
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireDevApiOptIn(process.argv.slice(2));
    const server=await startDevLandOsApi();
    process.stdout.write('DEV ONLY: local API health at http://127.0.0.1:8787/health; no auth or parcels enabled.\n');
    for(const signal of ['SIGINT','SIGTERM'])
      process.once(signal,()=>server.close(()=>{process.exitCode=0;}));
  }catch{
    process.stderr.write('Development API could not start. No routes mounted.\n');
    process.exitCode=1;
  }
}
