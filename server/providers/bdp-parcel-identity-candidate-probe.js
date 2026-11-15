import {
  isCanonicalCandidateIdentitySnapshot,
  sameCandidateIdentityRevision,
} from './bdp-parcel-identity-authority-contract.js';

/**
 * Step 40C-51 — UNROUTED / REVIEW-ONLY / SYNTHETIC double-read adapter.
 *
 * A pair of identical candidate snapshots is NEVER proof of source
 * authenticity, strong consistency, MFA or county entitlement.
 * This adapter cannot issue a session, approve a request, release geometry,
 * connect to any external identity provider, or serialize a network response.
 * It deliberately returns releaseAuthorized:false in ALL cases.
 *
 * A real issuer and a linearizable authorization/release boundary must be
 * separately designed and independently audited. Do not route this adapter.
 */
const DIGEST=/^[0-9a-f]{64}$/;
const COUNTY=/^48[0-9]{3}$/;
const INPUT_KEYS=['sessionDigest','countyFips','signal'];
const OPTIONS_KEYS=['fetchCandidate','now'];

const DENIED=Object.freeze({
  candidateConsistent:false,
  releaseAuthorized:false,
  actualProviderConnected:false,
});
const REVIEWED=Object.freeze({
  candidateConsistent:true,
  releaseAuthorized:false,
  actualProviderConnected:false,
});

function exactData(value,keys) {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return false;
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length)return false;
  const desc=Object.getOwnPropertyDescriptors(value);
  return keys.every(k=>Object.hasOwn(desc,k)
    &&Object.hasOwn(desc[k],'value')
    &&desc[k].enumerable===true);
}
function safeClock(value) {
  return Number.isSafeInteger(value)&&value>0;
}
function candidateCopy(value,context) {
  if(!isCanonicalCandidateIdentitySnapshot(value,context))return null;
  // Copy values immediately. A synthetic provider can mutate the originally
  // returned object between reads; retaining a reference could mask an ABA.
  // The second validation protects against modified/proxy-owned properties.
  const copy=Object.freeze({...value});
  return isCanonicalCandidateIdentitySnapshot(copy,context)?copy:null;
}
export function createUnroutedCandidateIdentityProbe(options={}) {
  if(!exactData(options,OPTIONS_KEYS)
    ||typeof options.fetchCandidate!=='function'
    ||typeof options.now!=='function') {
    throw new TypeError('Explicit private candidate fixture and clock required');
  }
  const {fetchCandidate,now}=options;
  return Object.freeze({
    async inspectTwoCandidateReads(input) {
      try {
        if(!exactData(input,INPUT_KEYS)
          ||typeof input.sessionDigest!=='string'
          ||!DIGEST.test(input.sessionDigest)
          ||typeof input.countyFips!=='string'
          ||!COUNTY.test(input.countyFips)
          ||!(input.signal instanceof AbortSignal)
          ||input.signal.aborted)return DENIED;

        const ctx=(time)=>Object.freeze({
          sessionDigest:input.sessionDigest,
          countyFips:input.countyFips,
          nowMs:time,
        });
        const request=Object.freeze({
          sessionDigest:input.sessionDigest,
          countyFips:input.countyFips,
          signal:input.signal,
        });
        const before=now();
        if(!safeClock(before)||input.signal.aborted)return DENIED;
        const a=await fetchCandidate(request);
        if(input.signal.aborted)return DENIED;
        const afterFirst=now();
        if(!safeClock(afterFirst)||afterFirst<before)return DENIED;
        const first=candidateCopy(a,ctx(afterFirst));
        if(!first)return DENIED;

        const b=await fetchCandidate(request);
        if(input.signal.aborted)return DENIED;
        const afterSecond=now();
        if(!safeClock(afterSecond)||afterSecond<afterFirst)return DENIED;
        const second=candidateCopy(b,ctx(afterSecond));
        if(!second)return DENIED;

        // A revoked/expired candidate at final observation must fail.
        // Matching revisions do NOT prove that the external authority is
        // authentic or prevent revocation just after this comparison.
        if(!sameCandidateIdentityRevision(first,second,ctx(afterSecond)))
          return DENIED;
        return REVIEWED;
      }catch {
        return DENIED;
      }
    },
  });
}
