import { parseBoundedParcelPageRequest } from '../../src/bdp/ingestion/parcelPageContract.js';
import { buildParcelViewportProbeStatement, PARCEL_VIEWPORT_PROBE_SQL } from '../../src/bdp/ingestion/parcelViewportReadPlan.js';

/**
 * Step 40C-5: UNROUTED PostGIS metadata-only transaction adapter.
 *
 * The provided connect() MUST obtain a pinned client from a trusted pool
 * using an independently provisioned, minimally privileged read-only role.
 * No credentials, roles, GIS data rights, HTTP endpoints, or session validation
 * are created by this module. Never provide a browser-supplied pool/connection.
 *
 * The adapter accepts ONLY the source-controlled parcel metadata query with
 * its exact eight bound values. This is not a general-purpose SQL runner.
 * Query timeout is enforced inside PostgreSQL using SET LOCAL; AbortSignal is
 * checked before/after driver work, not claimed to cancel an in-flight query.
 */
export const POSTGIS_MIN_TIMEOUT_MS = 100;
export const POSTGIS_MAX_TIMEOUT_MS = 5_000;

function validatedStatement(statement) {
  if (!statement || typeof statement !== 'object' || Array.isArray(statement)
    || statement.text !== PARCEL_VIEWPORT_PROBE_SQL
    || !Array.isArray(statement.values) || statement.values.length !== 8) return null;
  const values = statement.values;
  const plan = parseBoundedParcelPageRequest({
    countyFips: values[0],
    bounds: { west: values[3], south: values[4], east: values[5], north: values[6] },
    limit: values[7] - 1,
  });
  if (!plan) return null;
  const expected = buildParcelViewportProbeStatement({
    plan, trustedSourceId: values[1], trustedRunId: values[2],
  });
  if (!expected || !expected.values.every((v, i) => Object.is(v, values[i]))) return null;
  return Object.freeze({ text: PARCEL_VIEWPORT_PROBE_SQL, values: Object.freeze([...expected.values]) });
}

/**
 * connect() must yield {query(configOrText), release(err?)} and pin the client
 * until this function's finally block. Do not reuse that connection concurrently.
 * Failed/aborted transactions evict the client by passing an error to release.
 * The future HTTP integration must provide real identity, per-user limits,
 * connection pool timeouts and a least-privilege database role separately.
 */
export function createParcelPostgisReadAdapter({ connect } = {}) {
  if (typeof connect !== 'function') throw new TypeError('A trusted pinned PostgreSQL client factory is required');

  return async function parcelViewportMetadataQuery(statement, {
    signal,
    statementTimeoutMs = 2_000,
  } = {}) {
    const safe = validatedStatement(statement);
    if (!safe || !Number.isSafeInteger(statementTimeoutMs)
      || statementTimeoutMs < POSTGIS_MIN_TIMEOUT_MS
      || statementTimeoutMs > POSTGIS_MAX_TIMEOUT_MS
      || (signal !== undefined && !(signal instanceof AbortSignal))) {
      throw new TypeError('Invalid bounded PostGIS read request');
    }
    if (signal?.aborted) throw new Error('Parcel metadata read cancelled');

    let client;
    let transactionStarted = false;
    let discard = false;
    try {
      client = await connect();
      if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') {
        throw new TypeError('Pinned PostgreSQL connection must implement query/release');
      }
      if (signal?.aborted) throw new Error('Parcel metadata read cancelled');

      // Use the database engine's own statement and lock timeouts. A JS-only
      // Promise.race would leave potentially expensive SQL running on the DB.
      await client.query('BEGIN TRANSACTION READ ONLY');
      transactionStarted = true;
      await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
      await client.query(`SET LOCAL lock_timeout = ${Math.min(statementTimeoutMs, 1_000)}`);
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${Math.min(statementTimeoutMs * 2, 10_000)}`);
      if (signal?.aborted) throw new Error('Parcel metadata read cancelled');

      // Only the source-controlled bound query is ever passed to the driver.
      const result = await client.query({ text: safe.text, values: [...safe.values] });
      if (signal?.aborted) throw new Error('Parcel metadata read cancelled');
      if (!result || !Array.isArray(result.rows)) throw new Error('Invalid PostgreSQL query result');
      await client.query('COMMIT');
      transactionStarted = false;
      return { rows: result.rows };
    } catch (error) {
      discard = true;
      if (transactionStarted && client && typeof client.query === 'function') {
        try { await client.query('ROLLBACK'); } catch { /* evict damaged connection */ }
      }
      throw error;
    } finally {
      if (client && typeof client.release === 'function') {
        // pg.Pool clients accept an Error to evict broken/aborted connections.
        client.release(discard ? new Error('Parcel read transaction aborted') : undefined);
      }
    }
  };
}
