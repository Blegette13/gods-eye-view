import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import { buildParcelViewportProbeStatement } from './parcelViewportReadPlan.js';

/**
 * Step 40C-23: UNROUTED, SERVER-ONLY signed keyset pagination contract.
 * The keyset RPC below is NOT deployed. Its future DBA-reviewed implementation
 * MUST reuse current source caching + independent redistribution rights checks.
 * Tokens only bind a *position* to session, county, run, extent and publication
 * revision. They are NEVER an authorization decision, complete coverage proof,
 * or a stable PostgreSQL MVCC snapshot across requests.
 *
 * Each new page will require live session/county entitlements, source rights,
 * publication rights, rate limits and post-query revocation checks.
 */
export const PRIVATE_PARCEL_KEYSET_RPC_SQL = [
  'SELECT * FROM bdp_parcel_index.parcel_geometry_keyset_rpc(',
  '$1::text,$2::text,$3::bigint,',
  '$4::double precision,$5::double precision,',
  '$6::double precision,$7::double precision,$8::integer,',
  '$9::text,$10::bigint)',
].join('');
export const MAX_PRIVATE_CURSOR_AGE_MS = 120_000;
export const MAX_PRIVATE_CURSOR_CHARS = 512;
const SOURCE_PARCEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_PG_BIGINT = 9223372036854775807n;
const CONTEXT_KEYS = ['plan','trustedSourceId','trustedRunId','sessionDigest','publicationRevision'];
const PLAN_KEYS = ['countyFips','bounds','limit','probeLimit'];
const PAGE_KEYS = ['status','featureCount','overflow','viewportCoverage','publishAuthorized'];
const TOKEN_KEYS = ['v','b','k','n','i','e'];

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value,key));
}
function pgId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) return null;
  try {
    const n = BigInt(value);
    return n <= MAX_PG_BIGINT && n.toString() === value ? value : null;
  } catch { return null; }
}
function trustedContext(input) {
  if (!exact(input,CONTEXT_KEYS) || !exact(input.plan,PLAN_KEYS)
    || typeof input.sessionDigest !== 'string' || !SHA256.test(input.sessionDigest)
    || typeof input.publicationRevision !== 'string' || !SHA256.test(input.publicationRevision)) {
    return null;
  }
  const plan = parseBoundedParcelPageRequest({
    countyFips: input.plan.countyFips,
    bounds: input.plan.bounds,
    limit: input.plan.limit,
  });
  if (!plan || plan.probeLimit !== input.plan.probeLimit) return null;
  const statement = buildParcelViewportProbeStatement({
    plan, trustedSourceId: input.trustedSourceId,
    trustedRunId: input.trustedRunId,
  });
  if (!statement) return null;
  const values = statement.values;
  // Include the server-provided session digest and reviewed policy revision.
  // These values are NOT serialized inside the continuation token.
  const fingerprint = createHash('sha256').update(JSON.stringify([
    'ldos-private-keyset-v1', ...values,
    input.sessionDigest, input.publicationRevision,
  ])).digest('hex');
  return { plan, values, fingerprint };
}
function rowKey(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || typeof row.source_parcel_id !== 'string'
    || !SOURCE_PARCEL_ID.test(row.source_parcel_id)) return null;
  const version = pgId(row.parcel_version_id);
  return version ? { key: row.source_parcel_id, version } : null;
}
function compare(a,b) {
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  const left = BigInt(a.version), right = BigInt(b.version);
  return left < right ? -1 : left > right ? 1 : 0;
}
function validTokenBody(body) {
  return exact(body,TOKEN_KEYS)
    && body.v === 1
    && typeof body.b === 'string' && SHA256.test(body.b)
    && typeof body.k === 'string' && SOURCE_PARCEL_ID.test(body.k)
    && pgId(body.n) !== null
    && Number.isSafeInteger(body.i) && body.i > 0
    && Number.isSafeInteger(body.e) && body.e > body.i
    && body.e - body.i <= MAX_PRIVATE_CURSOR_AGE_MS;
}

