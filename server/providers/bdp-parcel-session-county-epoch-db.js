import {PRIVATE_SESSION_COUNTY_EPOCH_SQL} from
  './bdp-parcel-session-county-epoch.js';

/**
 * 40C-47: fixed PRIVATE synthetic session-grant epoch RPC adapter.
 * No authorization by itself. Not an identity service, login/session
 * issuer, MFA validator, network endpoint or production DB connector.
 */
export const PRIVATE_SESSION_COUNTY_EPOCH_MAX_BYTES=1024;
export const PRIVATE_SESSION_COUNTY_EPOCH_TIMEOUT_MS=1000;
const LOGIN=/^ldos_parcel_session_epoch_[a-z][a-z0-9_]{2,31}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const COUNTY=/^48[0-9]{3}$/;
const ROW=['session_digest','county_fips','epoch'];
const PROOF=['exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_private_table_access','no_private_sequence_access',
  'fixed_rpc_execute','no_other_private_rpc'];

export const PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL=`
SELECT
  (current_user=session_user AND current_user=$1::text) AS exact_login,
  COALESCE((
    SELECT r.rolcanlogin AND NOT (
      r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR
      r.rolreplication OR r.rolbypassrls OR r.rolinherit
    ) FROM pg_catalog.pg_roles AS r WHERE r.rolname=session_user
  ),FALSE) AS safe_login,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS m
    JOIN pg_catalog.pg_roles AS r ON r.oid=m.member
    WHERE r.rolname=session_user
  ) AS no_role_memberships,
  pg_catalog.has_schema_privilege(
    session_user,'ldos_private_auth','USAGE') AS schema_usage,
  NOT pg_catalog.has_schema_privilege(
    session_user,'ldos_private_auth','CREATE') AS no_schema_create,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
    WHERE n.nspname='ldos_private_auth'
      AND c.relkind IN ('r','p','v','m','f')
      AND pg_catalog.has_table_privilege(session_user,c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) AS no_private_table_access,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
    WHERE n.nspname='ldos_private_auth' AND c.relkind='S'
      AND pg_catalog.has_sequence_privilege(
        session_user,c.oid,'USAGE,SELECT,UPDATE')
  ) AS no_private_sequence_access,
  pg_catalog.has_function_privilege(session_user,
    'ldos_private_auth.parcel_session_county_epoch_rpc(text,text)',
    'EXECUTE') AS fixed_rpc_execute,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
    WHERE n.nspname='ldos_private_auth'
      AND p.oid <>
        'ldos_private_auth.parcel_session_county_epoch_rpc(text,text)'::regprocedure
      AND pg_catalog.has_function_privilege(
        session_user,p.oid,'EXECUTE')
  ) AS no_other_private_rpc
`.trim();

function exact(value,cols){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const p=Object.getPrototypeOf(value);
  return (p===Object.prototype||p===null)
    &&Object.keys(value).length===cols.length
    &&cols.every(k=>Object.hasOwn(value,k));
}
function allowed(value){
  return exact(value,['text','values','signal'])
    &&Object.isFrozen(value)
    &&value.text===PRIVATE_SESSION_COUNTY_EPOCH_SQL
    &&Array.isArray(value.values)&&Object.isFrozen(value.values)
    &&value.values.length===2
    &&typeof value.values[0]==='string'&&DIGEST.test(value.values[0])
    &&typeof value.values[1]==='string'&&COUNTY.test(value.values[1])
    &&value.signal instanceof AbortSignal;
}
function validProof(value){
  return value&&Array.isArray(value.rows)&&value.rows.length===1
    &&exact(value.rows[0],PROOF)
    &&PROOF.every(k=>value.rows[0][k]===true);
}
export function createPinnedPrivateSessionCountyEpochRpcExecutor(config={}){
  if(!exact(config,['connect','expectedLogin'])
    ||typeof config.connect!=='function'
    ||typeof config.expectedLogin!=='string'
    ||!LOGIN.test(config.expectedLogin)) {
    throw new TypeError('Separate session/county epoch-only SQL LOGIN required');
  }
  const {connect,expectedLogin}=config;
  return Object.freeze({
    async queryFixedSessionCountyEpochRpc(statement){
      if(!allowed(statement))throw new TypeError('Unexpected session/county epoch SQL');
      if(statement.signal.aborted)throw Error('Cancelled session/county epoch query');
      let client,started=false,discard=false;
      try{
        client=await connect();
        if(!client||typeof client.query!=='function'
          ||typeof client.release!=='function')throw Error('Invalid pinned SQL client');
        if(statement.signal.aborted)throw Error('Cancelled');
        await client.query('BEGIN TRANSACTION READ ONLY');
        started=true;
        await client.query('SET LOCAL statement_timeout = '+PRIVATE_SESSION_COUNTY_EPOCH_TIMEOUT_MS);
        await client.query('SET LOCAL lock_timeout = 500');
        await client.query('SET LOCAL idle_in_transaction_session_timeout = 2500');
        if(statement.signal.aborted)throw Error('Cancelled');
        const attestation=await client.query(Object.freeze({
          text:PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL,
          values:Object.freeze([expectedLogin]),
        }));
        if(statement.signal.aborted||!validProof(attestation))
          throw Error('Session epoch role attestation failed');
        const rows=await client.query(Object.freeze({
          text:PRIVATE_SESSION_COUNTY_EPOCH_SQL,
          values:Object.freeze([...statement.values]),
        }));
        if(statement.signal.aborted||!rows||!Array.isArray(rows.rows)
          ||rows.rows.length>1)throw Error('Session epoch SQL row count invalid');
        const output=[];
        let bytes=2;
        for(const row of rows.rows){
          if(!exact(row,ROW))throw Error('Unexpected session epoch SQL column');
          const json=JSON.stringify(row);
          if(typeof json!=='string')throw Error('Malformed session epoch data');
          bytes+=Buffer.byteLength(json,'utf8')+1;
          if(bytes>PRIVATE_SESSION_COUNTY_EPOCH_MAX_BYTES)
            throw Error('Oversized session epoch SQL');
          output.push(Object.freeze(JSON.parse(json)));
        }
        if(statement.signal.aborted)throw Error('Cancelled');
        await client.query('COMMIT');
        started=false;
        return Object.freeze({rows:Object.freeze(output)});
      }catch{
        discard=true;
        if(started&&client){
          try{await client.query('ROLLBACK');}catch{/* discard */}
        }
        throw Error('Private session/county epoch unavailable');
      }finally{
        if(client&&typeof client.release==='function'){
          try{client.release(discard?new Error('Discard session epoch SQL client'):undefined);}
          catch{/* no DB details in response */}
        }
      }
    },
  });
}
