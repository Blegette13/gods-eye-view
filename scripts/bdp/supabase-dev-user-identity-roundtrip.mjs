import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateDevSupabaseHealthConfig} from './supabase-dev-auth-health-smoke.mjs';
import {createUnroutedSupabaseAuthVerifier} from '../../server/providers/bdp-supabase-auth-user-verifier.js';
import {startLocalIdentityDevApi} from '../../server/standalone/land-os-identity-verification-dev.mjs';

/**
 * Step 40C-61 — operator-opt-in DEVELOPMENT TEST USER round trip ONLY.
 * Input credentials are piped through stdin by the local operator, never
 * provided on a command line, displayed, stored, or sent to a Land OS route.
 * A short-lived in-process loopback Node server verifies a real Supabase user.
 * Access/refresh tokens, email, passwords, subject and user metadata are
 * NEVER returned to stdout, persisted, or copied to the original Cesium app.
 * Does NOT issue an app session, verify MFA, grant counties, or serve GIS.
 */
export const ROUNDTRIP_PASS =
  'PASS: development test user authenticated with Supabase and reverified by local Node API; MFA, app sessions, county grants and geometry remain disabled.';
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_CREDENTIAL_BYTES = 4096;
const MAX_SIGNIN_BYTES = 65536;
const MAX_VERDICT_BYTES = 2048;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const EXPECTED_KEYS = [
  'providerIdentityConfirmed', 'mfaConfirmed', 'appAccountAuthorized',
  'appCountyGrantConfirmed', 'appSessionIssued', 'releaseAuthorized',
];

export function requireDevUserRoundtripOptIn(args) {
  if(!Array.isArray(args) || args.length!==2
    || args[0]!=='--dev-only' || args[1]!=='--stdin-credentials')
    throw new Error('Refusing user probe without exactly --dev-only --stdin-credentials');
  return true;
}
export function parsePipedDevTestCredentials(input) {
  if(typeof input!=='string' || Buffer.byteLength(input,'utf8')>MAX_CREDENTIAL_BYTES)
    return null;
  try {
    const data=JSON.parse(input);
    if(!data || typeof data!=='object' || Array.isArray(data))return null;
    const names=Reflect.ownKeys(data);
    if(names.length!==2 || !names.includes('email') || !names.includes('password'))
      return null;
    if(typeof data.email!=='string' || data.email.length<5 || data.email.length>254
      || !/^[^\s@\u0000-\u001f]+@[^\s@\u0000-\u001f]+\.[^\s@\u0000-\u001f]+$/.test(data.email))
      return null;
    if(typeof data.password!=='string' || data.password.length<8
      || data.password.length>256 || /[\u0000-\u001f]/.test(data.password))
      return null;
    return Object.freeze({email:data.email,password:data.password});
  } catch {return null;}
}
export async function readPipedDevTestCredentials(stream) {
  if(!stream || stream.isTTY || typeof stream[Symbol.asyncIterator]!=='function')
    return null;
  let bytes=0;
  const chunks=[];
  try {
    for await(const part of stream) {
      const next=Buffer.isBuffer(part)?part:Buffer.from(part);
      bytes+=next.byteLength;
      if(bytes>MAX_CREDENTIAL_BYTES) return null;
      chunks.push(next);
    }
    const data=Buffer.concat(chunks);
    // Fail closed on malformed UTF-8 instead of changing credentials.
    const text=new TextDecoder('utf-8',{fatal:true}).decode(data);
    data.fill(0);
    return parsePipedDevTestCredentials(text);
  } catch {return null;}
  finally {for(const chunk of chunks) chunk.fill(0);}
}

async function boundedResponseJson(response,maxBytes) {
  if(!response || !response.headers || typeof response.headers.get!=='function'
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))
    return null;
  const declared=response.headers.get('content-length');
  if(declared!==null && (!/^\d{1,8}$/.test(declared) || Number(declared)>maxBytes))
    return null;
  if(!response.body || typeof response.body.getReader!=='function')return null;
  const reader=response.body.getReader();
  let total=0;
  const pieces=[];
  try {
    while(true) {
      const {value,done}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))return null;
      total+=value.byteLength;
      if(total>maxBytes)return null;
      pieces.push(value);
    }
    const combined=new Uint8Array(total);
    let offset=0;
    for(const piece of pieces){combined.set(piece,offset);offset+=piece.byteLength;}
    const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));
    combined.fill(0);
    return parsed;
  } catch {return null;}
  finally {try{await reader.cancel();}catch{} try{reader.releaseLock();}catch{}}
}
function exactVerdict(value,confirmed) {
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  if(Reflect.ownKeys(value).length!==EXPECTED_KEYS.length)return false;
  if(!EXPECTED_KEYS.every(key=>Object.hasOwn(value,key)))return false;
  if(value.providerIdentityConfirmed!==confirmed)return false;
  return EXPECTED_KEYS.slice(1).every(key=>value[key]===false);
}

