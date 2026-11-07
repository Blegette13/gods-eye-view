import { PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL } from './bdp-parcel-geometry-publication-review.js';

/**
 * Step 40C-36 — UNROUTED, independent publication-review-only PostgreSQL
 * principal. Does not create a LOGIN/pool, migrate SQL or authorize geometry.
 * connect must be a pinned independently reviewed LOGIN distinct from
 * metadata, sealed-source authority, and geometry RPC roles.
 */
export const PUBLICATION_REVIEW_TIMEOUT_MS=1_000;
export const PUBLICATION_REVIEW_MAX_BYTES=12_000;
const LOGIN=/^ldos_parcel_publication_[a-z][a-z0-9_]{2,31}$/;
const COUNTY=/^48[0-9]{3}$/;
const SOURCE=/^[a-z][a-z0-9_-]{2,79}$/;
const FIELDS=['source_id','county_fips','review_state',
  'allow_geometry_redistribution','review_reference','reviewed_at_ms','expires_at_ms'];
const PROOF=['exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_index_table_access','no_index_sequence_access',
  'fixed_rpc_execute','no_other_index_rpc'];

export const GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL=`
SELECT
  (current_user = session_user AND current_user = $1::text)
    AS exact_login,
  COALESCE((
    SELECT r.rolcanlogin AND NOT (
      r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
      OR r.rolreplication OR r.rolbypassrls OR r.rolinherit
    ) FROM pg_catalog.pg_roles r WHERE r.rolname = session_user
  ),FALSE) AS safe_login,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.member
    WHERE r.rolname = session_user
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
    WHERE n.nspname='bdp_parcel_index'
      AND c.relkind='S'
      AND pg_catalog.has_sequence_privilege(session_user,c.oid,
        'USAGE,SELECT,UPDATE')
  ) AS no_index_sequence_access,
  pg_catalog.has_function_privilege(session_user,
    'bdp_parcel_index.parcel_geometry_publication_review_rpc(text,text)',
    'EXECUTE') AS fixed_rpc_execute,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='bdp_parcel_index'
      AND p.oid <>
        'bdp_parcel_index.parcel_geometry_publication_review_rpc(text,text)'::regprocedure
      AND pg_catalog.has_function_privilege(session_user,p.oid,'EXECUTE')
  ) AS no_other_index_rpc
`.trim();

function exact(x,fields) {
  if(!x||typeof x!=='object'||Array.isArray(x))return false;
  const p=Object.getPrototypeOf(x);
  return (p===Object.prototype||p===null)
    && Object.keys(x).length===fields.length
    && fields.every(f=>Object.hasOwn(x,f));
}
function inputAllowed(s) {
  return exact(s,['text','values','signal'])&&Object.isFrozen(s)
    &&s.text===PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL
    &&Array.isArray(s.values)&&Object.isFrozen(s.values)
    &&s.values.length===2
    &&typeof s.values[0]==='string'&&COUNTY.test(s.values[0])
    &&typeof s.values[1]==='string'&&SOURCE.test(s.values[1])
    &&s.signal instanceof AbortSignal;
}
function attested(r) {
  return r&&Array.isArray(r.rows)&&r.rows.length===1&&exact(r.rows[0],PROOF)
    &&PROOF.every(k=>r.rows[0][k]===true);
}
export function createPinnedGeometryPublicationReviewRpcExecutor(config={}) {
  if(!exact(config,['connect','expectedLogin'])
    ||typeof config.connect!=='function'
    ||typeof config.expectedLogin!=='string'
    ||!LOGIN.test(config.expectedLogin)) {
    throw new TypeError('Fixed separate publication-review LOGIN required');
  }
  const {connect,expectedLogin}=config;
  return Object.freeze({
    async queryFixedPublicationRpc(statement) {
      if(!inputAllowed(statement))throw new TypeError('Invalid publication SQL request');
      if(statement.signal.aborted)throw new Error('Publication read cancelled');
      let client,started=false,discard=false;
      try {
        client=await connect();
        if(!client||typeof client.query!=='function'
          ||typeof client.release!=='function')throw new Error('Invalid client');
        if(statement.signal.aborted)throw new Error('Cancelled');
        await client.query('BEGIN TRANSACTION READ ONLY');
        started=true;
        await client.query('SET LOCAL statement_timeout = '+PUBLICATION_REVIEW_TIMEOUT_MS);
        await client.query('SET LOCAL lock_timeout = 500');
        await client.query('SET LOCAL idle_in_transaction_session_timeout = 2500');
        if(statement.signal.aborted)throw new Error('Cancelled');
        const proof=await client.query(Object.freeze({
          text:GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL,
          values:Object.freeze([expectedLogin]),
        }));
        if(statement.signal.aborted||!attested(proof))throw new Error('Invalid role proof');
        const result=await client.query(Object.freeze({
          text:PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL,
          values:Object.freeze([...statement.values]),
        }));
        if(statement.signal.aborted||!result||!Array.isArray(result.rows)
          ||result.rows.length>1)throw new Error('Invalid publication SQL result');
        let bytes=2;
        const rows=[];
        for(const row of result.rows) {
          if(!exact(row,FIELDS))throw new Error('Wrong publication columns');
          const json=JSON.stringify(row);
          if(typeof json!=='string')throw new Error('Bad SQL JSON');
          bytes+=Buffer.byteLength(json,'utf8')+1;
          if(bytes>PUBLICATION_REVIEW_MAX_BYTES)throw new Error('Oversize');
          rows.push(Object.freeze(JSON.parse(json)));
        }
        if(statement.signal.aborted)throw new Error('Cancelled');
        await client.query('COMMIT');
        started=false;
        return Object.freeze({rows:Object.freeze(rows)});
      } catch {
        discard=true;
        if(started&&client) {
          try{await client.query('ROLLBACK');}catch{/* discard */}
        }
        throw new Error('Private publication review unavailable');
      } finally {
        if(client&&typeof client.release==='function') {
          try{client.release(discard?new Error('Discard publication client'):undefined);}
          catch{/* no client details */}
        }
      }
    },
  });
}
