/**
 * Step 40C-47: strict UNROUTED PRIVATE interface to the synthetic
 * session/county grant revision table. This is NOT actual authentication.
 * Only the already-authoritative server HMAC step may supply a digest.
 */
export const PRIVATE_SESSION_COUNTY_EPOCH_SQL =
  'SELECT * FROM ldos_private_auth.parcel_session_county_epoch_rpc($1::text,$2::text)';
const DIGEST=/^[0-9a-f]{64}$/;
const COUNTY=/^48[0-9]{3}$/;
const EPOCH_MAX=9223372036854775807n;
const COLS=['session_digest','county_fips','epoch'];
function exact(value,cols){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const p=Object.getPrototypeOf(value);
  return (p===Object.prototype||p===null)
    &&Object.keys(value).length===cols.length
    &&cols.every(k=>Object.hasOwn(value,k));
}
function epochValid(epoch){
  if(typeof epoch!=='string'||!/^[1-9][0-9]{0,18}$/.test(epoch))return false;
  try{return BigInt(epoch)<=EPOCH_MAX;}catch{return false;}
}
export function isCanonicalPrivateSessionCountyEpoch(value){
  return exact(value,['sessionDigest','countyFips','epoch'])
    &&typeof value.sessionDigest==='string'&&DIGEST.test(value.sessionDigest)
    &&typeof value.countyFips==='string'&&COUNTY.test(value.countyFips)
    &&epochValid(value.epoch);
}
export function samePrivateSessionCountyEpoch(first,second){
  return isCanonicalPrivateSessionCountyEpoch(first)
    &&isCanonicalPrivateSessionCountyEpoch(second)
    &&first.sessionDigest===second.sessionDigest
    &&first.countyFips===second.countyFips
    &&first.epoch===second.epoch;
}
export function createPrivateSessionCountyEpochReader({queryFixedSessionCountyEpochRpc}={}){
  if(typeof queryFixedSessionCountyEpochRpc!=='function')
    throw new TypeError('Dedicated attested session/county epoch SQL reader required');
  return Object.freeze({
    async readSessionCountyEpoch(input){
      if(!exact(input,['sessionDigest','countyFips','signal'])
        ||typeof input.sessionDigest!=='string'||!DIGEST.test(input.sessionDigest)
        ||typeof input.countyFips!=='string'||!COUNTY.test(input.countyFips)
        ||!(input.signal instanceof AbortSignal)||input.signal.aborted)return null;
      try{
        const result=await queryFixedSessionCountyEpochRpc(Object.freeze({
          text:PRIVATE_SESSION_COUNTY_EPOCH_SQL,
          values:Object.freeze([input.sessionDigest,input.countyFips]),
          signal:input.signal,
        }));
        if(input.signal.aborted||!result||!Array.isArray(result.rows)
          ||result.rows.length!==1)return null;
        const row=result.rows[0];
        if(!exact(row,COLS)
          ||row.session_digest!==input.sessionDigest
          ||row.county_fips!==input.countyFips||!epochValid(row.epoch))
          return null;
        return Object.freeze({
          sessionDigest:row.session_digest,countyFips:row.county_fips,
          epoch:row.epoch,
        });
      }catch{return null;}
    },
  });
}
