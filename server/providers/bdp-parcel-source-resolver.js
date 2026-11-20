/**
 * Step 40C-6: UNROUTED source/run resolver for the future metadata service.
 *
 * NOT an authenticator, public endpoint, database connector, county data
 * license, or declaration that the source has been copied into PostgreSQL.
 * verifyCountySession must consult a trusted ACTIVE, non-revoked server-side
 * session and per-county entitlement store; it must NEVER echo browser roles.
 * readApprovedSources must be a server-only bounded, parameterized DB reader.
 * No bulk parcel data, geometry, or ownership information is returned.
 */
export const MAX_RESOLVED_SOURCES = 2;
export const SOURCE_RESOLVER_TIMEOUT_MS = 1_000;

const FIPS = /^48[0-9]{3}$/;
const SOURCE_ID = /^[a-z][a-z0-9_-]{2,79}$/;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,119}$/;
const HANDLE = /^[A-Za-z0-9_-]{43}$/;

export const APPROVED_PARCEL_SOURCE_SQL = `
SELECT
  sr.source_id,
  sr.county_fips,
  sr.rights_state,
  FLOOR(EXTRACT(EPOCH FROM sr.approved_caching_until) * 1000)::double precision
    AS approved_caching_until_ms,
  run.id AS run_id
FROM bdp_parcel_index.source_registry AS sr
JOIN LATERAL (
  SELECT ir.id
  FROM bdp_parcel_index.ingest_runs AS ir
  WHERE ir.source_id = sr.source_id
    AND ir.finished_at IS NOT NULL
    AND ir.outcome IN ('complete', 'partial')
  ORDER BY ir.finished_at DESC, ir.id DESC
  LIMIT 1
) AS run ON true
WHERE sr.county_fips = $1::char(5)
  AND sr.rights_state = 'approved'
  AND sr.approved_caching_until > clock_timestamp()
ORDER BY sr.source_id COLLATE "C" ASC
LIMIT 2
`.trim();

function canonicalHandle(handle) {
  if (typeof handle !== 'string' || !HANDLE.test(handle)) return false;
  const bytes = Buffer.from(handle, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === handle;
}

function parseRunId(raw) {
  // node-postgres returns INT8 as a decimal string by default.
  if (typeof raw === 'string' && /^[1-9][0-9]*$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && String(parsed) === raw ? parsed : null;
  }
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}

function validSessionProof(proof, countyFips) {
  return proof && typeof proof === 'object' && !Array.isArray(proof)
    && proof.authenticated === true
    && proof.accountStatus === 'active'
    && proof.mfaVerified === true
    && proof.revokedAtMs === null
    && proof.countyFips === countyFips
    && proof.allowParcelDiscovery === true
    && typeof proof.subject === 'string' && SUBJECT.test(proof.subject);
}

function parseOneApprovedSource(rows, countyFips, nowMs) {
  // Never choose the first record if more than one source qualifies:
  // that would silently pick a potentially incompatible county dataset.
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const runId = parseRunId(row.run_id);
  const expiry = row.approved_caching_until_ms;
  if (typeof row.source_id !== 'string' || !SOURCE_ID.test(row.source_id)
    || row.county_fips !== countyFips
    || row.rights_state !== 'approved'
    || !Number.isSafeInteger(expiry) || expiry <= nowMs
    || runId === null) return null;
  return Object.freeze({
    sourceId: row.source_id,
    countyFips,
    rightsState: 'approved',
    approvedCachingUntilMs: expiry,
    runId,
  });
}

/**
 * Injected dependencies intentionally have distinct roles:
 * 1) verifyCountySession: real server-side identity + county access check.
 * 2) readApprovedSources: a fixed-query, least-privilege SQL reader.
 *
 * The metadata service re-invokes this resolver AFTER its viewport SQL,
 * denying access if source rights expire, the session is revoked, or the
 * source/run changes before returning even aggregate feature counts.
 */
export function createAuthorizedParcelSourceResolver({
  verifyCountySession,
  readApprovedSources,
  now = Date.now,
} = {}) {
  if (typeof verifyCountySession !== 'function'
    || typeof readApprovedSources !== 'function'
    || typeof now !== 'function') {
    throw new TypeError('Trusted county session verification and indexed source reader required');
  }
  return async function resolveAuthorizedSource({ sessionHandle, countyFips, signal } = {}) {
    if (!canonicalHandle(sessionHandle)
      || typeof countyFips !== 'string' || !FIPS.test(countyFips)
      || (signal !== undefined && !(signal instanceof AbortSignal))
      || signal?.aborted) return null;
    try {
      const proof = await verifyCountySession(Object.freeze({ sessionHandle, countyFips, signal }));
      if (signal?.aborted || !validSessionProof(proof, countyFips)) return null;
      const statement = Object.freeze({
        text: APPROVED_PARCEL_SOURCE_SQL,
        values: Object.freeze([countyFips]),
      });
      const result = await readApprovedSources(statement, Object.freeze({
        signal, statementTimeoutMs: SOURCE_RESOLVER_TIMEOUT_MS,
      }));
      if (signal?.aborted) return null;
      const currentTime = now();
      if (!Number.isSafeInteger(currentTime) || currentTime <= 0) return null;
      return parseOneApprovedSource(result?.rows, countyFips, currentTime);
    } catch {
      // Fail closed; do not leak session details, county permissions or SQL.
      return null;
    }
  };
}
