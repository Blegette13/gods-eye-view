/**
 * Step 40C-62A — SERVER-ONLY, UNROUTED identity-to-account candidate bridge.
 * Injections are trusted server-side objects, never request/metadata fields.
 * A candidate is NOT authorization or account provisioning; there is no
 * session issuance, MFA proof, county grant, GIS rights or HTTP response.
 * This bridge deliberately has NO database/network implementation. A real
 * primary DB connection and its permissions require a separate approval.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISSUER=/^https:\/\/[a-z0-9]{8,40}\.supabase\.co\/auth\/v1$/;
const EPOCH=/^[1-9][0-9]{0,18}$/;
const MAX_EPOCH=9223372036854775807n;
const KEYS=Object.freeze([
  'provider','subject','issuer','providerIdentityConfirmed',
  'mfaConfirmed','appCountyGrantConfirmed','appSessionIssued','releaseAuthorized',
]);
const ACCOUNT_KEYS=Object.freeze([
  'subject','account_state','revision','source','current',
]);
function exactPlain(value, keys) {
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const p=Object.getPrototypeOf(value);
  if(p!==Object.prototype && p!==null)return false;
  const owned=Reflect.ownKeys(value);
  if(owned.length!==keys.length || !keys.every(k=>owned.includes(k)))return false;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  return keys.every(k=>Object.hasOwn(descriptors[k],'value')
    && descriptors[k].enumerable===true);
}
function validEpoch(value) {
  return typeof value==='string' && EPOCH.test(value)
    && BigInt(value)<=MAX_EPOCH;
}
export function createUnroutedCurrentAccountLink({identityVerifier,readPrimaryAccount,expectedIssuer}={}) {
  if(!identityVerifier || typeof identityVerifier.verifyUserToken!=='function'
    || typeof readPrimaryAccount!=='function'
    || typeof expectedIssuer!=='string' || !ISSUER.test(expectedIssuer))
    throw new TypeError('Trusted Supabase verifier, primary reader and issuer required');
  return Object.freeze({
    async getCandidate(input) {
      if(!exactPlain(input,['accessToken','signal'])
        || typeof input.accessToken!=='string'
        || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.accessToken)
        || input.accessToken.length<32 || input.accessToken.length>8192
        || !(input.signal instanceof AbortSignal) || input.signal.aborted)return null;
      try {
        const identity=await identityVerifier.verifyUserToken({
          accessToken:input.accessToken,signal:input.signal,
        });
        if(input.signal.aborted || !exactPlain(identity,KEYS)
          || identity.provider!=='supabase'
          || identity.issuer!==expectedIssuer
          || !UUID.test(identity.subject)
          || identity.providerIdentityConfirmed!==true
          || identity.mfaConfirmed!==false
          || identity.appCountyGrantConfirmed!==false
          || identity.appSessionIssued!==false
          || identity.releaseAuthorized!==false)return null;
        // This is a TRUSTED SERVER-SIDE adapter to the current app-owned
        // PRIMARY store. In production it must never read from a stale replica
        // and must not use any subject or account state from client metadata.
        const account=await readPrimaryAccount({
          subject:identity.subject,signal:input.signal,
        });
        if(input.signal.aborted || !exactPlain(account,ACCOUNT_KEYS)
          || account.subject!==identity.subject
          || account.account_state!=='active'
          || account.source!=='app-owned-primary'
          || account.current!==true
          || !validEpoch(account.revision))return null;
        return Object.freeze({
          kind:'unrouted-account-link-candidate',
          issuer:identity.issuer,
          subject:identity.subject,
          accountEpoch:account.revision,
          mfaConfirmed:false,
          appSessionIssued:false,
          countyGrantConfirmed:false,
          releaseAuthorized:false,
        });
      }catch{return null;}
    },
  });
}
