/**
 * Step 40C-53: FIRST REAL SUPABASE AUTH NETWORK BOUNDARY (UNROUTED).
 *
 * This adapter calls the project's Auth server /auth/v1/user endpoint with
 * a user-supplied, UNTRUSTED Supabase access token. Only the server's 200
 * response can confirm the subject; browser JWT claims are NEVER decoded
 * and trusted here. No secret/service-role keys, cookies, login issuance,
 * refresh tokens, app grant/entitlement or geometry API are supported.
 *
 * This returns identity evidence ONLY, not MFA proof, session freshness,
 * app-account status, county grants, source redistribution rights or a
 * network response release decision. It is not wired to any HTTP route.
 * It MUST NOT be used as findSessionByDigest or as parcel authorization.
 *
 * Verified against Supabase docs: /auth/v1/user with a publishable apikey
 * and Authorization: Bearer <access JWT>, https://supabase.com/docs/guides/auth/jwts
 */
const AUTH_URL = /^https:\/\/[a-z0-9]{8,40}\.supabase\.co$/;
const PUBLISHABLE = /^sb_publishable_[A-Za-z0-9_-]{8,256}$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TOKEN_BYTES = 8192;
const MAX_RESPONSE_BYTES = 16384;
const TIMEOUT_MS = 5000;
const CONFIG_KEYS = ['projectUrl','publishableKey','fetchImpl'];
const INPUT_KEYS = ['accessToken','signal'];

function exactData(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length) return false;
  const desc = Object.getOwnPropertyDescriptors(value);
  return keys.every(k => Object.hasOwn(desc,k)
    && Object.hasOwn(desc[k],'value') && desc[k].enumerable === true);
}
function exactConfig(value) {
  const keys = Reflect.ownKeys(value);
  return exactData(value, CONFIG_KEYS)
    || (keys.length === 2 &&
      exactData(value, ['projectUrl','publishableKey']));
}
function validProjectUrl(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^[a-z0-9]{8,40}\.supabase\.co$/.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash
      || url.pathname !== '/' || !AUTH_URL.test(url.origin)) return null;
    return url.origin;
  } catch { return null; }
}
function validToken(value) {
  return typeof value === 'string' && value.length <= MAX_TOKEN_BYTES
    && value.length >= 32 && JWT.test(value);
}
function validUser(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.id !== 'string' || !UUID.test(value.id)
    || value.role !== 'authenticated' || value.is_anonymous !== false) return null;
  return value.id;
}
async function boundedJson(response, signal) {
  if (!response || response.status !== 200 || !response.headers
    || typeof response.headers.get !== 'function'
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) return null;
  const stated = response.headers.get('content-length');
  if (stated !== null && (!/^[0-9]{1,8}$/.test(stated) || Number(stated) > MAX_RESPONSE_BYTES))
    return null;
  if (!response.body || typeof response.body.getReader !== 'function') return null;
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      if (signal.aborted) return null;
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) return null;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) return null;
      chunks.push(value);
    }
    if (signal.aborted) return null;
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk,offset); offset += chunk.byteLength; }
    const parsed = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
    return validUser(parsed);
  } catch { return null; }
  finally {
    try { await reader.cancel(); } catch { /* response invalid/closed */ }
    try { reader.releaseLock(); } catch { /* response invalid/closed */ }
  }
}
export function createUnroutedSupabaseAuthVerifier(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || !exactConfig(config)) throw new TypeError('Supabase URL and publishable key required');
  const baseUrl = validProjectUrl(config.projectUrl);
  if (!baseUrl || typeof config.publishableKey !== 'string'
    || !PUBLISHABLE.test(config.publishableKey)
    || (Object.hasOwn(config,'fetchImpl') && typeof config.fetchImpl !== 'function'))
    throw new TypeError('Valid Supabase project and publishable key required');
  const publishableKey = config.publishableKey;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('Server fetch is required');
  return Object.freeze({
    async verifyUserToken(input) {
      try {
        if (!exactData(input,INPUT_KEYS) || !validToken(input.accessToken)
          || !(input.signal instanceof AbortSignal) || input.signal.aborted) return null;
        // Never forward this token in a query string, logs, or a redirect.
        // Do not infer any MFA or county entitlements from successful /user.
        const timeout = AbortSignal.timeout(TIMEOUT_MS);
        const combined = AbortSignal.any([input.signal, timeout]);
        const response = await fetchImpl(baseUrl + '/auth/v1/user',{
          method:'GET',
          headers:{
            apikey:publishableKey,
            Authorization:'Bearer ' + input.accessToken,
            Accept:'application/json',
            'Cache-Control':'no-store',
          },
          redirect:'error',
          cache:'no-store',
          credentials:'omit',
          signal:combined,
        });
        if (combined.aborted) return null;
        const subject = await boundedJson(response,combined);
        if (!subject || combined.aborted) return null;
        return Object.freeze({
          provider:'supabase',
          subject,
          issuer:baseUrl + '/auth/v1',
          providerIdentityConfirmed:true,
          mfaConfirmed:false,
          appCountyGrantConfirmed:false,
          appSessionIssued:false,
          releaseAuthorized:false,
        });
      } catch { return null; }
    },
  });
}