/**
 * Operator creates a synthetic, confirmed DEV test user in the Supabase
 * Dashboard. The password grant is used only by this short-lived operator
 * diagnostic (never as our eventual app login architecture).
 * No provider secrets, Admin API, refresh exchange or client GIS endpoint.
 */
export async function checkRealDevSupabaseUserRoundtrip({
  config,credentials,fetchImpl=globalThis.fetch,
  startServer=startLocalIdentityDevApi,
}={}) {
  const validated=validateDevSupabaseHealthConfig(config);
  if(!validated || !credentials || typeof credentials!=='object'
    || !parsePipedDevTestCredentials(JSON.stringify(credentials))
    || typeof fetchImpl!=='function' || typeof startServer!=='function')return false;
  let server;
  try {
    const verifier=createUnroutedSupabaseAuthVerifier({
      projectUrl:validated.origin,publishableKey:validated.publishableKey,
      fetchImpl,
    });
    server=await startServer({port:0,verifier});
    if(server?.address()?.address!=='127.0.0.1')return false;
    const port=server.address().port;
    if(!Number.isInteger(port) || port<=0 || port>65535)return false;
    const loopback='http://127.0.0.1:'+port+'/dev/identity/check';

    // Negative control: requires real localhost listener to deny bad JWTs.
    const deny=await fetchImpl(loopback,{
      method:'GET',headers:{Authorization:'Bearer invalid.test.jwt',Accept:'application/json'},
      redirect:'error',cache:'no-store',credentials:'omit',
      signal:AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if(deny.status!==401 || !exactVerdict(await boundedResponseJson(deny,MAX_VERDICT_BYTES),false))
      return false;

    // Single explicit sign-in; never capture or print the refresh token.
    const signIn=await fetchImpl(validated.origin+'/auth/v1/token?grant_type=password',{
      method:'POST',headers:{
        apikey:validated.publishableKey,'Content-Type':'application/json',
        Accept:'application/json','Cache-Control':'no-store',
      },
      body:JSON.stringify({email:credentials.email,password:credentials.password}),
      redirect:'error',cache:'no-store',credentials:'omit',
      signal:AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if(signIn.status!==200)return false;
    const auth=await boundedResponseJson(signIn,MAX_SIGNIN_BYTES);
    const token=auth?.access_token;
    if(typeof token!=='string' || token.length<32 || token.length>8192
      || !JWT_RE.test(token) || String(auth.token_type).toLowerCase()!=='bearer')
      return false;

    const checked=await fetchImpl(loopback,{
      method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      redirect:'error',cache:'no-store',credentials:'omit',
      signal:AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    return checked.status===200
      && exactVerdict(await boundedResponseJson(checked,MAX_VERDICT_BYTES),true)
      && checked.headers.get('set-cookie')===null
      && checked.headers.get('access-control-allow-origin')===null;
  } catch {return false;}
  finally {
    if(server){
      try{await new Promise(done=>server.close(done));}catch{/* short-lived */}
    }
  }
}

export async function runDevUserRoundtripCLI({
  args=process.argv.slice(2),env=process.env,stream=process.stdin,
  fetchImpl=globalThis.fetch,
}={}) {
  requireDevUserRoundtripOptIn(args);
  if(stream?.isTTY)throw new Error('Test credentials must be provided over stdin, not interactively');
  const config={projectUrl:env?.LDOS_SUPABASE_DEV_URL,
    publishableKey:env?.LDOS_SUPABASE_DEV_PUBLISHABLE_KEY};
  if(!validateDevSupabaseHealthConfig(config))
    throw new Error('Development Supabase environment not configured');
  const credentials=await readPipedDevTestCredentials(stream);
  if(!credentials)throw new Error('Development test user credentials invalid or missing');
  if(!await checkRealDevSupabaseUserRoundtrip({config,credentials,fetchImpl}))
    throw new Error('Development user check failed (sign-in or local verification unavailable)');
  return ROUNDTRIP_PASS;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runDevUserRoundtripCLI().then(
    text=>process.stdout.write(text+'\n'),
    ()=>{process.stderr.write('Development user check failed; no permissions granted.\n');process.exitCode=1;},
  );
}
