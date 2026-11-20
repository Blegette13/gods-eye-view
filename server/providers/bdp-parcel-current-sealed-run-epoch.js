/**
 * Step 40C-45 — PRIVATE only: require a *specific* latest FINISHED,
 * complete, immutable sealed run plus a transactionally bumped epoch.
 * This is NOT source caching approval, redistribution rights, session
 * entitlement, completeness, or a release-time authorization decision.
 */
export const PRIVATE_CURRENT_SEALED_RUN_EPOCH_SQL =
  'SELECT * FROM bdp_parcel_index.parcel_current_sealed_run_epoch_rpc($1::text,$2::text,$3::bigint)';
const COUNTY=/^48[0-9]{3}$/;
const SOURCE=/^[a-z][a-z0-9_-]{2,79}$/;
const EPOCH_MAX=9223372036854775807n;
const COLS=['source_id','county_fips','run_id','epoch'];
function exact(obj,keys){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return false;
  const p=Object.getPrototypeOf(obj);
  return (p===Object.prototype||p===null)
    &&Object.keys(obj).length===keys.length
    &&keys.every(k=>Object.hasOwn(obj,k));
}
function canonicalEpoch(s){
  if(typeof s!=='string'||!/^[1-9][0-9]{0,18}$/.test(s))return false;
  try{return BigInt(s)<=EPOCH_MAX;}catch{return false;}
}
export function isCanonicalPrivateCurrentRunEpoch(value){
  return exact(value,['sourceId','countyFips','runId','epoch'])
    &&typeof value.sourceId==='string'&&SOURCE.test(value.sourceId)
    &&typeof value.countyFips==='string'&&COUNTY.test(value.countyFips)
    &&Number.isSafeInteger(value.runId)&&value.runId>0
    &&canonicalEpoch(value.epoch);
}
export function samePrivateCurrentRunEpoch(before,after){
  return isCanonicalPrivateCurrentRunEpoch(before)
    &&isCanonicalPrivateCurrentRunEpoch(after)
    &&before.sourceId===after.sourceId
    &&before.countyFips===after.countyFips
    &&before.runId===after.runId
    &&before.epoch===after.epoch;
}
export function createPrivateCurrentSealedRunEpochReader({queryFixedCurrentRunEpochRpc}={}){
  if(typeof queryFixedCurrentRunEpochRpc!=='function')
    throw new TypeError('Dedicated independently attested current-run epoch RPC required');
  return Object.freeze({
    async readSealedRunEpoch(input){
      if(!exact(input,['countyFips','sourceId','runId','signal'])
        ||typeof input.countyFips!=='string'||!COUNTY.test(input.countyFips)
        ||typeof input.sourceId!=='string'||!SOURCE.test(input.sourceId)
        ||!Number.isSafeInteger(input.runId)||input.runId<=0
        ||!(input.signal instanceof AbortSignal)||input.signal.aborted)return null;
      try{
        const result=await queryFixedCurrentRunEpochRpc(Object.freeze({
          text:PRIVATE_CURRENT_SEALED_RUN_EPOCH_SQL,
          values:Object.freeze([input.countyFips,input.sourceId,String(input.runId)]),
          signal:input.signal,
        }));
        if(input.signal.aborted||!result||!Array.isArray(result.rows)
          ||result.rows.length!==1)return null;
        const row=result.rows[0];
        if(!exact(row,COLS)||row.source_id!==input.sourceId
          ||row.county_fips!==input.countyFips
          ||row.run_id!==String(input.runId)||!canonicalEpoch(row.epoch))
          return null;
        return Object.freeze({
          sourceId:row.source_id,countyFips:row.county_fips,
          runId:input.runId,epoch:row.epoch,
        });
      }catch{return null;}
    },
  });
}
