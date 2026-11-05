/**
 * Step 40C-36 — PRIVATE, UNROUTED, independent GIS publication review.
 * NEVER infer redistribution rights from public county REST or source caching.
 * Caller must inject a separately audited fixed-RPC reader; this parser alone
 * cannot authenticate DB rows, source licenses, sessions or county access.
 *
 * A matching, unexpired approval is necessary, NOT sufficient, for future
 * private geometry processing. No browser geometry or coverage is authorized.
 */
export const PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL =
  'SELECT * FROM bdp_parcel_index.parcel_geometry_publication_review_rpc($1::text,$2::text)';

const COUNTY=/^48[0-9]{3}$/;
const SOURCE=/^[a-z][a-z0-9_-]{2,79}$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9_./:-]{4,159}$/;
const INPUT=['countyFips','sourceId','signal'];
const ROW=['source_id','county_fips','review_state',
  'allow_geometry_redistribution','review_reference','reviewed_at_ms','expires_at_ms'];
function exact(x,keys) {
  if(!x||typeof x!=='object'||Array.isArray(x))return false;
  const proto=Object.getPrototypeOf(x);
  return (proto===Object.prototype||proto===null)
    && Object.keys(x).length===keys.length
    && keys.every(k=>Object.hasOwn(x,k));
}
export function createPrivateGeometryPublicationReviewReader({
  queryFixedPublicationRpc,now=Date.now,
}={}) {
  if(typeof queryFixedPublicationRpc!=='function'||typeof now!=='function') {
    throw new TypeError('Independent publication RPC reader and trusted clock required');
  }
  return Object.freeze({
    async readPublicationReview(args) {
      if(!exact(args,INPUT)||typeof args.countyFips!=='string'
        ||!COUNTY.test(args.countyFips)||typeof args.sourceId!=='string'
        ||!SOURCE.test(args.sourceId)||!(args.signal instanceof AbortSignal)
        ||args.signal.aborted)return null;
      try {
        const statement=Object.freeze({
          text:PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL,
          values:Object.freeze([args.countyFips,args.sourceId]),
          signal:args.signal,
        });
        const result=await queryFixedPublicationRpc(statement);
        if(args.signal.aborted||!result||!Array.isArray(result.rows)
          ||result.rows.length!==1)return null;
        const row=result.rows[0],clock=now();
        if(!exact(row,ROW)
          ||!Number.isSafeInteger(clock)||clock<=0
          ||row.source_id!==args.sourceId
          ||row.county_fips!==args.countyFips
          ||row.review_state!=='approved'
          ||row.allow_geometry_redistribution!==true
          ||typeof row.review_reference!=='string'
          ||!REF.test(row.review_reference)
          ||!Number.isSafeInteger(row.reviewed_at_ms)
          ||row.reviewed_at_ms<=0||row.reviewed_at_ms>clock
          ||!Number.isSafeInteger(row.expires_at_ms)
          ||row.expires_at_ms<=clock
          ||row.expires_at_ms<=row.reviewed_at_ms)return null;
        return Object.freeze({
          sourceId:row.source_id,countyFips:row.county_fips,
          reviewState:'approved',allowGeometryRedistribution:true,
          reviewReference:row.review_reference,
          reviewedAtMs:row.reviewed_at_ms,expiresAtMs:row.expires_at_ms,
        });
      }catch{return null;}
    },
  });
}
