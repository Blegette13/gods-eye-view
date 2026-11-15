/**
 * Step 40C-50: UNROUTED REVIEW-ONLY schema for a FUTURE authoritative
 * account/session/MFA/county-grant provider. NOT an authentication provider.
 *
 * This module proves ONLY that a *candidate* payload has a canonical
 * representation. A caller may fabricate every property, including epochs.
 * NEVER treat a true result as authority to read, release, cache or publish
 * source geometry. No sessions, tokens, MFA, county grants or DB connections
 * are created here. A trusted primary/strongly current identity integration
 * and a separate revocation/release protocol remain REQUIRED.
 */
const DIGEST=/^[0-9a-f]{64}$/;
const COUNTY=/^48[0-9]{3}$/;
const EPOCH=/^[1-9][0-9]{0,18}$/;
const PG_MAX=9223372036854775807n;
const MAX_SESSION_MS=8*60*60*1000;
const KEYS=Object.freeze([
  'sessionDigest','countyFips','accountState','sessionState',
  'mfaState','countyGrantState','accountEpoch','sessionEpoch',
  'mfaEpoch','countyGrantEpoch','issuedAtMs','expiresAtMs','observedAtMs',
]);
const CONTEXT=Object.freeze(['sessionDigest','countyFips','nowMs']);
const REVISION=Object.freeze([
  'accountEpoch','sessionEpoch','mfaEpoch','countyGrantEpoch',
]);
function exact(obj,keys){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return false;
  const proto=Object.getPrototypeOf(obj);
  if(proto!==Object.prototype&&proto!==null)return false;
  const own=Reflect.ownKeys(obj);
  if(own.length!==keys.length)return false;
  const descriptors=Object.getOwnPropertyDescriptors(obj);
  return keys.every(key=>Object.hasOwn(descriptors,key)
    &&Object.hasOwn(descriptors[key],'value')
    &&descriptors[key].enumerable===true);
}
function pgEpoch(value){
  if(typeof value!=='string'||!EPOCH.test(value))return false;
  try{return BigInt(value)<=PG_MAX;}catch{return false;}
}
function contextValid(ctx){
  return exact(ctx,CONTEXT)
    &&typeof ctx.sessionDigest==='string'&&DIGEST.test(ctx.sessionDigest)
    &&typeof ctx.countyFips==='string'&&COUNTY.test(ctx.countyFips)
    &&Number.isSafeInteger(ctx.nowMs)&&ctx.nowMs>0;
}
/**
 * An exact, plausible shape is NOT proof of origin, authentication, MFA
 * validity, revocation currency, allowed use or legally licensed GIS data.
 * No positive release/authorization decision is returned.
 */
export function isCanonicalCandidateIdentitySnapshot(snapshot,ctx){
  try {
  if(!contextValid(ctx)||!exact(snapshot,KEYS))return false;
  if(snapshot.sessionDigest!==ctx.sessionDigest
    ||snapshot.countyFips!==ctx.countyFips
    ||snapshot.accountState!=='active'
    ||snapshot.sessionState!=='active'
    ||snapshot.mfaState!=='verified'
    ||snapshot.countyGrantState!=='allowed'
    ||!REVISION.every(k=>pgEpoch(snapshot[k]))
    ||!Number.isSafeInteger(snapshot.issuedAtMs)
    ||!Number.isSafeInteger(snapshot.expiresAtMs)
    ||!Number.isSafeInteger(snapshot.observedAtMs)
    ||snapshot.issuedAtMs<=0||snapshot.issuedAtMs>snapshot.observedAtMs
    ||snapshot.observedAtMs>ctx.nowMs
    ||snapshot.expiresAtMs<=ctx.nowMs
    ||snapshot.expiresAtMs<=snapshot.issuedAtMs
    ||snapshot.expiresAtMs-snapshot.issuedAtMs>MAX_SESSION_MS)return false;
  return true;
  } catch { return false; }
}
/**
 * Compare candidate revision evidence for review/test scenarios only.
 * Equal epochs are necessary to avoid accidental stale-cursor use, but
 * equality is INSUFFICIENT for authority or any on-wire release decision.
 */
export function sameCandidateIdentityRevision(before,after,ctx){
  try {
  return isCanonicalCandidateIdentitySnapshot(before,ctx)
    &&isCanonicalCandidateIdentitySnapshot(after,ctx)
    &&REVISION.every(k=>before[k]===after[k])
    &&before.issuedAtMs===after.issuedAtMs
    &&before.expiresAtMs===after.expiresAtMs
    &&after.observedAtMs>=before.observedAtMs;
  } catch { return false; }
}
/**
 * A fixed generic review verdict; deliberately NEVER returns "allowed".
 * A legitimate provider must be separately built, audited and composed.
 */
export function inspectCandidateIdentityContract(snapshot,ctx){
  return Object.freeze({
    contractMatches:isCanonicalCandidateIdentitySnapshot(snapshot,ctx),
    releaseAuthorized:false,
    actualProviderConnected:false,
  });
}
