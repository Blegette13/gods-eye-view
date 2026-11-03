import { PRIVATE_SEALED_SOURCE_AUTHORITY_SQL } from './bdp-parcel-sealed-source-authority.js';

/**
 * Step 40C-35 — UNROUTED, source-authority-only pinned pg execution.
 * This module DOES NOT create a pool, LOGIN, cookie transport, server, GIS
 * rights approval or migration. connect must yield an independently audited
 * authority-only PostgreSQL LOGIN, distinct from geometry and metadata users.
 *
 * A SQL SECURITY DEFINER function is not proof of authorization: the trusted
 * caller must authenticate and authorize the live county/session BEFORE and
 * AFTER reading, with separate geometry redistribution rights checks.
 *
 * Aborting a signal only blocks release of results; an in-flight pg command
 * is NOT actively cancelled by this adapter. The caller must separately
 * enforce bounded pool acquisition, cancellation and distributed quotas.
 */
export const SEALED_SOURCE_AUTHORITY_MAX_BYTES = 12_000;
export const SEALED_SOURCE_AUTHORITY_STATEMENT_TIMEOUT_MS = 1_000;
const LOGIN = /^ldos_parcel_authority_[a-z][a-z0-9_]{2,31}$/;
const COUNTY = /^48[0-9]{3}$/;
const ROW_KEYS = [
  'source_id', 'county_fips', 'rights_state',
  'approved_caching_until_ms', 'run_id', 'source_version',
  'sealed_at_ms', 'indexed_records', 'sealed_run',
];
const PROOF_KEYS = [
  'exact_login','safe_login','no_role_memberships',
  'schema_usage','no_schema_create','no_index_table_access',
  'no_index_sequence_access','fixed_rpc_execute','no_other_index_rpc',
];

/**
 * All identity checks run on the SAME pinned PostgreSQL connection, in the
 * SAME read-only transaction, immediately before the sole allowlisted RPC.
 *
 * Schema-wide checks reject any raw table/sequence privilege or extra RPC
 * permission, including permissions inherited through PUBLIC. This is more
 * restrictive than checking a hard-coded short list of parcel tables.
 * Function ownership, pg_hba, pg_default_acl, role administration and DBA
 * privilege escalation still require independent review.
 */
export const SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL = `
SELECT
  (current_user = session_user AND current_user = $1::text)
    AS exact_login,
  COALESCE((
    SELECT r.rolcanlogin
       AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
                OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
    FROM pg_catalog.pg_roles AS r
    WHERE r.rolname = session_user
  ), FALSE) AS safe_login,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS memberships
    JOIN pg_catalog.pg_roles AS r ON r.oid = memberships.member
    WHERE r.rolname = session_user
  ) AS no_role_memberships,
  pg_catalog.has_schema_privilege(
    session_user, 'bdp_parcel_index', 'USAGE'
  ) AS schema_usage,
  NOT pg_catalog.has_schema_privilege(
    session_user, 'bdp_parcel_index', 'CREATE'
  ) AS no_schema_create,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'bdp_parcel_index'
      AND relation.relkind IN ('r','p','v','m','f')
      AND pg_catalog.has_table_privilege(session_user, relation.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) AS no_index_table_access,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'bdp_parcel_index'
      AND relation.relkind = 'S'
      AND pg_catalog.has_sequence_privilege(session_user, relation.oid,
        'USAGE,SELECT,UPDATE')
  ) AS no_index_sequence_access,
  pg_catalog.has_function_privilege(
    session_user,
    'bdp_parcel_index.parcel_sealed_source_authority_rpc(text)',
    'EXECUTE'
  ) AS fixed_rpc_execute,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'bdp_parcel_index'
      AND routine.oid <>
        'bdp_parcel_index.parcel_sealed_source_authority_rpc(text)'::regprocedure
      AND pg_catalog.has_function_privilege(
        session_user, routine.oid, 'EXECUTE')
  ) AS no_other_index_rpc
`.trim();

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}
function validProof(result) {
  return result && Array.isArray(result.rows) && result.rows.length === 1
    && exact(result.rows[0], PROOF_KEYS)
    && PROOF_KEYS.every(key => result.rows[0][key] === true);
}
function allowedStatement(statement) {
  return exact(statement, ['text','values','signal'])
    && Object.isFrozen(statement)
    && statement.text === PRIVATE_SEALED_SOURCE_AUTHORITY_SQL
    && Array.isArray(statement.values)
    && Object.isFrozen(statement.values)
    && statement.values.length === 1
    && typeof statement.values[0] === 'string'
    && COUNTY.test(statement.values[0])
    && statement.signal instanceof AbortSignal;
}

