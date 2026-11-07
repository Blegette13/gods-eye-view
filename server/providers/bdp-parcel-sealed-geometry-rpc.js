import { parseBoundedParcelPageRequest } from '../../src/bdp/ingestion/parcelPageContract.js';
import { buildPrivateSealedInitialRpcStatement, PRIVATE_SEALED_INITIAL_RPC_SQL } from '../../src/bdp/ingestion/parcelSealedInitialPagePlan.js';
import { PRIVATE_PARCEL_KEYSET_RPC_SQL } from '../../src/bdp/ingestion/parcelKeysetPagination.js';

/**
 * Steps 40C-33 / 40C-38 — UNROUTED pinned geometry-only fixed-RPC executor.
 *
 * A dedicated geometry-only login is asserted against an EXACT server-pinned
 * expected LOGIN on the same transaction as each RPC; never created here.
 * The separate geometry login must be denied SELECT/WRITE on base tables,
 * must not inherit metadata, source-authority, publication-review or old unsealed geometry functions, and may execute
 * ONLY reviewed sealed initial and keyset RPCs. A successful attestation is
 * NOT a substitute for DBA review or approval to redistribute geometry.
 * AbortSignal checks do not actively cancel in-flight node-postgres queries.
 */
export const PRIVATE_SEALED_GEOMETRY_MAX_BYTES = 2_200_000;
const TIMEOUT_MS = 1_200;
const SOURCE_ID = /^[a-z][a-z0-9_-]{2,79}$/;
const LOGIN = /^ldos_parcel_geometry_[a-z][a-z0-9_]{2,31}$/;
const PARCEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const BIGINT_MAX = 9223372036854775807n;
const ROW_KEYS = [
  'parcel_version_id', 'source_parcel_id', 'source_version',
  'source_geometry_sha256', 'ingest_run_id', 'source_id', 'county_fips',
  'geometry_vertices', 'geometry_memory_bytes', 'geometry',
];
const PROOF_KEYS = [
  'same_principal', 'safe_principal', 'no_schema_create',
  'no_source_table', 'no_run_table', 'no_seal_table',
  'no_parcel_table', 'no_coverage_table', 'no_rights_table',
  'sealed_initial_allowed', 'sealed_keyset_allowed',
  'unsealed_snapshot_denied', 'metadata_source_denied',
  'metadata_viewport_denied', 'sealed_authority_denied',
  'publication_review_denied',
  'exact_login', 'safe_login', 'no_role_memberships', 'schema_usage',
  'no_index_table_access', 'no_index_sequence_access', 'no_other_index_rpc',
];

/**
 * Read-only catalog privilege check in the SAME pinned transaction as the
 * geometry RPC. Missing tables/functions or revoked grants fail CLOSED.
 */
