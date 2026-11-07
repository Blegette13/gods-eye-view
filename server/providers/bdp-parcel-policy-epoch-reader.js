/**
 * Step 40C-41 — PRIVATE, UNROUTED policy-epoch snapshot reader.
 * Epochs are NOT source rights, a GIS redistribution approval, county grants,
 * an ingest seal, or a release gate. A revoked source may still have epochs.
 * Trusted callers must separately authenticate and verify those facts.
 */
export const PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL =
  'SELECT * FROM bdp_parcel_index.parcel_policy_epoch_snapshot_rpc($1::text,$2::text)';
const COUNTY=/^48[0-9]{3}$/;
const SOURCE=/^[a-z][a-z0-9_-]{2,79}$/;
const PG_INT8_MAX=9223372036854775807n;
const FIELDS=['source_id','county_fips','source_cache_epoch','publication_epoch'];
const INPUT=['countyFips','sourceId','signal'];
function exact(x,keys) {
  if(!x||typeof x!=='object'||Array.isArray(x))return false;
  const p=Object.getPrototypeOf(x);
  return (p===Object.prototype||p===null)
    && Object.keys(x).length===keys.length
    && keys.every(key=>Object.hasOwn(x,key));
}
function validEpoch(x) {
  if(typeof x!=='string'||!/^[1-9][0-9]{0,18}$/.test(x))return false;
  try {return BigInt(x)<=PG_INT8_MAX;}catch{return false;}
}
export function isCanonicalPrivatePolicyEpochSnapshot(value) {
  return exact(value,['sourceId','countyFips','sourceCacheEpoch','publicationEpoch'])
    &&typeof value.sourceId==='string'&&SOURCE.test(value.sourceId)
    &&typeof value.countyFips==='string'&&COUNTY.test(value.countyFips)
    &&validEpoch(value.sourceCacheEpoch)&&validEpoch(value.publicationEpoch);
}
/**
 * Strict equality is essential: A→B→A current rights facts can match, but
 * transactionally bumped policy epochs CANNOT match unless the revision
 * authority itself is compromised. This has no race-free release guarantee.
 */
export function samePrivatePolicyEpochSnapshot(before,after) {
  return isCanonicalPrivatePolicyEpochSnapshot(before)
    &&isCanonicalPrivatePolicyEpochSnapshot(after)
    &&before.sourceId===after.sourceId
    &&before.countyFips===after.countyFips
    &&before.sourceCacheEpoch===after.sourceCacheEpoch
    &&before.publicationEpoch===after.publicationEpoch;
}
export function createPrivatePolicyEpochReader({queryFixedEpochRpc}={}) {
  if(typeof queryFixedEpochRpc!=='function') {
    throw new TypeError('Independently attested private epoch RPC required');
  }
  return Object.freeze({
    async readPolicyEpochSnapshot(input) {
      if(!exact(input,INPUT)||typeof input.countyFips!=='string'
        ||!COUNTY.test(input.countyFips)||typeof input.sourceId!=='string'
        ||!SOURCE.test(input.sourceId)||!(input.signal instanceof AbortSignal)
        ||input.signal.aborted)return null;
      try {
        const statement=Object.freeze({
          text:PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL,
          values:Object.freeze([input.countyFips,input.sourceId]),
          signal:input.signal,
        });
        const result=await queryFixedEpochRpc(statement);
        if(input.signal.aborted||!result||!Array.isArray(result.rows)
          ||result.rows.length!==1)return null;
        const row=result.rows[0];
        if(!exact(row,FIELDS)||row.source_id!==input.sourceId
          ||row.county_fips!==input.countyFips
          ||!validEpoch(row.source_cache_epoch)
          ||!validEpoch(row.publication_epoch))return null;
        return Object.freeze({
          sourceId:row.source_id,countyFips:row.county_fips,
          sourceCacheEpoch:row.source_cache_epoch,
          publicationEpoch:row.publication_epoch,
        });
      } catch {
        return null;
      }
    },
  });
}