export function createPinnedSealedSourceAuthorityRpcExecutor(config={}) {
  if (!exact(config, ['connect','expectedLogin'])
    || typeof config.connect !== 'function'
    || typeof config.expectedLogin !== 'string'
    || !LOGIN.test(config.expectedLogin)) {
    throw new TypeError('Trusted authority-only pg connection and fixed login required');
  }
  const { connect, expectedLogin } = config;
  return Object.freeze({
    async queryFixedAuthorityRpc(statement) {
      if (!allowedStatement(statement)) {
        throw new TypeError('Invalid fixed sealed-source authority RPC');
      }
      if (statement.signal.aborted) throw new Error('Private authority lookup cancelled');
      let client;
      let began = false;
      let discard = false;
      try {
        client = await connect();
        if (!client || typeof client.query !== 'function'
          || typeof client.release !== 'function') {
          throw new Error('Invalid pinned authority connection');
        }
        if (statement.signal.aborted) throw new Error('Authority lookup cancelled');
        await client.query('BEGIN TRANSACTION READ ONLY');
        began = true;
        await client.query(
          'SET LOCAL statement_timeout = ' +
          SEALED_SOURCE_AUTHORITY_STATEMENT_TIMEOUT_MS);
        await client.query('SET LOCAL lock_timeout = 500');
        await client.query('SET LOCAL idle_in_transaction_session_timeout = 2500');
        if (statement.signal.aborted) throw new Error('Authority lookup cancelled');
        const attested = await client.query(Object.freeze({
          text: SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL,
          values: Object.freeze([expectedLogin]),
        }));
        if (statement.signal.aborted || !validProof(attested)) {
          throw new Error('Authority role privilege attestation rejected');
        }
        const result = await client.query(Object.freeze({
          text: PRIVATE_SEALED_SOURCE_AUTHORITY_SQL,
          values: Object.freeze([...statement.values]),
        }));
        if (statement.signal.aborted || !result || !Array.isArray(result.rows)
          || result.rows.length > 2) throw new Error('Invalid authority response');

        let bytes = 2;
        const rows = [];
        for (const row of result.rows) {
          if (!exact(row,ROW_KEYS)) throw new Error('Unexpected authority SQL column');
          const json=JSON.stringify(row);
          if (typeof json !== 'string') throw new Error('Malformed authority SQL row');
          bytes+=Buffer.byteLength(json,'utf8')+1;
          if (bytes > SEALED_SOURCE_AUTHORITY_MAX_BYTES) {
            throw new Error('Oversized authority SQL rows');
          }
          rows.push(Object.freeze(JSON.parse(json)));
        }
        if (statement.signal.aborted) throw new Error('Authority lookup cancelled');
        await client.query('COMMIT');
        began=false;
        return Object.freeze({rows:Object.freeze(rows)});
      } catch {
        discard=true;
        if (began && client) {
          try { await client.query('ROLLBACK'); } catch { /* discard */ }
        }
        throw new Error('Private sealed-source authority unavailable');
      } finally {
        if (client && typeof client.release === 'function') {
          try { client.release(discard ? new Error('Discard authority client') : undefined); }
          catch { /* connection state never becomes a user response */ }
        }
      }
    },
  });
}
