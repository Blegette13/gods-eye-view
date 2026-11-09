import { PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL } from './bdp-parcel-policy-epoch-reader.js';

/**
 * Step 40C-41 — UNROUTED separate SQL LOGIN for the fixed epoch RPC.
 * Does NOT create a pool, DB role, API route, GIS license or release gate.
 * connect() must supply an independently audited, pinned PostgreSQL client.
 * Current application principals must NEVER be re-used for this role.
 */
export const PRIVATE_POLICY_EPOCH_MAX_BYTES=4096;
export const PRIVATE_POLICY_EPOCH_TIMEOUT_MS=1000;
const LOGIN=/^ldos_parcel_epoch_[a-z][a-z0-9_]{2,31}$/;
const COUNTY=/^48[0-9]{3}$/;
const SOURCE=/^[a-z][a-z0-9_-]{2,79}$/;
const FIELDS=['source_id','county_fips','source_cache_epoch','publication_epoch'];
const PROOF=['exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_index_table_access','no_index_sequence_access',
  'fixed_rpc_execute','no_other_index_rpc'];

export const PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL=`
SELECT
  (current_user = session_user AND current_user = $1::text)
    AS exact_login,
  COALESCE((
    SELECT r.rolcanlogin
       AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
                OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
    FROM pg_catalog.pg_roles r WHERE r.rolname = session_user
  ),FALSE) AS safe_login,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.member
    WHERE r.rolname = session_user
  ) AS no_role_memberships,
  pg_catalog.has_schema_privilege(
    session_user,'bdp_parcel_index','USAGE'
  ) AS schema_usage,
  NOT pg_catalog.has_schema_privilege(
    session_user,'bdp_parcel_index','CREATE'
  ) AS no_schema_create,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'bdp_parcel_index'
      AND c.relkind IN ('r','p','v','m','f')
      AND pg_catalog.has_table_privilege(
        session_user,c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) AS no_index_table_access,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'bdp_parcel_index' AND c.relkind = 'S'
      AND pg_catalog.has_sequence_privilege(
        session_user,c.oid,'USAGE,SELECT,UPDATE')
  ) AS no_index_sequence_access,
  pg_catalog.has_function_privilege(session_user,
    'bdp_parcel_index.parcel_policy_epoch_snapshot_rpc(text,text)',
    'EXECUTE') AS fixed_rpc_execute,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'bdp_parcel_index'
      AND p.oid <>
        'bdp_parcel_index.parcel_policy_epoch_snapshot_rpc(text,text)'::regprocedure
      AND pg_catalog.has_function_privilege(
        session_user,p.oid,'EXECUTE')
  ) AS no_other_index_rpc
`.trim();
function exact(value,keys) {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype||proto===null)
    &&Object.keys(value).length===keys.length
    &&keys.every(k=>Object.hasOwn(value,k));
}
function allowed(statement) {
  return exact(statement,['text','values','signal'])
    &&Object.isFrozen(statement)
    &&statement.text===PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL
    &&Array.isArray(statement.values)&&Object.isFrozen(statement.values)
    &&statement.values.length===2
    &&typeof statement.values[0]==='string'&&COUNTY.test(statement.values[0])
    &&typeof statement.values[1]==='string'&&SOURCE.test(statement.values[1])
    &&statement.signal instanceof AbortSignal;
}
function validAttestation(result) {
  return result&&Array.isArray(result.rows)&&result.rows.length===1
    &&exact(result.rows[0],PROOF)
    &&PROOF.every(k=>result.rows[0][k]===true);
}
export function createPinnedPrivatePolicyEpochRpcExecutor(config={}) {
  if(!exact(config,['connect','expectedLogin'])
    ||typeof config.connect!=='function'
    ||typeof config.expectedLogin!=='string'
    ||!LOGIN.test(config.expectedLogin)) {
    throw new TypeError('Separate fixed epoch-only SQL LOGIN required');
  }
  const {connect,expectedLogin}=config;
  return Object.freeze({
    async queryFixedEpochRpc(statement) {
      if(!allowed(statement))throw new TypeError('Invalid epoch SQL request');
      if(statement.signal.aborted)throw new Error('Epoch request cancelled');
      let client,started=false,discard=false;
      try {
        client=await connect();
        if(!client||typeof client.query!=='function'
          ||typeof client.release!=='function')throw new Error('Invalid pinned epoch client');
        if(statement.signal.aborted)throw new Error('Cancelled');
        await client.query('BEGIN TRANSACTION READ ONLY');
        started=true;
        await client.query('SET LOCAL statement_timeout = '+PRIVATE_POLICY_EPOCH_TIMEOUT_MS);
        await client.query('SET LOCAL lock_timeout = 500');
        await client.query('SET LOCAL idle_in_transaction_session_timeout = 2500');
        if(statement.signal.aborted)throw new Error('Cancelled');
        const attestation=await client.query(Object.freeze({
          text:PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL,
          values:Object.freeze([expectedLogin]),
        }));
        if(statement.signal.aborted||!validAttestation(attestation))
          throw new Error('Epoch role privilege proof failed');
        const result=await client.query(Object.freeze({
          text:PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL,
          values:Object.freeze([...statement.values]),
        }));
        if(statement.signal.aborted||!result||!Array.isArray(result.rows)
          ||result.rows.length>1)throw new Error('Invalid private epoch rows');
        let bytes=2;
        const rows=[];
        for(const row of result.rows) {
          if(!exact(row,FIELDS))throw new Error('Unexpected epoch columns');
          const json=JSON.stringify(row);
          if(typeof json!=='string')throw new Error('Invalid SQL epoch JSON');
          bytes+=Buffer.byteLength(json,'utf8')+1;
          if(bytes>PRIVATE_POLICY_EPOCH_MAX_BYTES)throw new Error('Oversize epoch SQL');
          rows.push(Object.freeze(JSON.parse(json)));
        }
        if(statement.signal.aborted)throw new Error('Cancelled');
        await client.query('COMMIT');
        started=false;
        return Object.freeze({rows:Object.freeze(rows)});
      }catch{
        discard=true;
        if(started&&client) {
          try{await client.query('ROLLBACK');}catch{/* discard */}
        }
        throw new Error('Private epoch lookup unavailable');
      }finally{
        if(client&&typeof client.release==='function') {
          try{client.release(discard?new Error('Discard epoch client'):undefined);}
          catch{/* no internal details */}
        }
      }
    },
  });
}
