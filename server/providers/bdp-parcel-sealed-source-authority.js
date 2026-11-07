/**
 * Step 40C-34: UNROUTED, PRIVATE-ONLY sealed-source authority result contract.
 *
 * This is NOT a general SQL reader, production database connection, GIS
 * redistribution authorization, login/session resolver, or HTTP endpoint.
 * The injected queryFixedAuthorityRpc MUST be backed by a separately reviewed
 * pinned, least-privileged source-authority SQL role; never a DB owner or
 * the Step 40C-33 geometry role. Both PostgreSQL and JavaScript checks
 * must fail closed if there is no SINGLE current sealed approved source.
 *
 * Source caching rights alone are NOT geometry-redistribution rights.
 * The Step 40C-33 runtime still requires its INDEPENDENT legal publication
 * review; this adapter cannot and does not replace it.
 */
export const PRIVATE_SEALED_SOURCE_AUTHORITY_SQL =
  'SELECT * FROM bdp_parcel_index.parcel_sealed_source_authority_rpc($1::text)';

const COUNTY = /^48[0-9]{3}$/;
const SOURCE = /^[a-z][a-z0-9_-]{2,79}$/;
const ROW_KEYS = [
  'source_id', 'county_fips', 'rights_state',
  'approved_caching_until_ms', 'run_id', 'source_version',
  'sealed_at_ms', 'indexed_records', 'sealed_run',
];
const INPUT_KEYS = ['countyFips','signal'];
const MAX_PG_INT8 = 9223372036854775807n;

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
function safePgInt8(input, allowZero=false) {
  if (typeof input !== 'string'
    || !(allowZero ? /^(?:0|[1-9][0-9]{0,18})$/ : /^[1-9][0-9]{0,18}$/).test(input)) {
    return null;
  }
  try {
    const integer = BigInt(input);
    if (integer > MAX_PG_INT8 || (!allowZero && integer <= 0n)) return null;
    const number = Number(integer);
    return Number.isSafeInteger(number) && String(number) === input ? number : null;
  } catch {
    return null;
  }
}
function validRow(row, countyFips, nowMs) {
  if (!exact(row, ROW_KEYS)
    || typeof row.source_id !== 'string' || !SOURCE.test(row.source_id)
    || row.county_fips !== countyFips
    || row.rights_state !== 'approved'
    || !Number.isSafeInteger(row.approved_caching_until_ms)
    || row.approved_caching_until_ms <= nowMs
    || typeof row.source_version !== 'string'
    || row.source_version.trim().length < 1
    || row.source_version.length > 150
    || !Number.isSafeInteger(row.sealed_at_ms)
    || row.sealed_at_ms <= 0 || row.sealed_at_ms > nowMs
    || row.sealed_run !== true) return null;

  // node-postgres parses BIGINT as an exact decimal string by default.
  // Never silently round identifiers or the immutable indexed count.
  const runId = safePgInt8(row.run_id);
  const indexedRecords = safePgInt8(row.indexed_records,true);
  if (runId === null || indexedRecords === null) return null;
  return Object.freeze({
    sourceId:row.source_id, countyFips:row.county_fips,
    rightsState:'approved',
    approvedCachingUntilMs:row.approved_caching_until_ms,
    runId, sourceVersion:row.source_version,
    sealedAtMs:row.sealed_at_ms, indexedRecords, sealedRun:true,
  });
}

/**
 * queryFixedAuthorityRpc(statement) MUST internally enforce transaction
 * limits, least-privilege SQL EXECUTE-only role and no raw table access.
 * A fake callback returning approved values does not prove a real SQL seal.
 */
export function createPrivateSealedSourceAuthorityReader({
  queryFixedAuthorityRpc, now=Date.now,
}={}) {
  if (typeof queryFixedAuthorityRpc !== 'function' || typeof now !== 'function') {
    throw new TypeError('A separately trusted fixed authority RPC reader and clock are required');
  }
  return Object.freeze({
    async readSealedSource(input) {
      if (!exact(input, INPUT_KEYS) || typeof input.countyFips !== 'string'
        || !COUNTY.test(input.countyFips)
        || !(input.signal instanceof AbortSignal)
        || input.signal.aborted) return null;
      try {
        const statement = Object.freeze({
          text:PRIVATE_SEALED_SOURCE_AUTHORITY_SQL,
          values:Object.freeze([input.countyFips]),
          signal:input.signal,
        });
        const result = await queryFixedAuthorityRpc(statement);
        if (input.signal.aborted || !result || !Array.isArray(result.rows)
          // Two rows mean ambiguous county source authority: NEVER pick first.
          || result.rows.length !== 1) return null;
        const time = now();
        if (!Number.isSafeInteger(time) || time <= 0) return null;
        return validRow(result.rows[0],input.countyFips,time);
      } catch {
        // Never disclose database details, whether the county is licensed,
        // or whether a user/source/run exists to an untrusted caller.
        return null;
      }
    },
  });
}
