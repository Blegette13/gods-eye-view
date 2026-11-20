import { APPROVED_PARCEL_SOURCE_SQL } from './bdp-parcel-source-resolver.js';

/**
 * Step 40C-7 — UNROUTED, server-only approved-source registry reader.
 *
 * Complements the metadata probe adapter (40C-5): this one accepts ONLY the
 * fixed 40C-6 source lookup. It does not accept arbitrary SQL, credentials,
 * identity claims or run IDs from a browser. A future trusted integration must
 * provide a real server-side session authority and a pinned, minimally
 * privileged PostgreSQL connection; this module establishes neither.
 *
 * The SQL itself rechecks county-specific source rights and expiration.
 * Limits are enforced by PostgreSQL, not solely by a JS timeout.
 */
const COUNTY = /^48[0-9]{3}$/;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;

function validatedStatement(statement) {
  if (!statement || typeof statement !== 'object' || Array.isArray(statement)
    || statement.text !== APPROVED_PARCEL_SOURCE_SQL
    || !Array.isArray(statement.values) || statement.values.length !== 1
    || typeof statement.values[0] !== 'string'
    || !COUNTY.test(statement.values[0])
    || Object.keys(statement).length !== 2
    || !Object.prototype.hasOwnProperty.call(statement, 'text')
    || !Object.prototype.hasOwnProperty.call(statement, 'values')) return null;
  const prototype = Object.getPrototypeOf(statement);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return Object.freeze({
    text: APPROVED_PARCEL_SOURCE_SQL,
    values: Object.freeze([statement.values[0]]),
  });
}

/**
 * connect() must acquire an exclusive pinned client that implements:
 *   query(sqlOrConfig) and release(optionalError).
 * The caller must use a separate read-only database login, not a DB owner.
 * The driver/pool must independently enforce bounded connection acquisition.
 * AbortSignal is checked before/after network operations, but does not
 * promise instantaneous interruption of a running driver operation.
 */
export function createParcelPostgisSourceReader({ connect } = {}) {
  if (typeof connect !== 'function') {
    throw new TypeError('Trusted pinned PostgreSQL source connection is required');
  }

  return async function readApprovedSources(statement, {
    signal,
    statementTimeoutMs = 1_000,
  } = {}) {
    const approvedQuery = validatedStatement(statement);
    if (!approvedQuery
      || !Number.isSafeInteger(statementTimeoutMs)
      || statementTimeoutMs < MIN_TIMEOUT_MS || statementTimeoutMs > MAX_TIMEOUT_MS
      || (signal !== undefined && !(signal instanceof AbortSignal))) {
      throw new TypeError('Only a bounded, approved-source lookup is permitted');
    }
    if (signal?.aborted) throw new Error('Approved-source lookup cancelled');

    let client;
    let started = false;
    let discard = false;
    try {
      client = await connect();
      if (!client || typeof client.query !== 'function'
        || typeof client.release !== 'function') {
        throw new TypeError('Pinned PostgreSQL client must implement query/release');
      }
      if (signal?.aborted) throw new Error('Approved-source lookup cancelled');

      await client.query('BEGIN TRANSACTION READ ONLY');
      started = true;
      await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
      await client.query(`SET LOCAL lock_timeout = ${Math.min(statementTimeoutMs, 1_000)}`);
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${Math.min(statementTimeoutMs * 2, 10_000)}`);

      if (signal?.aborted) throw new Error('Approved-source lookup cancelled');
      const result = await client.query({
        text: approvedQuery.text,
        values: [...approvedQuery.values],
      });
      if (signal?.aborted) throw new Error('Approved-source lookup cancelled');
      if (!result || !Array.isArray(result.rows) || result.rows.length > 2) {
        throw new Error('Invalid bounded source registry result');
      }
      await client.query('COMMIT');
      started = false;
      return Object.freeze({ rows: result.rows });
    } catch (error) {
      discard = true;
      if (started && client && typeof client.query === 'function') {
        try { await client.query('ROLLBACK'); } catch { /* evict broken client */ }
      }
      throw error;
    } finally {
      if (client && typeof client.release === 'function') {
        client.release(discard ? new Error('Parcel source read transaction failed') : undefined);
      }
    }
  };
}
