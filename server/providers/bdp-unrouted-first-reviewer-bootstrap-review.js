/**
 * Step 40C-62D-C14B2C3A — FIRST REVIEWER BOOTSTRAP DESIGN CONTRACT ONLY.
 *
 * A browser/operator-provided witness or database "snapshot" is NOT trusted
 * evidence. This pure, unrouted evaluator does not authenticate the candidate
 * or custodians, authorize a bootstrap, issue credentials, connect to PG,
 * create approval authority, or expose any HTTP or GIS route.
 * A non-null result is still an explicitly NON-AUTHORIZING review proposal.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISSUER=/^https:\/\/[a-z0-9]{8,40}\.supabase\.co\/auth\/v1$/;
const DIGEST=/^[0-9a-f]{64}$/;
const REV=/^[1-9][0-9]{0,18}$/;
const MAX_REV=9223372036854775807n;
const WINDOW_MS=15*60*1000;
const KEYS=['candidate','custodianReviews','databaseSnapshot','nowMs'];
const CANDIDATE=['subject','issuer'];
const REVIEW=['custodianSubject','channel','intent','digest','issuedAtMs','expiresAtMs'];
const DB=['database','source','currentPrimary','readOnly','reviewerCount',
  'sessionCount','countyGrantCount','revision'];
const CHANNELS=['out_of_band_security','out_of_band_operations'];
function exactData(obj,keys){
  if(obj===null||typeof obj!=='object'||Array.isArray(obj))return false;
  const proto=Object.getPrototypeOf(obj);
  if(proto!==Object.prototype&&proto!==null)return false;
  if(Reflect.ownKeys(obj).length!==keys.length)return false;
  const desc=Object.getOwnPropertyDescriptors(obj);
  return keys.every(k=>Object.hasOwn(desc,k)&&Object.hasOwn(desc[k],'value')
    &&desc[k].enumerable===true);
}
function reviewValid(v,now){
  return exactData(v,REVIEW)
    &&UUID.test(v.custodianSubject)&&CHANNELS.includes(v.channel)
    &&v.intent==='request_external_verification_only'
    &&DIGEST.test(v.digest)
    &&Number.isSafeInteger(v.issuedAtMs)
    &&v.issuedAtMs<=now&&now-v.issuedAtMs<=WINDOW_MS
    &&Number.isSafeInteger(v.expiresAtMs)
    &&v.expiresAtMs>now
    &&v.expiresAtMs>v.issuedAtMs
    &&v.expiresAtMs-v.issuedAtMs<=WINDOW_MS;
}
export function createUnroutedFirstReviewerBootstrapReview({expectedIssuer}={}){
  if(typeof expectedIssuer!=='string'||!ISSUER.test(expectedIssuer))
    throw new TypeError('Trusted project issuer must be fixed at construction');
  return Object.freeze({
    reviewPlan(input){
      try{
        if(!exactData(input,KEYS)
          ||!Number.isSafeInteger(input.nowMs)||input.nowMs<=0)return null;
        const {candidate,custodianReviews,databaseSnapshot,nowMs}=input;
        if(!exactData(candidate,CANDIDATE)
          ||!UUID.test(candidate.subject)||candidate.issuer!==expectedIssuer)
          return null;
        if(!Array.isArray(custodianReviews)||custodianReviews.length!==2
          ||Reflect.ownKeys(custodianReviews).length!==3)return null;
        const [a,b]=custodianReviews;
        if(!reviewValid(a,nowMs)||!reviewValid(b,nowMs)
          ||a.channel===b.channel
          ||a.custodianSubject===b.custodianSubject
          ||a.custodianSubject===candidate.subject
          ||b.custodianSubject===candidate.subject
          ||a.digest===b.digest)return null;
        if(!exactData(databaseSnapshot,DB)
          ||databaseSnapshot.database!=='ldos_c14b_disposable'
          ||databaseSnapshot.source!=='untrusted-review-snapshot'
          ||databaseSnapshot.currentPrimary!==true
          ||databaseSnapshot.readOnly!==true
          ||databaseSnapshot.reviewerCount!==0
          ||databaseSnapshot.sessionCount!==0
          ||databaseSnapshot.countyGrantCount!==0
          ||typeof databaseSnapshot.revision!=='string'
          ||!REV.test(databaseSnapshot.revision)
          ||BigInt(databaseSnapshot.revision)>MAX_REV)return null;
        // Do not copy the witness digests or identity metadata into the output.
        // All asserted fields still require independent real-world proof.
        return Object.freeze({
          kind:'unrouted-first-reviewer-bootstrap-design-review',
          candidateSubject:candidate.subject,
          issuer:expectedIssuer,
          independentCustodianReviewCount:2,
          nextStep:'external-provider-and-operator-evidence-verification',
          authorization:'none',
          accountMutation:'none',
          reviewerAuthorityMutation:'none',
          credentialCreation:'none',
          auditMutation:'none',
          canExecute:false,
          requiresOperatorCeremony:true,
          requiresIndependentProviderVerification:true,
          requiresProtectedCredentialChannels:true,
          requiresLivePrimaryAttestation:true,
          requiresAuditedAtomicBootstrap:true,
          requiresRecoveryAndRevocationDrill:true,
          sessionIssued:false,
          countyPermissionGranted:false,
          gisAccessGranted:false,
        });
      }catch{return null;}
    },
  });
}
