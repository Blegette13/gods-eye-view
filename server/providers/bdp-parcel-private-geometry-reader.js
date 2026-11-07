import { buildParcelGeometrySnapshotStatement } from '../../src/bdp/ingestion/parcelGeometrySnapshotPlan.js';

export const GEOMETRY_RPC_SQL = [
  'SELECT * FROM bdp_parcel_index.parcel_geometry_snapshot_rpc(',
  '$1::text,$2::text,$3::bigint,$4::double precision,',
  '$5::double precision,$6::double precision,$7::double precision,$8::integer)',
].join('');
export const MAX_PRIVATE_GEOMETRY_BYTES = 2_200_000;

const KEYS = ['plan', 'trustedSourceId', 'trustedRunId'];
const FIELDS = [
  'parcel_version_id', 'source_parcel_id', 'source_version',
  'source_geometry_sha256', 'ingest_run_id', 'source_id', 'county_fips',
  'geometry_vertices', 'geometry_memory_bytes', 'geometry',
];
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
function queryFor(request) {
  if (!exact(request, KEYS)) return null;
  const statement = buildParcelGeometrySnapshotStatement(request);
  if (!statement) return null;
  return { text: GEOMETRY_RPC_SQL, values: [...statement.values] };
}

/**
 * Step 40C-20: STAGED, UNROUTED internal geometry reader.
 * The injected connection must be an independently reviewed geometry-only
 * database principal, NEVER the metadata account or a database owner.
 * No routes, credentials, roles, grants, source rights or sessions are created.
 * Returned rows are private, not permission to publish map geometry.
 */
export function createPrivateParcelGeometryRpcReader({ connect } = {}) {
  if (typeof connect !== 'function') throw new TypeError('Pinned geometry-only client required');
  return Object.freeze({
    async readSnapshot(request, { signal, statementTimeoutMs = 1000 } = {}) {
      const statement = queryFor(request);
      if (!statement || !Number.isSafeInteger(statementTimeoutMs)
        || statementTimeoutMs < 100 || statementTimeoutMs > 3000
        || (signal !== undefined && !(signal instanceof AbortSignal))) {
        throw new TypeError('Invalid private geometry request');
      }
      if (signal?.aborted) throw new Error('Geometry read cancelled');
      let client;
      let transaction = false;
      let failed = false;
      try {
        client = await connect();
        if (!client || typeof client.query !== 'function'
          || typeof client.release !== 'function') throw new Error('Invalid client');
        if (signal?.aborted) throw new Error('Cancelled');
        await client.query('BEGIN TRANSACTION READ ONLY');
        transaction = true;
        await client.query('SET LOCAL statement_timeout = ' + statementTimeoutMs);
        await client.query('SET LOCAL lock_timeout = ' + Math.min(1000, statementTimeoutMs));
        await client.query('SET LOCAL idle_in_transaction_session_timeout = ' +
          Math.min(6000, statementTimeoutMs * 2));
        if (signal?.aborted) throw new Error('Cancelled');
        const result = await client.query(statement);
        if (signal?.aborted || !result || !Array.isArray(result.rows)
          || result.rows.length > statement.values[7]) throw new Error('Invalid result');
        let wireBytes = 2;
        const records = [];
        for (const row of result.rows) {
          if (!exact(row, FIELDS)) throw new Error('Invalid row');
          const json = JSON.stringify(row);
          if (typeof json !== 'string') throw new Error('Invalid data');
          wireBytes += Buffer.byteLength(json, 'utf8') + 1;
          if (wireBytes > MAX_PRIVATE_GEOMETRY_BYTES) throw new Error('Oversize data');
          records.push(JSON.parse(json));
        }
        if (records.length === statement.values[7]
          && records.at(-1).geometry !== null) throw new Error('Invalid overflow sentinel');
        if (signal?.aborted) throw new Error('Cancelled');
        await client.query('COMMIT');
        transaction = false;
        return Object.freeze({
          rows: Object.freeze(records),
          viewportCoverage: 'unknown',
          publishAuthorized: false,
        });
      } catch {
        failed = true;
        if (transaction) {
          try { await client.query('ROLLBACK'); } catch { /* discard client */ }
        }
        throw new Error('Private parcel geometry unavailable');
      } finally {
        if (client && typeof client.release === 'function') {
          try { client.release(failed ? new Error('Discard failed query') : undefined); }
          catch { /* close failure is not a parcel response */ }
        }
      }
    },
  });
}
