import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createUnroutedSupabaseAuthVerifier} from '../providers/bdp-supabase-auth-user-verifier.js';

/**
 * Step 40C-60 — first LOCAL-ONLY HTTP binding to the real Supabase /user verifier.
 * This is NOT a login, app-session exchange, MFA check, county authorization
 * or GIS data route. It never issues cookies or responds with subject/PII.
 * CLI requires --dev-only and process-local development project settings.
 * Absolutely no parcel/geometry or application-owned database access.
 */
const HOST='127.0.0.1';
const PORT=8788;
const BODY_PASS=JSON.stringify(Object.freeze({
  providerIdentityConfirmed:true,
  mfaConfirmed:false,
  appAccountAuthorized:false,
  appCountyGrantConfirmed:false,
  appSessionIssued:false,
  releaseAuthorized:false,
}));
const BODY_DENIED=JSON.stringify(Object.freeze({
  providerIdentityConfirmed:false,
  mfaConfirmed:false,
  appAccountAuthorized:false,
  appCountyGrantConfirmed:false,
  appSessionIssued:false,
  releaseAuthorized:false,
}));

export function requireLocalIdentityDevOptIn(args) {
  if (!Array.isArray(args) || args.length!==1 || args[0]!=='--dev-only')
    throw new Error('Refusing identity verification API without exactly --dev-only');
  return true;
}

function sendResult(res,code,body='') {
  res.statusCode=code;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Length',String(Buffer.byteLength(body)));
  res.end(body);
}

export function createLocalIdentityHandler(getPort,verifier) {
  if(typeof getPort!=='function'
    || !verifier || typeof verifier.verifyUserToken!=='function')
    throw new TypeError('Private verification provider and bound port required');
  return async function localIdentityRequest(req,res) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Pragma','no-cache');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'none'");
    // Intentionally omit ALL CORS allow-origin headers and Set-Cookie.
    const port=getPort();
    const raw=req?.rawHeaders;
    const bearerHeaderCount=Array.isArray(raw)
      ?raw.filter((entry,index)=>index%2===0
        &&typeof entry==='string'&&entry.toLowerCase()==='authorization').length
      :0;
    const allowed=Number.isInteger(port)&&port>0&&port<=65535
      && req?.socket?.remoteAddress===HOST
      && req?.headers?.host===HOST+':'+port
      && req?.method==='GET'
      && req?.url==='/dev/identity/check'
      && req.headers.origin===undefined
      && req.headers.cookie===undefined
      && req.headers['content-length']===undefined
      && req.headers['transfer-encoding']===undefined;
    if(!allowed) { sendResult(res,404); return; }

    const auth=req.headers.authorization;
    if(bearerHeaderCount!==1 || typeof auth!=='string'
      || !auth.startsWith('Bearer ') || auth.length>8200) {
      sendResult(res,401,BODY_DENIED);
      return;
    }
    const controller=new AbortController();
    // Treat client disconnection as cancellation, never finish a release.
    res.once('close',()=>controller.abort());
    let good=false;
    try {
      const evidence=await verifier.verifyUserToken({
        accessToken:auth.slice(7),signal:controller.signal,
      });
      good=!controller.signal.aborted
        &&evidence?.provider==='supabase'
        &&evidence?.providerIdentityConfirmed===true
        &&evidence?.mfaConfirmed===false
        &&evidence?.appCountyGrantConfirmed===false
        &&evidence?.appSessionIssued===false
        &&evidence?.releaseAuthorized===false;
    } catch {
      good=false;  // Never print token, URL or provider error.
    }
    if(res.destroyed || res.writableEnded)return;
    sendResult(res,good?200:401,good?BODY_PASS:BODY_DENIED);
  };
}

export async function startLocalIdentityDevApi({port=PORT,verifier}={}) {
  if(!Number.isInteger(port)||port<0||port>65535
    ||!verifier||typeof verifier.verifyUserToken!=='function')
    throw new TypeError('Local port and Supabase verifier required');
  let server;
  const handler=createLocalIdentityHandler(()=>server?.address()?.port,verifier);
  server=createServer((req,res)=>{
    Promise.resolve(handler(req,res)).catch(()=>{
      if(!res.headersSent)sendResult(res,401,BODY_DENIED);
      else res.destroy();
    });
  });
  server.maxHeadersCount=24;
  server.requestTimeout=5000;
  server.headersTimeout=5000;
  server.keepAliveTimeout=1000;
  try {
    await new Promise((resolveStarted,rejectStarted)=>{
      server.once('error',rejectStarted);
      server.listen(port,HOST,()=>{
        server.off('error',rejectStarted);
        resolveStarted();
      });
    });
  } catch {
    server.close();
    throw new Error('Local-only identity verification API unavailable');
  }
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireLocalIdentityDevOptIn(process.argv.slice(2));
    const verifier=createUnroutedSupabaseAuthVerifier({
      projectUrl:process.env.LDOS_SUPABASE_DEV_URL,
      publishableKey:process.env.LDOS_SUPABASE_DEV_PUBLISHABLE_KEY,
    });
    const server=await startLocalIdentityDevApi({verifier});
    process.stdout.write(
      'DEV ONLY: Supabase identity check on 127.0.0.1:8788; no sessions, grants or parcels enabled.\n'
    );
    for(const signal of ['SIGINT','SIGTERM'])
      process.once(signal,()=>server.close(()=>{process.exitCode=0;}));
  } catch {
    process.stderr.write('Development identity API not configured or unavailable.\n');
    process.exitCode=1;
  }
}
