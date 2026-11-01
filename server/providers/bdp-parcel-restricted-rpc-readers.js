import { APPROVED_PARCEL_SOURCE_SQL } from './bdp-parcel-source-resolver.js';
import { PARCEL_VIEWPORT_PROBE_SQL, buildParcelViewportProbeStatement } from '../../src/bdp/ingestion/parcelViewportReadPlan.js';
import { parseBoundedParcelPageRequest } from '../../src/bdp/ingestion/parcelPageContract.js';

/**
 * Step 40C-10: UNROUTED server-only bridge to Step 40C-9 restricted RPCs.
 *
 * This allows the already staged resolver + viewport metadata service to use
 * the restricted SQL functions rather than raw source_registry/parcel_versions.
 * No HTTP route, login, DB credentials, role memberships, ingestion, polygon
 * delivery, or source data rights are created here.
 *
 * connect MUST be a trusted, pinned pg client from an independently
 * authenticated pool whose database privileges are reviewed by a DBA.
 * The role from Step 40C-9 is NOLOGIN and must not be made browser-accessible.
 * No browser-controlled source, run, session, role, or SQL string is accepted.
 */

export const RESTRICTED_PARCEL_SOURCE_RPC_SQL =
  'SELECT * FROM bdp_parcel_index.approved_sources_rpc($1::text)';

export const RESTRICTED_PARCEL_VIEWPORT_RPC_SQL = `
SELECT * FROM bdp_parcel_index.parcel_viewport_probe_rpc(
  $1::text, $2::text, $3::bigint,
  $4::double precision, $5::double precision,
  $6::double precision, $7::double precision, $8::integer
)
`.trim();

export const RPC_MIN_TIMEOUT_MS = 100;
export const RPC_MAX_TIMEOUT_MS = 5_000;

const COUNTY = /^48[0-9]{3}$/;

function strictStatement(raw, count) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const proto = Object.getPrototypeOf(raw);
  return (proto === Object.prototype || proto === null)
    && Object.keys(raw).length === 2
    && Object.prototype.hasOwnProperty.call(raw, 'text')
    && Object.prototype.hasOwnProperty.call(raw, 'values')
    && Array.isArray(raw.values) && raw.values.length === count;
}

function sourceRpcStatement(original) {
  if (!strictStatement(original, 1)
    || original.text !== APPROVED_PARCEL_SOURCE_SQL
    || typeof original.values[0] !== 'string'
    || !COUNTY.test(original.values[0])) return null;
  return Object.freeze({
    text: RESTRICTED_PARCEL_SOURCE_RPC_SQL,
    values: Object.freeze([original.values[0]]),
  });
}

function viewportRpcStatement(original) {
  if (!strictStatement(original, 8)
    || original.text !== PARCEL_VIEWPORT_PROBE_SQL) return null;
  const values = original.values;
  const plan = parseBoundedParcelPageRequest({
    countyFips: values[0],
    bounds: { west: values[3], south: values[4], east: values[5], north: values[6] },
    limit: values[7] - 1,
  });
  if (!plan) return null;
  const regenerated = buildParcelViewportProbeStatement({
    plan,
    trustedSourceId: values[1],
    trustedRunId: values[2],
  });
  if (!regenerated || !regenerated.values.every((v, i) => Object.is(v, values[i]))) return null;
  return Object.freeze({
    text: RESTRICTED_PARCEL_VIEWPORT_RPC_SQL,
    values: Object.freeze([...regenerated.values]),
  });
}

/**
 * This transaction wrapper only runs the TWO fixed RPCs shown above.
 * PostgreSQL, not a JS timer, enforces statement_timeout. AbortSignal is
 * checked before/after driver operations; it does NOT actively cancel an
 * in-flight driver request. The future connection pool must bound acquisition.
 *
 * Rows remain server-only; caller does the final source/geometry budget,
 * session revocation, and "unknown" coverage checks.
 */
export function createRestrictedParcelRpcReaders({ connect } = {}) {
  if (typeof connect !== 'function') {
    throw new TypeError('Trusted pinned least-privilege PostgreSQL client required');
  }
  async function run(statement, { signal, statementTimeoutMs = 1_000 } = {}, maxRows) {
    if (!statement || !Number.isSafeInteger(statementTimeoutMs)
      || statementTimeoutMs < RPC_MIN_TIMEOUT_MS
      || statementTimeoutMs > RPC_MAX_TIMEOUT_MS
      || (signal !== undefined && !(signal instanceof AbortSignal))) {
      throw new TypeError('Invalid bounded parcel RPC request');
    }
    if (signal?.aborted) throw new Error('Parcel RPC cancelled');

    let client;
    let started = false;
    let discard = false;
    try {
      client = await connect();
      if (!client || typeof client.query !== 'function'
        || typeof client.release !== 'function') {
        throw new TypeError('A pinned PostgreSQL client with query/release is required');
      }
      if (signal?.aborted) throw new Error('Parcel RPC cancelled');

      await client.query('BEGIN TRANSACTION READ ONLY');
      started = true;
      await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
      await client.query(`SET LOCAL lock_timeout = ${Math.min(statementTimeoutMs, 1_000)}`);
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${Math.min(statementTimeoutMs * 2, 10_000)}`);
      if (signal?.aborted) throw new Error('Parcel RPC cancelled');

      const result = await client.query({ text: statement.text, values: [...statement.values] });
      if (signal?.aborted) throw new Error('Parcel RPC cancelled');
      if (!result || !Array.isArray(result.rows) || result.rows.length > maxRows) {
        throw new Error('Unbounded or invalid parcel RPC result');
      }
      await client.query('COMMIT');
      started = false;
      return Object.freeze({ rows: result.rows });
    } catch (error) {
      discard = true;
      if (started && client && typeof client.query === 'function') {
        try { await client.query('ROLLBACK'); } catch { /* evict client */ }
      }
      throw error;
    } finally {
      if (client && typeof client.release === 'function') {
        client.release(discard ? new Error('Parcel RPC transaction failed') : undefined);
      }
    }
  }

  return Object.freeze({
    readApprovedSources(original, options) {
      const rpc = sourceRpcStatement(original);
      return run(rpc, options, 2);
    },
    queryViewport(original, options) {
      const rpc = viewportRpcStatement(original);
      return run(rpc, options, 201);
    },
  });
}
