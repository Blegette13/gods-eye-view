import {PRIVATE_CURRENT_SEALED_RUN_EPOCH_SQL} from
  './bdp-parcel-current-sealed-run-epoch.js';

/**
 * Step 40C-45 — UNROUTED fixed current-run-epoch SQL executor.
 * No pool, credentials, role provisioning, HTTP route or public geometry.
 * Connect must independently pin a *separate* dedicated SQL login.
 */
export const PRIVATE_CURRENT_RUN_EPOCH_MAX_BYTES=4096;
export const PRIVATE_CURRENT_RUN_EPOCH_TIMEOUT_MS=1000;
const LOGIN=/^ldos_parcel_run_epoch_[a-z][a-z0-9_]{2,31}$/;
const COUNTY=/^48[0-9]{3}$/;
const SOURCE=/^[a-z][a-z0-9_-]{2,79}$/;
const ROW=['source_id','county_fips','run_id','epoch'];
const PROOF=['exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_index_table_access','no_index_sequence_access',
  'fixed_rpc_execute','no_other_index_rpc'];

export const PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL=`
SELECT
  (current_user=session_user AND current_user=$1::text) AS exact_login,
  COALESCE((
    SELECT r.rolcanlogin AND NOT (
      r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR
      r.rolreplication OR r.rolbypassrls OR r.rolinherit
    ) FROM pg_catalog.pg_roles r WHERE r.rolname=session_user
  ),FALSE) AS safe_login,
  NOT EXISTS(
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid=m.member
    WHERE r.rolname=session_user
  ) AS no_role_memberships,
  pg_catalog.has_schema_privilege(
    session_user,'bdp_parcel_index','USAGE') AS schema_usage,
  NOT pg_catalog.has_schema_privilege(
    session_user,'bdp_parcel_index','CREATE') AS no_schema_create,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='bdp_parcel_index'
      AND c.relkind IN ('r','p','v','m','f')
      AND pg_catalog.has_table_privilege(session_user,c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) AS no_index_table_access,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='bdp_parcel_index' AND c.relkind='S'
      AND pg_catalog.has_sequence_privilege(
        session_user,c.oid,'USAGE,SELECT,UPDATE')
  ) AS no_index_sequence_access,
  pg_catalog.has_function_privilege(session_user,
    'bdp_parcel_index.parcel_current_sealed_run_epoch_rpc(text,text,bigint)',
    'EXECUTE') AS fixed_rpc_execute,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='bdp_parcel_index'
      AND p.oid <> 
        'bdp_parcel_index.parcel_current_sealed_run_epoch_rpc(text,text,bigint)'::regprocedure
      AND pg_catalog.has_function_privilege(
        session_user,p.oid,'EXECUTE')
  ) AS no_other_index_rpc
`.trim();

function exact(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const p=Object.getPrototypeOf(value);
  return (p===Object.prototype||p===null)
    &&Object.keys(value).length===keys.length
    &&keys.every(k=>Object.hasOwn(value,k));
}
function allowed(s){
  return exact(s,['text','values','signal'])
    &&Object.isFrozen(s)
    &&s.text===PRIVATE_CURRENT_SEALED_RUN_EPOCH_SQL
    &&Array.isArray(s.values)&&Object.isFrozen(s.values)
    &&s.values.length===3
    &&typeof s.values[0]==='string'&&COUNTY.test(s.values[0])
    &&typeof s.values[1]==='string'&&SOURCE.test(s.values[1])
    &&typeof s.values[2]==='string'
    &&/^[1-9][0-9]{0,15}$/.test(s.values[2])
    &&Number.isSafeInteger(Number(s.values[2]))
    &&String(Number(s.values[2]))===s.values[2]
    &&s.signal instanceof AbortSignal;
}
function validProof(result){
  return result&&Array.isArray(result.rows)&&result.rows.length===1
    &&exact(result.rows[0],PROOF)
    &&PROOF.every(k=>result.rows[0][k]===true);
}
export function createPinnedPrivateCurrentRunEpochRpcExecutor(config={}){
  if(!exact(config,['connect','expectedLogin'])
    ||typeof config.connect!=='function'
    ||typeof config.expectedLogin!=='string'||!LOGIN.test(config.expectedLogin))
    throw new TypeError('Dedicated current-run epoch-only SQL login required');
  const {connect,expectedLogin}=config;
  return Object.freeze({
    async queryFixedCurrentRunEpochRpc(statement){
      if(!allowed(statement))throw new TypeError('Unexpected current-run epoch SQL');
      if(statement.signal.aborted)throw Error('Cancelled current-run epoch query');
      let client,started=false,discard=false;
      try{
        client=await connect();
        if(!client||typeof client.query!=='function'
          ||typeof client.release!=='function')throw Error('Invalid pinned client');
        if(statement.signal.aborted)throw Error('Cancelled');
        await client.query('BEGIN TRANSACTION READ ONLY');
        started=true;
        await client.query('SET LOCAL statement_timeout = '+PRIVATE_CURRENT_RUN_EPOCH_TIMEOUT_MS);
        await client.query('SET LOCAL lock_timeout = 500');
        await client.query('SET LOCAL idle_in_transaction_session_timeout = 2500');
        if(statement.signal.aborted)throw Error('Cancelled');
        const attested=await client.query(Object.freeze({
          text:PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL,
          values:Object.freeze([expectedLogin]),
        }));
        if(statement.signal.aborted||!validProof(attested))
          throw Error('Run epoch role attestation failed');
        const results=await client.query(Object.freeze({
          text:PRIVATE_CURRENT_SEALED_RUN_EPOCH_SQL,
          values:Object.freeze([...statement.values]),
        }));
        if(statement.signal.aborted||!results||!Array.isArray(results.rows)
          ||results.rows.length>1)throw Error('Run epoch SQL row count invalid');
        let bytes=2;
        const rows=[];
        for(const row of results.rows){
          if(!exact(row,ROW))throw Error('Unknown run epoch SQL field');
          const json=JSON.stringify(row);
          if(typeof json!=='string')throw Error('Malformed run epoch result');
          bytes+=Buffer.byteLength(json,'utf8')+1;
          if(bytes>PRIVATE_CURRENT_RUN_EPOCH_MAX_BYTES)
            throw Error('Oversized private run epoch SQL');
          rows.push(Object.freeze(JSON.parse(json)));
        }
        if(statement.signal.aborted)throw Error('Cancelled');
        await client.query('COMMIT');
        started=false;
        return Object.freeze({rows:Object.freeze(rows)});
      }catch{
        discard=true;
        if(started&&client){
          try{await client.query('ROLLBACK');}catch{/* discard */}
        }
        throw Error('Private current-run epoch unavailable');
      }finally{
        if(client&&typeof client.release==='function'){
          try{client.release(discard?new Error('Discard current-run epoch client'):undefined);}
          catch{/* never expose connection internals */}
        }
      }
    },
  });
}
