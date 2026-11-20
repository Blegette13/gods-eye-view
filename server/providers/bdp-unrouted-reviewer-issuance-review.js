/**
 * Step 40C-62D-C14B2C2A — SOURCE-ONLY, UNROUTED review-issuance proposal.
 *
 * WARNING: An evidence snapshot is not independently authenticated proof.
 * Caller must eventually inject two separately verified provider identities,
 * locked primary reviewer/approval records and an audited writer transaction.
 * This module has NO database, credential, network, HTTP or approval WRITE.
 * A non-null result is deliberately NON-AUTHORIZING and MUST NOT be used
 * as a capability by any account-enrollment writer.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISSUER=/^https:\/\/[a-z0-9]{8,40}\.supabase\.co\/auth\/v1$/;
const DIGEST=/^[0-9a-f]{64}$/;
const REVISION=/^[1-9][0-9]{0,18}$/;
const MAX_REVISION=9223372036854775807n;
const DAY_MS=86400000;
const APPROVAL_MS=900000;
const INPUT=['phase','applicantIdentity','reviewerIdentity','reviewerAuthority',
  'invitation','request','approvalIntent','existingPurposeApproval','account','nowMs'];
const IDENT=['provider','subject','issuer','providerIdentityConfirmed',
  'mfaConfirmed','appCountyGrantConfirmed','appSessionIssued','releaseAuthorized'];
const AUTH=['subject','state','permission','revision','source','current'];
const INVITE=['inviteId','subject','issuer','issuedBy','nonceDigest','state','expiresAtMs'];
const REQ=['requestId','inviteId','subject','issuer','state','revision','expiresAtMs'];
const INTENT=['approvalId','requestId','subject','issuer','reviewerSubject',
  'purpose','nonceDigest','expiresAtMs'];
const ACCOUNT=['subject','account_state','revision','source','current'];
const PHASES=['enroll_suspended','activate'];
function exactOwnData(record,keys){
  if(!record||typeof record!=='object'||Array.isArray(record))return false;
  const prototype=Object.getPrototypeOf(record);
  if(prototype!==Object.prototype&&prototype!==null)return false;
  if(Reflect.ownKeys(record).length!==keys.length)return false;
  const descriptors=Object.getOwnPropertyDescriptors(record);
  return keys.every(k=>{
    const d=descriptors[k];
    return d&&Object.hasOwn(d,'value')&&d.enumerable===true;
  });
}
function epoch(value){
  return typeof value==='string'&&REVISION.test(value)&&
    BigInt(value)<=MAX_REVISION;
}
function fresh(now,until,windowMs){
  return Number.isSafeInteger(until)&&until>now&&until-now<=windowMs;
}
function validIdentity(identity,issuer){
  return exactOwnData(identity,IDENT)&&identity.provider==='supabase'
    &&UUID.test(identity.subject)&&identity.issuer===issuer
    &&identity.providerIdentityConfirmed===true
    &&identity.mfaConfirmed===false
    &&identity.appCountyGrantConfirmed===false
    &&identity.appSessionIssued===false
    &&identity.releaseAuthorized===false;
}
export function createUnroutedReviewerIssuanceReview({expectedIssuer}={}){
  if(typeof expectedIssuer!=='string'||!ISSUER.test(expectedIssuer))
    throw new TypeError('Fixed trusted Supabase issuer required');
  return Object.freeze({
    reviewSnapshots(input){
      try{
        if(!exactOwnData(input,INPUT)||!PHASES.includes(input.phase)
          ||!Number.isSafeInteger(input.nowMs)||input.nowMs<=0)return null;
        const {phase,applicantIdentity,reviewerIdentity,reviewerAuthority,
          invitation,request,approvalIntent,existingPurposeApproval,account,nowMs}=input;
        // These flags distinguish provider identity from app authorization.
        // Actual provider verification MUST occur outside this pure evaluator.
        if(!validIdentity(applicantIdentity,expectedIssuer)
          ||!validIdentity(reviewerIdentity,expectedIssuer)
          ||reviewerIdentity.subject===applicantIdentity.subject)return null;
        if(!exactOwnData(reviewerAuthority,AUTH)
          ||reviewerAuthority.subject!==reviewerIdentity.subject
          ||reviewerAuthority.state!=='active'
          ||reviewerAuthority.permission!=='account_enrollment_review'
          ||reviewerAuthority.source!=='app-owned-primary'
          ||reviewerAuthority.current!==true
          ||!epoch(reviewerAuthority.revision))return null;
        if(!exactOwnData(invitation,INVITE)
          ||!UUID.test(invitation.inviteId)
          ||!UUID.test(invitation.issuedBy)
          ||invitation.subject!==applicantIdentity.subject
          ||invitation.issuer!==expectedIssuer
          ||invitation.state!=='redeemed'
          ||!DIGEST.test(invitation.nonceDigest)
          ||invitation.issuedBy===applicantIdentity.subject
          ||invitation.issuedBy===reviewerIdentity.subject
          ||!fresh(nowMs,invitation.expiresAtMs,DAY_MS))return null;
        if(!exactOwnData(request,REQ)
          ||!UUID.test(request.requestId)
          ||request.inviteId!==invitation.inviteId
          ||request.subject!==applicantIdentity.subject
          ||request.issuer!==expectedIssuer
          ||request.state!==(phase==='enroll_suspended'?'pending':'enrolled_suspended')
          ||!epoch(request.revision)
          ||!fresh(nowMs,request.expiresAtMs,DAY_MS))return null;
        // Null means "no same-request/same-purpose approval observed" ONLY.
        // A future transaction MUST enforce this on the locked current
        // primary with UNIQUE(request_id,purpose); never trust snapshots.
        if(existingPurposeApproval!==null)return null;
        if(!exactOwnData(approvalIntent,INTENT)
          ||!UUID.test(approvalIntent.approvalId)
          ||approvalIntent.requestId!==request.requestId
          ||approvalIntent.subject!==applicantIdentity.subject
          ||approvalIntent.issuer!==expectedIssuer
          ||approvalIntent.reviewerSubject!==reviewerIdentity.subject
          ||approvalIntent.purpose!==phase
          ||!DIGEST.test(approvalIntent.nonceDigest)
          ||approvalIntent.nonceDigest===invitation.nonceDigest
          ||!fresh(nowMs,approvalIntent.expiresAtMs,APPROVAL_MS)
          ||approvalIntent.expiresAtMs>=request.expiresAtMs
          ||approvalIntent.expiresAtMs>=invitation.expiresAtMs)return null;
        let expectedAccountRevision=null;
        if(phase==='enroll_suspended'){
          if(account!==null)return null;
        }else{
          if(!exactOwnData(account,ACCOUNT)
            ||account.subject!==applicantIdentity.subject
            ||account.account_state!=='suspended'
            ||account.source!=='app-owned-primary'
            ||account.current!==true
            ||!epoch(account.revision)
            ||BigInt(account.revision)===MAX_REVISION)return null;
          expectedAccountRevision=account.revision;
        }
        return Object.freeze({
          kind:'unrouted-review-issuance-design-proposal',
          phase,subject:applicantIdentity.subject,
          reviewerSubject:reviewerIdentity.subject,issuer:expectedIssuer,
          requestId:request.requestId,approvalId:approvalIntent.approvalId,
          expectedAccountRevision,
          authorization:'none',approvalMutation:'none',accountMutation:'none',
          requiresIndependentLiveVerification:true,
          requiresPrimaryRowLocks:true,
          requiresAtomicAudit:true,
          reviewerMfaConfirmed:false,appSessionIssued:false,
          countyGrantConfirmed:false,releaseAuthorized:false,
        });
      }catch{return null;}
    },
  });
}