export const SEALED_GEOMETRY_ROLE_ATTESTATION_SQL = `
SELECT
  (current_user = session_user) AS same_principal,
  COALESCE((
    SELECT NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls)
    FROM pg_catalog.pg_roles AS r WHERE r.rolname = session_user
  ), FALSE) AS safe_principal,
  NOT pg_catalog.has_schema_privilege(session_user, 'bdp_parcel_index', 'CREATE') AS no_schema_create,
  NOT pg_catalog.has_table_privilege(session_user, 'bdp_parcel_index.source_registry',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_source_table,
  NOT pg_catalog.has_table_privilege(session_user, 'bdp_parcel_index.ingest_runs',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_run_table,
  NOT pg_catalog.has_table_privilege(session_user, 'bdp_parcel_index.parcel_run_seals',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_seal_table,
  NOT pg_catalog.has_table_privilege(session_user, 'bdp_parcel_index.parcel_versions',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_parcel_table,
  NOT pg_catalog.has_table_privilege(session_user, 'bdp_parcel_index.coverage_windows',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_coverage_table,
  NOT pg_catalog.has_table_privilege(session_user, 'bdp_parcel_index.geometry_publication_reviews',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_rights_table,
  pg_catalog.has_function_privilege(session_user,
    'bdp_parcel_index.parcel_geometry_sealed_initial_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer)',
    'EXECUTE') AS sealed_initial_allowed,
  pg_catalog.has_function_privilege(session_user,
    'bdp_parcel_index.parcel_geometry_keyset_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer,text,bigint)',
    'EXECUTE') AS sealed_keyset_allowed,
  NOT pg_catalog.has_function_privilege(session_user,
    'bdp_parcel_index.parcel_geometry_snapshot_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer)',
    'EXECUTE') AS unsealed_snapshot_denied,
  NOT pg_catalog.has_function_privilege(session_user,
    'bdp_parcel_index.approved_sources_rpc(text)',
    'EXECUTE') AS metadata_source_denied,
  NOT pg_catalog.has_function_privilege(session_user,
    'bdp_parcel_index.parcel_viewport_probe_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer)',
    'EXECUTE') AS metadata_viewport_denied,
  NOT pg_catalog.has_function_privilege(session_user,
    'bdp_parcel_index.parcel_sealed_source_authority_rpc(text)',
    'EXECUTE') AS sealed_authority_denied,
  NOT pg_catalog.has_function_privilege(session_user,
    'bdp_parcel_index.parcel_geometry_publication_review_rpc(text,text)',
    'EXECUTE') AS publication_review_denied,
  (current_user = session_user AND current_user = $1::text)
    AS exact_login,
  COALESCE((
    SELECT r.rolcanlogin AND NOT (
      r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
      OR r.rolreplication OR r.rolbypassrls OR r.rolinherit
    ) FROM pg_catalog.pg_roles AS r WHERE r.rolname = session_user
  ), FALSE) AS safe_login,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS m
    JOIN pg_catalog.pg_roles AS r ON r.oid = m.member
    WHERE r.rolname = session_user
  ) AS no_role_memberships,
  pg_catalog.has_schema_privilege(
    session_user, 'bdp_parcel_index', 'USAGE'
  ) AS schema_usage,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'bdp_parcel_index'
      AND c.relkind IN ('r','p','v','m','f')
      AND pg_catalog.has_table_privilege(session_user, c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) AS no_index_table_access,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'bdp_parcel_index'
      AND c.relkind = 'S'
      AND pg_catalog.has_sequence_privilege(
        session_user, c.oid, 'USAGE,SELECT,UPDATE')
  ) AS no_index_sequence_access,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'bdp_parcel_index'
      AND p.oid NOT IN (
        'bdp_parcel_index.parcel_geometry_sealed_initial_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer)'::regprocedure,
        'bdp_parcel_index.parcel_geometry_keyset_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer,text,bigint)'::regprocedure
      )
      AND pg_catalog.has_function_privilege(
        session_user, p.oid, 'EXECUTE')
  ) AS no_other_index_rpc
`.trim();

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
function positiveBigint(raw) {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,18}$/.test(raw)) return false;
  try { return BigInt(raw) <= BIGINT_MAX; } catch { return false; }
}
function sealedStatement(value) {
  if (!exact(value, ['text','values']) || !Object.isFrozen(value)
    || !Array.isArray(value.values) || !Object.isFrozen(value.values)) return null;
  const { text, values } = value;
  const continuation = text === PRIVATE_PARCEL_KEYSET_RPC_SQL;
  if (text !== PRIVATE_SEALED_INITIAL_RPC_SQL && !continuation) return null;
  if (values.length !== (continuation ? 10 : 8)
    || typeof values[1] !== 'string' || !SOURCE_ID.test(values[1])
    || !Number.isSafeInteger(values[2]) || values[2] <= 0
    || !Number.isSafeInteger(values[7])) return null;
  const plan = parseBoundedParcelPageRequest({
    countyFips: values[0],
    bounds: { west: values[3], south: values[4], east: values[5], north: values[6] },
    limit: values[7] - 1,
  });
  if (!plan) return null;
  const original = buildPrivateSealedInitialRpcStatement({
    plan, trustedSourceId: values[1], trustedRunId: values[2],
  });
  if (!original || !original.values.every((v,i) => Object.is(v,values[i]))) return null;
  if (continuation && (typeof values[8] !== 'string'
      || !PARCEL_ID.test(values[8]) || !positiveBigint(values[9]))) return null;
  return Object.freeze({ text, values: Object.freeze([...values]), maxRows: plan.probeLimit });
}
function validProof(value) {
  return value && Array.isArray(value.rows) && value.rows.length === 1
    && exact(value.rows[0], PROOF_KEYS)
    && PROOF_KEYS.every((key) => value.rows[0][key] === true);
}

