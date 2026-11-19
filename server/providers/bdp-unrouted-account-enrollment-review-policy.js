/**
 * Step 40C-62D-C14A — SOURCE-ONLY, UNROUTED account enrollment review policy.
 * All inputs must originate from separate trusted server-side providers.
 * Pure review of snapshots is NOT an authorization decision or a SQL writer.
 * Actual writes require a separately reviewed atomic DB transaction that
 * locks/revalidates approval, nonce, reviewer, account, and audit state.
 * No accounts/sessions/county grants/geometry are created by this module.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISSUER=/^https:\/\/[a-z0-9]{8,40}\.supabase\.co\/auth\/v1$/;
const DIGEST=/^[0-9a-f]{64}$/;
const EPOCH=/^[1-9][0-9]{0,18}$/;
const MAX_EPOCH=9223372036854775807n;
const DAY_MS=86400000;
const APPROVAL_WINDOW_MS=900000;
const IDENTITY_KEYS=['provider','subject','issuer','providerIdentityConfirmed',
  'mfaConfirmed','appCountyGrantConfirmed','appSessionIssued','releaseAuthorized'];
const INVITE_KEYS=['inviteId','subject','issuer','issuedBy','nonceDigest',
  'state','expiresAtMs'];
const REQUEST_KEYS=['requestId','inviteId','subject','issuer','state','revision',
  'expiresAtMs'];
const REVIEWER_KEYS=['subject','state','permission','revision','source'];
const APPROVAL_KEYS=['approvalId','requestId','subject','issuer','reviewerSubject',
  'purpose','decision','state','nonceDigest','expiresAtMs','revision'];
const ACCOUNT_KEYS=['subject','account_state','revision','source','current'];
const INPUT_KEYS=['phase','identity','invitation','request','reviewer',
  'approval','account','nowMs'];
const PHASES=Object.freeze(['enroll_suspended','activate']);
function exactData(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return false;
  if(Reflect.ownKeys(value).length!==keys.length)return false;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  return keys.every(k=>Object.hasOwn(descriptors,k)&&
    Object.hasOwn(descriptors[k],'value')&&
    descriptors[k].enumerable===true);
}
function revision(value){
  return typeof value==='string'&&EPOCH.test(value)&&BigInt(value)<=MAX_EPOCH;
}
function within(now,expires,window){
  return Number.isSafeInteger(expires)&&expires>now
    &&expires-now<=window;
}
export function createUnroutedEnrollmentReviewPolicy({expectedIssuer}={}){
  if(typeof expectedIssuer!=='string'||!ISSUER.test(expectedIssuer))
    throw new TypeError('Fixed trusted Supabase issuer required');
  return Object.freeze({
    evaluateSnapshots(input){
      try{
        if(!exactData(input,INPUT_KEYS)||!PHASES.includes(input.phase)
          ||!Number.isSafeInteger(input.nowMs)||input.nowMs<=0)return null;
        const {phase,identity,invitation,request,reviewer,approval,account,nowMs}=input;
        if(!exactData(identity,IDENTITY_KEYS)||identity.provider!=='supabase'
          ||identity.providerIdentityConfirmed!==true
          ||identity.mfaConfirmed!==false
          ||identity.appCountyGrantConfirmed!==false
          ||identity.appSessionIssued!==false
          ||identity.releaseAuthorized!==false
          ||identity.issuer!==expectedIssuer||!UUID.test(identity.subject))
          return null;
        if(!exactData(invitation,INVITE_KEYS)
          ||!UUID.test(invitation.inviteId)||!UUID.test(invitation.issuedBy)
          ||invitation.subject!==identity.subject
          ||invitation.issuer!==expectedIssuer
          ||invitation.state!=='redeemed'
          ||!DIGEST.test(invitation.nonceDigest)
          ||!within(nowMs,invitation.expiresAtMs,DAY_MS))
          return null;
        if(!exactData(request,REQUEST_KEYS)
          ||!UUID.test(request.requestId)
          ||request.inviteId!==invitation.inviteId
          ||request.subject!==identity.subject
          ||request.issuer!==expectedIssuer
          ||request.state!==(phase==='enroll_suspended'
            ?'approved_for_enrollment':'enrolled_suspended')
          ||!revision(request.revision)
          ||!within(nowMs,request.expiresAtMs,DAY_MS))
          return null;
        if(!exactData(reviewer,REVIEWER_KEYS)||!UUID.test(reviewer.subject)
          ||reviewer.subject===identity.subject
          ||reviewer.subject===invitation.issuedBy
          ||invitation.issuedBy===identity.subject
          ||reviewer.state!=='active'
          ||reviewer.permission!=='account_enrollment_review'
          ||reviewer.source!=='app-owned-primary'
          ||!revision(reviewer.revision))return null;
        if(!exactData(approval,APPROVAL_KEYS)
          ||!UUID.test(approval.approvalId)
          ||approval.requestId!==request.requestId
          ||approval.subject!==identity.subject
          ||approval.issuer!==expectedIssuer
          ||approval.reviewerSubject!==reviewer.subject
          ||approval.purpose!==phase||approval.decision!=='approve'
          ||approval.state!=='unconsumed'
          ||!DIGEST.test(approval.nonceDigest)
          ||approval.nonceDigest===invitation.nonceDigest
          ||!revision(approval.revision)
          ||!within(nowMs,approval.expiresAtMs,APPROVAL_WINDOW_MS))
          return null;
        let expectedAccountRevision=null;
        if(phase==='enroll_suspended'){
          if(account!==null)return null;
        }else{
          if(!exactData(account,ACCOUNT_KEYS)
            ||account.subject!==identity.subject
            ||account.account_state!=='suspended'
            ||account.source!=='app-owned-primary'
            ||account.current!==true||!revision(account.revision)
            ||BigInt(account.revision)===MAX_EPOCH)return null;
          expectedAccountRevision=account.revision;
        }
        // A frozen, NON-AUTHORIZING review proposal. Do not convert this
        // return value into a database write, cookie or GIS authorization.
        return Object.freeze({
          kind:'unrouted-account-enrollment-review-proposal',
          phase,subject:identity.subject,issuer:expectedIssuer,
          requestId:request.requestId,approvalId:approval.approvalId,
          expectedAccountRevision,accountMutation:'none',
          requiresPrimaryTransaction:true,requiresDurableAudit:true,
          mfaConfirmed:false,appSessionIssued:false,
          countyGrantConfirmed:false,releaseAuthorized:false,
        });
      }catch{return null;}
    },
  });
}