export function createPrivateParcelKeysetPagination({
  hmacKey, now = Date.now, ttlMs = 60_000,
} = {}) {
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length < 32
    || typeof now !== 'function'
    || !Number.isSafeInteger(ttlMs) || ttlMs < 1000
    || ttlMs > MAX_PRIVATE_CURSOR_AGE_MS) {
    throw new TypeError('Server-owned 32+ byte HMAC key and short bounded TTL are required');
  }
  const key = Buffer.from(hmacKey);
  const mac = (text) => createHmac('sha256', key)
    .update('ldos-private-keyset-v1\0').update(text).digest();

  /** Only mint after the independent *private* page validator succeeds. */
  function issueContinuation({ context, rows, validatedPage } = {}) {
    const trusted = trustedContext(context);
    if (!trusted || !validatedPage || typeof validatedPage !== 'object'
      || Array.isArray(validatedPage)
      || !PAGE_KEYS.every((field) => Object.hasOwn(validatedPage, field))
      || validatedPage.status !== 'validated-private'
      || validatedPage.publishAuthorized !== false
      || validatedPage.viewportCoverage !== 'unknown'
      || validatedPage.overflow !== true
      || validatedPage.featureCount !== trusted.plan.limit
      || !Array.isArray(rows) || rows.length !== trusted.plan.probeLimit) return null;

    let last = null;
    for (const row of rows) {
      const current = rowKey(row);
      if (!current || (last && compare(last,current) >= 0)) return null;
      last = current;
    }
    // Cursor starts AFTER the final accepted record; the overflow sentinel
    // is used only as proof another page exists, never as the cursor position.
    const position = rowKey(rows[trusted.plan.limit - 1]);
    if (!position || rows.at(-1).geometry !== null) return null;
    const issued = now();
    if (!Number.isSafeInteger(issued) || issued <= 0) return null;
    const payload = {
      v: 1, b: trusted.fingerprint, k: position.key, n: position.version,
      i: issued, e: issued + ttlMs,
    };
    if (!Number.isSafeInteger(payload.e)) return null;
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = body + '.' + mac(body).toString('base64url');
    return token.length <= MAX_PRIVATE_CURSOR_CHARS ? token : null;
  }

  /**
   * Returns a DRAFT fixed function call, never a result set or publication
   * permission. The keyset function does NOT exist in production. Before SQL
   * execution, the future service must verify CURRENT auth/rights separately.
   */
  function planContinuation({ context, token } = {}) {
    const trusted = trustedContext(context);
    if (!trusted || typeof token !== 'string'
      || token.length < 2 || token.length > MAX_PRIVATE_CURSOR_CHARS) return null;
    const parts = token.split('.');
    if (parts.length !== 2
      || !/^[A-Za-z0-9_-]+$/.test(parts[0])
      || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
    const supplied = Buffer.from(parts[1], 'base64url');
    if (supplied.length !== 32 || supplied.toString('base64url') !== parts[1]
      || !timingSafeEqual(supplied, mac(parts[0]))) return null;

    try {
      const decoded = Buffer.from(parts[0], 'base64url');
      if (decoded.toString('base64url') !== parts[0]) return null;
      const payload = JSON.parse(decoded.toString('utf8'));
      const current = now();
      if (!validTokenBody(payload) || payload.b !== trusted.fingerprint
        || !Number.isSafeInteger(current) || current < payload.i
        || current >= payload.e) return null;
      return Object.freeze({
        text: PRIVATE_PARCEL_KEYSET_RPC_SQL,
        values: Object.freeze([...trusted.values, payload.k, payload.n]),
        viewportCoverage: 'unknown',
        publishAuthorized: false,
      });
    } catch { return null; }
  }
  return Object.freeze({ issueContinuation, planContinuation });
}
