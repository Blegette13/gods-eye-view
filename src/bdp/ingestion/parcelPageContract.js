/**
 * Step 40C-1: UNROUTED, pure planning contract for bounded parcel map pages.
 *
 * This is NOT an HTTP endpoint, authorization system, PostGIS query, importer,
 * or approval to replicate county GIS. The server must independently verify a
 * trusted user/session and READ the source registry on each request. Never
 * accept source rights, source IDs, credentials or coverage claims from the UI.
 */

export const MAX_PARCEL_PAGE_FEATURES = 200;
export const DEFAULT_PARCEL_PAGE_FEATURES = 100;
// A single request must not silently become a countywide scan. Larger views
// must be broken into independently bounded, provenance-aware map windows.
export const MAX_PARCEL_BBOX_SPAN_DEGREES = 0.12;

const EXACT_REQUEST_FIELDS = new Set(['countyFips', 'bounds', 'limit']);
const EXACT_BOUNDS_FIELDS = new Set(['west', 'south', 'east', 'north']);
const FIPS = /^48\d{3}$/;
const SOURCE_ID = /^[a-z][a-z0-9_-]{2,79}$/;

function recordWithOnlyKeys(value, accepted) {
  return value !== null && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null)
    && Object.keys(value).every((key) => accepted.has(key));
}

/**
 * Parse only geographic discovery parameters; no user-controlled source,
 * SQL fragments, roles, coverage flags, cursor or storage directives.
 * An unimplemented pagination cursor is rejected, never silently ignored.
 * Returns null instead of running a query for a malformed/oversized viewport.
 */
export function parseBoundedParcelPageRequest(raw) {
  if (!recordWithOnlyKeys(raw, EXACT_REQUEST_FIELDS)
    || typeof raw.countyFips !== 'string' || !FIPS.test(raw.countyFips)
    || !recordWithOnlyKeys(raw.bounds, EXACT_BOUNDS_FIELDS)
    || EXACT_BOUNDS_FIELDS.size !== Object.keys(raw.bounds).length) return null;

  const { west, south, east, north } = raw.bounds;
  if (![west, south, east, north].every((value) => typeof value === 'number' && Number.isFinite(value))
    || west < -180 || east > 180 || south < -90 || north > 90
    || west >= east || south >= north
    || east - west > MAX_PARCEL_BBOX_SPAN_DEGREES
    || north - south > MAX_PARCEL_BBOX_SPAN_DEGREES) return null;

  const limit = raw.limit === undefined ? DEFAULT_PARCEL_PAGE_FEATURES : raw.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PARCEL_PAGE_FEATURES) return null;

  return Object.freeze({
    countyFips: raw.countyFips,
    bounds: Object.freeze({ west, south, east, north }),
    limit,
    // Query the extra record to discover overflow instead of silently slicing.
    probeLimit: limit + 1,
  });
}

/**
 * A preflight rights gate: trustedSource MUST come from a fresh, server-side
 * source_registry lookup, NOT HTTP request fields or a client cache. This is
 * not a substitute for auth, DB least privilege, or a SQL rights check at
 * read time (approval can be revoked after this function returns).
 */
export function checkTrustedParcelSource({ plan, trustedSource, nowMs } = {}) {
  const validatedPlan = plan && parseBoundedParcelPageRequest({
    countyFips: plan.countyFips, bounds: plan.bounds, limit: plan.limit,
  });
  if (!validatedPlan || plan.probeLimit !== validatedPlan.probeLimit
    || !trustedSource || typeof trustedSource !== 'object'
    || typeof trustedSource.sourceId !== 'string' || !SOURCE_ID.test(trustedSource.sourceId)
    || trustedSource.countyFips !== plan.countyFips
    || trustedSource.rightsState !== 'approved'
    || !Number.isSafeInteger(nowMs) || nowMs <= 0
    || !Number.isSafeInteger(trustedSource.approvedCachingUntilMs)
    || trustedSource.approvedCachingUntilMs <= nowMs) return false;
  return true;
}

/**
 * Coverage of a *single queried window*, not the user's whole viewport.
 * A complete source response may still exceed a page limit. A partial or
 * uncertain response is never promoted to complete because records exist.
 */
export function classifyParcelMapPageCoverage({
  providerState = 'unknown',
  receivedRecords = null,
  omittedUnidentified = null,
  sourceTruncated = null,
  overflow = null,
} = {}) {
  if (!['unknown', 'partial', 'complete', 'unavailable'].includes(providerState)) return 'unknown';
  if (providerState === 'unavailable') return 'unavailable';
  if (providerState === 'unknown') return 'unknown';
  if (providerState === 'partial') return 'partial';
  // A source completeness claim is not enough: demand positive evidence for
  // record count, identifiable IDs, provider non-truncation and page cap.
  if (!Number.isSafeInteger(receivedRecords) || receivedRecords < 0
    || omittedUnidentified !== 0 || sourceTruncated !== false
    || typeof overflow !== 'boolean') return 'unknown';
  return overflow ? 'partial' : 'complete';
}
