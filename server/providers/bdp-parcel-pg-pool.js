/**
 * Step 40C-12: UNROUTED node-postgres Pool boundary for the metadata runtime.
 *
 * The caller injects the real "pg".Pool constructor (if separately installed)
 * and independent server-only settings. Importing this module does not open
 * the database, read environment variables, issue sessions, or enable HTTP.
 *
 * A NOLOGIN RPC role from 40C-9 cannot authenticate as a pool login. A DBA must
 * separately provision a narrowly privileged LOGIN principal with permission
 * to execute ONLY the two reviewed RPCs and no raw GIS table grants. Never
 * connect as the BDP database owner, "postgres", or an application superuser.
 *
 * This runtime attests the effective, non-elevated database principal at
 * EVERY checkout. It cannot replace a DBA review of memberships, PUBLIC
 * privileges, SECURITY DEFINER ownership, or source-use authorization.
 */

export const PARCEL_PG_POOL_MAX = 2;
export const PARCEL_PG_CONNECT_TIMEOUT_MS = 2_000;

const CONNECTION_KEYS = new Set([
  'host', 'port', 'database', 'user', 'password', 'ssl',
]);
const LOGIN = /^ldos_parcel_[a-z][a-z0-9_]{2,47}$/;
const DB_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * A fixed catalog query, executed on the pinned client BEFORE any RPC call.
 * Checks session AND effective role privilege, including inherited rights,
 * to avoid accidentally running as a database owner or a broad GIS reader.
 *
 * Output contains booleans only; never returns names, secrets, row data, or
 * the underlying source and parcel identifiers.
 */
export const PARCEL_PG_PRIVILEGE_ATTESTATION_SQL = [
  'SELECT',
  '  (current_user = session_user) AS same_principal,',
  '  COALESCE((SELECT NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole',
  '    OR r.rolbypassrls) FROM pg_catalog.pg_roles AS r',
  '    WHERE r.rolname = session_user), FALSE) AS safe_principal,',
  "  NOT pg_catalog.has_schema_privilege(session_user, 'bdp_parcel_index', 'CREATE') AS no_schema_create,",
  "  NOT pg_catalog.has_table_privilege(session_user, 'bdp_parcel_index.source_registry',",
  "    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_source_table_rights,",
  "  NOT pg_catalog.has_table_privilege(session_user, 'bdp_parcel_index.ingest_runs',",
  "    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_run_table_rights,",
  "  NOT pg_catalog.has_table_privilege(session_user, 'bdp_parcel_index.parcel_versions',",
  "    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_parcel_table_rights,",
  "  NOT pg_catalog.has_table_privilege(session_user, 'bdp_parcel_index.coverage_windows',",
  "    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_coverage_table_rights,",
  "  pg_catalog.has_function_privilege(session_user,",
  "    'bdp_parcel_index.approved_sources_rpc(text)', 'EXECUTE') AS source_rpc_allowed,",
  "  pg_catalog.has_function_privilege(session_user,",
  "    'bdp_parcel_index.parcel_viewport_probe_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer)',",
  "    'EXECUTE') AS viewport_rpc_allowed",
].join('\n');

const PROOF_KEYS = Object.freeze([
  'same_principal', 'safe_principal', 'no_schema_create',
  'no_source_table_rights', 'no_run_table_rights',
  'no_parcel_table_rights', 'no_coverage_table_rights',
  'source_rpc_allowed', 'viewport_rpc_allowed',
]);

function validSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  const proto = Object.getPrototypeOf(settings);
  if (proto !== Object.prototype && proto !== null
    || Object.keys(settings).length !== CONNECTION_KEYS.size
    || Object.keys(settings).some((key) => !CONNECTION_KEYS.has(key))) return false;

  if (typeof settings.host !== 'string' || settings.host.length < 1
    || settings.host.length > 253 || /\s|\/|\\|@/.test(settings.host)
    || !Number.isSafeInteger(settings.port)
    || settings.port < 1 || settings.port > 65535
    || typeof settings.database !== 'string' || !DB_NAME.test(settings.database)
    || typeof settings.user !== 'string' || !LOGIN.test(settings.user)
    || settings.user === 'ldos_parcel_rpc_client'
    || typeof settings.password !== 'string' || settings.password.length < 16) return false;

  const local = LOOPBACK.has(settings.host);
  if (local) return settings.ssl === false;

  // Remote PostgreSQL requires verified TLS and an explicit trusted CA chain
  // if the organization uses a private certificate authority.
  const ssl = settings.ssl;
  if (!ssl || typeof ssl !== 'object' || Array.isArray(ssl)
    || ssl.rejectUnauthorized !== true
    || Object.keys(ssl).some((key) => !['rejectUnauthorized', 'ca'].includes(key))
    || (ssl.ca !== undefined && (typeof ssl.ca !== 'string' || !ssl.ca.trim()))) return false;
  return true;
}

function validProof(queryResult) {
  return queryResult && Array.isArray(queryResult.rows)
    && queryResult.rows.length === 1 && queryResult.rows[0]
    && typeof queryResult.rows[0] === 'object'
    && PROOF_KEYS.every((key) => queryResult.rows[0][key] === true);
}

/**
 * This factory accepts the actual node-postgres Pool constructor or a
 * test-double with the same API; no dynamic import is done in the browser.
 * No package.json or database secrets are changed by this stage.
 *
 * The pg client stays pinned to its caller until the existing restricted
 * reader commits/rolls back and invokes client.release(error?). Closing the
 * connector must occur during server shutdown, not per parcel request.
 */
export function createParcelPgPoolConnector({ Pool, settings } = {}) {
  if (typeof Pool !== 'function' || !validSettings(settings)) {
    throw new TypeError('Trusted pg.Pool constructor and restricted DB settings required');
  }
  const local = LOOPBACK.has(settings.host);
  const pool = new Pool({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    ssl: local ? false : { ...settings.ssl },
    max: PARCEL_PG_POOL_MAX,
    min: 0,
    connectionTimeoutMillis: PARCEL_PG_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 10_000,
    statement_timeout: 2_000,
    idle_in_transaction_session_timeout: 4_000,
    allowExitOnIdle: true,
    application_name: 'ldos-parcel-metadata-staged',
  });
  if (!pool || typeof pool.connect !== 'function'
    || typeof pool.end !== 'function' || typeof pool.on !== 'function') {
    throw new TypeError('pg Pool must implement connect, end, and error event registration');
  }
  // An idle client error must be handled to avoid crashing the process.
  // The integration layer should attach its own sanitized monitoring, too.
  pool.on('error', () => { /* No SQL, credentials, or identifiers in logs. */ });

  let closed = false;
  return Object.freeze({
    async connect() {
      if (closed) throw new Error('Parcel metadata PostgreSQL pool is closed');
      let client;
      try {
        client = await pool.connect();
        if (!client || typeof client.query !== 'function'
          || typeof client.release !== 'function') {
          throw new Error('Invalid pinned PostgreSQL client');
        }
        const proof = await client.query(PARCEL_PG_PRIVILEGE_ATTESTATION_SQL);
        if (!validProof(proof) || closed) throw new Error('Restricted role attestation failed');
        return client;
      } catch {
        if (client && typeof client.release === 'function') {
          try { client.release(new Error('Restricted role attestation rejected')); }
          catch { /* Throw generic error below. */ }
        }
        // A raw pg error can contain host/user or query context; fail closed.
        throw new Error('Parcel metadata database connection or privilege check failed');
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  });
}
