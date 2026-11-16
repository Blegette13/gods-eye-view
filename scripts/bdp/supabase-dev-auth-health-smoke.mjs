import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/**
 * Step 40C-55 — DEV-ONLY authenticated gateway reachability check.
 * GET /auth/v1/health with a PUBLIC Supabase publishable key only.
 * This does NOT verify any user, require a JWT, create login, connect to
 * Postgres, prove MFA or grant GIS/public data redistribution rights.
 *
 * No project reference or API key is hard-coded. No HTTP server mounted.
 * The only remotely accessed endpoint is a fixed Supabase Auth health URL.
 */
const PROJECT_HOST = /^[a-z0-9]{8,40}\.supabase\.co$/;
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{8,256}$/;
const MAX_BYTES = 2048;
const TIMEOUT_MS = 8000;
const PASS = 'PASS: development Supabase Auth health endpoint reachable using publishable key; no user or land permissions tested.';

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exact(value, allowed, required) {
  if (!plain(value)) return false;
  try {
    const own = Reflect.ownKeys(value);
    const desc = Object.getOwnPropertyDescriptors(value);
    return own.length >= required.length && own.length <= allowed.length
      && own.every(k => typeof k === 'string' && allowed.includes(k)
        && Object.hasOwn(desc[k], 'value') && desc[k].enumerable === true)
      && required.every(k => Object.hasOwn(desc,k));
  } catch { return false; }
}
function normalizedOrigin(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !PROJECT_HOST.test(u.hostname)
      || u.username || u.password || u.search || u.hash
      || u.pathname !== '/' || u.port) return null;
    return u.origin;
  } catch { return null; }
}
export function validateDevSupabaseHealthConfig(config) {
  if (!exact(config,['projectUrl','publishableKey'],['projectUrl','publishableKey']))
    return null;
  const origin = normalizedOrigin(config.projectUrl);
  if (!origin || typeof config.publishableKey !== 'string'
    || !PUBLISHABLE_KEY.test(config.publishableKey)) return null;
  return Object.freeze({origin,publishableKey:config.publishableKey});
}
async function checkBody(response,signal) {
  if (!response || response.status !== 200
    || !response.headers || typeof response.headers.get !== 'function'
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))
    return false;
  const length = response.headers.get('content-length');
  if (length !== null && (!/^[0-9]{1,5}$/.test(length)
    || Number(length) > MAX_BYTES)) return false;
  if (!response.body || typeof response.body.getReader !== 'function') return false;
  const reader = response.body.getReader();
  let bytes=0;
  const chunks=[];
  try {
    while(true){
      if(signal.aborted)return false;
      const next=await reader.read();
      if(next.done)break;
      if(!(next.value instanceof Uint8Array))return false;
      bytes+=next.value.byteLength;
      if(bytes>MAX_BYTES)return false;
      chunks.push(next.value);
    }
    if(signal.aborted)return false;
    const all=new Uint8Array(bytes);
    let at=0;
    for(const chunk of chunks){all.set(chunk,at);at+=chunk.byteLength;}
    const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
    return !!result && !Array.isArray(result)
      && result.name==='GoTrue' && typeof result.version==='string'
      && result.version.length>0 && result.version.length<=80;
  } catch { return false; }
  finally {
    try{await reader.cancel();}catch{/* done */}
    try{reader.releaseLock();}catch{/* done */}
  }
}
/**
 * Returns false for any invalid/unavailable service without echoing URL,
 * API key, response body, raw HTTP errors or other credentials.
 */
export async function checkDevSupabaseAuthHealth(config,options={}) {
  try {
    const validated=validateDevSupabaseHealthConfig(config);
    if (!validated || !exact(options,['fetchImpl','signal'],[])
      || (Object.hasOwn(options,'signal')
        && !(options.signal instanceof AbortSignal))
      || (Object.hasOwn(options,'fetchImpl')
        && typeof options.fetchImpl!=='function'))
      return false;
    const fetchImpl=options.fetchImpl??globalThis.fetch;
    if(typeof fetchImpl!=='function'||options.signal?.aborted)return false;
    const timeout=AbortSignal.timeout(TIMEOUT_MS);
    const signal=options.signal
      ?AbortSignal.any([options.signal,timeout]):timeout;
    const result=await fetchImpl(validated.origin+'/auth/v1/health',{
      method:'GET',
      headers:Object.freeze({
        apikey:validated.publishableKey,
        Accept:'application/json',
        'Cache-Control':'no-store',
      }),
      redirect:'error',cache:'no-store',credentials:'omit',signal,
    });
    if(signal.aborted)return false;
    return await checkBody(result,signal);
  } catch { return false; }
}
export async function runDevSupabaseAuthHealthSmoke(
  args=process.argv.slice(2),env=process.env,options={}
) {
  if (!Array.isArray(args) || args.length!==1 || args[0]!=='--dev-only')
    throw new Error('Refusing Supabase development health test without exactly --dev-only');
  // No fallback to other environments, legacy anon keys, service-role or secret.
  const ok=await checkDevSupabaseAuthHealth({
    projectUrl:env?.LDOS_SUPABASE_DEV_URL,
    publishableKey:env?.LDOS_SUPABASE_DEV_PUBLISHABLE_KEY,
  },options);
  if(!ok)throw new Error('Development Supabase Auth health check unavailable or configuration invalid');
  return PASS;
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runDevSupabaseAuthHealthSmoke().then(
    message=>process.stdout.write(message+'\n'),
    err=>{process.stderr.write(err.message+'\n');process.exitCode=1;},
  );
}