/** Private rows stay in the server boundary. There is no public data return. */
export function createFixedSealedGeometryRpcReader(config = {}) {
  if (!exact(config, ['connect','expectedLogin'])
    || typeof config.connect !== 'function'
    || typeof config.expectedLogin !== 'string'
    || !LOGIN.test(config.expectedLogin)) {
    throw new TypeError('Pinned geometry-only connection and fixed expected LOGIN required');
  }
  const { connect, expectedLogin } = config;
  return Object.freeze({
    async querySealedRpc(input) {
      if (!exact(input, ['statement','signal'])
        || !(input.signal instanceof AbortSignal)) {
        throw new TypeError('Invalid private SQL operation');
      }
      const statement = sealedStatement(input.statement);
      if (!statement) throw new TypeError('Only fixed sealed geometry RPCs are permitted');
      if (input.signal.aborted) throw new Error('Private geometry read cancelled');

      let client;
      let inTransaction = false;
      let discard = false;
      try {
        client = await connect();
        if (!client || typeof client.query !== 'function'
          || typeof client.release !== 'function') {
          throw new Error('Invalid pinned client');
        }
        if (input.signal.aborted) throw new Error('Cancelled');
        await client.query('BEGIN TRANSACTION READ ONLY');
        inTransaction = true;
        await client.query('SET LOCAL statement_timeout = ' + TIMEOUT_MS);
        await client.query('SET LOCAL lock_timeout = 800');
        await client.query('SET LOCAL idle_in_transaction_session_timeout = 3000');
        if (input.signal.aborted
          || !validProof(await client.query(Object.freeze({
            text: SEALED_GEOMETRY_ROLE_ATTESTATION_SQL,
            values: Object.freeze([expectedLogin]),
          })))) {
          throw new Error('Geometry role not authorized');
        }

        if (input.signal.aborted) throw new Error('Cancelled');
        // One parameterized, allowlisted invocation — NEVER arbitrary SQL.
        const result = await client.query({
          text: statement.text, values: [...statement.values],
        });
        if (input.signal.aborted || !result || !Array.isArray(result.rows)
          || result.rows.length > statement.maxRows) {
          throw new Error('Invalid geometry result');
        }
        let bytes = 2;
        const rows = [];
        for (const row of result.rows) {
          if (!exact(row, ROW_KEYS)) throw new Error('Invalid geometry row');
          const json = JSON.stringify(row);
          if (typeof json !== 'string') throw new Error('Invalid geometry encoding');
          bytes += Buffer.byteLength(json, 'utf8') + 1;
          if (bytes > PRIVATE_SEALED_GEOMETRY_MAX_BYTES) {
            throw new Error('Private geometry result too large');
          }
          rows.push(Object.freeze(JSON.parse(json)));
        }
        if (input.signal.aborted) throw new Error('Cancelled');
        await client.query('COMMIT');
        inTransaction = false;
        return Object.freeze(rows);
      } catch {
        discard = true;
        if (inTransaction && client) {
          try { await client.query('ROLLBACK'); } catch { /* discard */ }
        }
        throw new Error('Private sealed geometry SQL unavailable');
      } finally {
        if (client && typeof client.release === 'function') {
          try { client.release(discard ? new Error('Discard geometry client') : undefined); }
          catch { /* never disclose connection details */ }
        }
      }
    },
  });
}
