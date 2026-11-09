import {
  parseBoundedParcelPageRequest,
  checkTrustedParcelSource,
} from './parcelPageContract.js';
import { buildParcelViewportProbeStatement } from './parcelViewportReadPlan.js';

/**
 * Step 40C-22: UNROUTED exact-source-window coverage evidence.
 *
 * Only a provenance-matched, fresh, nontruncated coverage_windows record
 * can qualify a single *exact* bounded source request. A group of overlapping
 * cached windows is NOT proof of complete viewport coverage.
 *
 * This does not create a connection, attach to Cesium, import county data,
 * prove property ownership or grant parcel geometry redistribution.
 * A future server integration must authorize session, source/run, publication
 * policy and quota BOTH before and after its database work.
 */
export const MAX_COVERAGE_EVIDENCE_AGE_MS = 60 * 60 * 1000;

export const EXACT_PARCEL_COVERAGE_SQL = `
SELECT
  cw.source_id,
  cw.county_fips::text AS county_fips,
  cw.ingest_run_id,
  ir.outcome AS run_outcome,
  cw.coverage_state,
  cw.received_records,
  cw.omitted_unidentified,
  cw.source_truncated,
  FLOOR(EXTRACT(EPOCH FROM cw.observed_at) * 1000)::double precision AS observed_at_ms,
  public.ST_Equals(
    cw.window_geometry,
    public.ST_MakeEnvelope(
      $4::double precision, $5::double precision,
      $6::double precision, $7::double precision, 4326
    )
  ) AS exact_window
FROM bdp_parcel_index.coverage_windows AS cw
JOIN bdp_parcel_index.ingest_runs AS ir
  ON ir.id = cw.ingest_run_id
  AND ir.source_id = cw.source_id
JOIN bdp_parcel_index.source_registry AS sr
  ON sr.source_id = cw.source_id
  AND sr.county_fips = cw.county_fips
WHERE cw.county_fips = $1::char(5)
  AND cw.source_id = $2::text
  AND cw.ingest_run_id = $3::bigint
  AND sr.rights_state = 'approved'
  AND sr.approved_caching_until > pg_catalog.clock_timestamp()
  AND ir.finished_at IS NOT NULL
  AND ir.outcome IN ('complete', 'partial')
  AND $4::double precision >= -180
  AND $6::double precision <= 180
  AND $5::double precision >= -90
  AND $7::double precision <= 90
  AND $4::double precision < $6::double precision
  AND $5::double precision < $7::double precision
  AND ($6::double precision - $4::double precision) <= 0.12
  AND ($7::double precision - $5::double precision) <= 0.12
  AND public.ST_Equals(
    cw.window_geometry,
    public.ST_MakeEnvelope(
      $4::double precision, $5::double precision,
      $6::double precision, $7::double precision, 4326
    )
  )
ORDER BY cw.observed_at DESC, cw.id DESC
LIMIT 2
`.trim();

const ROW_FIELDS = Object.freeze([
  'source_id', 'county_fips', 'ingest_run_id', 'run_outcome',
  'coverage_state', 'received_records', 'omitted_unidentified',
  'source_truncated', 'observed_at_ms', 'exact_window',
]);
const UNKNOWN = Object.freeze({
  windowCoverage: 'unknown', viewportCoverage: 'unknown',
  completenessVerified: false, geometryDelivered: false,
});
const PARTIAL = Object.freeze({
  windowCoverage: 'partial', viewportCoverage: 'unknown',
  completenessVerified: false, geometryDelivered: false,
});
const UNAVAILABLE = Object.freeze({
  windowCoverage: 'unavailable', viewportCoverage: 'unknown',
  completenessVerified: false, geometryDelivered: false,
});
const COMPLETE_WINDOW = Object.freeze({
  windowCoverage: 'complete', viewportCoverage: 'unknown',
  completenessVerified: true, geometryDelivered: false,
});

function exactRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null)
    && Object.keys(value).length === ROW_FIELDS.length
    && ROW_FIELDS.every((field) => Object.hasOwn(value, field));
}

function runId(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && String(number) === value ? number : null;
}

function validPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  const proto = Object.getPrototypeOf(plan);
  if ((proto !== Object.prototype && proto !== null)
    || Object.keys(plan).length !== 4
    || !['countyFips', 'bounds', 'limit', 'probeLimit']
      .every((key) => Object.hasOwn(plan, key))) return null;
  const checked = parseBoundedParcelPageRequest({
    countyFips: plan.countyFips, bounds: plan.bounds, limit: plan.limit,
  });
  return checked && checked.probeLimit === plan.probeLimit ? checked : null;
}

/** Only trusted server parameters; no provider/rights/coverage from browser. */
export function buildExactParcelCoverageStatement({
  plan, trustedSourceId, trustedRunId,
} = {}) {
  const checked = validPlan(plan);
  if (!checked) return null;
  const probe = buildParcelViewportProbeStatement({
    plan: checked, trustedSourceId, trustedRunId,
  });
  if (!probe) return null;
  return Object.freeze({
    text: EXACT_PARCEL_COVERAGE_SQL,
    values: Object.freeze(probe.values.slice(0, 7)),
  });
}

/**
 * Rows must originate from the fixed query, not from browser-supplied claims.
 * A complete window proves only this exact fresh source window had known
 * nontruncated source evidence AND the page did not overflow.
 *
 * Viewport coverage is ALWAYS unknown until independent multi-window
 * completeness/continuity analysis is built and verified.
 */
export function assessExactParcelCoverageEvidence({
  plan, trustedSource, trustedRunId, rows, pageOverflow,
  nowMs, maxEvidenceAgeMs = MAX_COVERAGE_EVIDENCE_AGE_MS,
} = {}) {
  const checked = validPlan(plan);
  if (!checked || !checkTrustedParcelSource({
    plan: checked, trustedSource, nowMs,
  }) || runId(trustedRunId) === null
    || !Number.isSafeInteger(maxEvidenceAgeMs)
    || maxEvidenceAgeMs < 1 || maxEvidenceAgeMs > MAX_COVERAGE_EVIDENCE_AGE_MS
    || typeof pageOverflow !== 'boolean'
    || !Array.isArray(rows) || rows.length !== 1
    || !exactRow(rows[0])) return UNKNOWN;

  const row = rows[0];
  if (row.source_id !== trustedSource.sourceId
    || row.county_fips !== checked.countyFips
    || runId(row.ingest_run_id) !== runId(trustedRunId)
    || row.exact_window !== true
    || !Number.isSafeInteger(row.observed_at_ms)
    || row.observed_at_ms <= 0 || row.observed_at_ms > nowMs
    || nowMs - row.observed_at_ms > maxEvidenceAgeMs
    || row.observed_at_ms >= trustedSource.approvedCachingUntilMs
    || !['complete', 'partial'].includes(row.run_outcome)
    || !['complete', 'partial', 'unknown', 'unavailable'].includes(row.coverage_state)) {
    return UNKNOWN;
  }
  if (row.coverage_state === 'unavailable') return UNAVAILABLE;
  if (row.coverage_state !== 'complete') {
    return row.coverage_state === 'partial' ? PARTIAL : UNKNOWN;
  }
  if (row.run_outcome !== 'complete'
    || !Number.isSafeInteger(row.received_records) || row.received_records < 0
    || row.omitted_unidentified !== 0
    || row.source_truncated !== false) return UNKNOWN;
  return pageOverflow ? PARTIAL : COMPLETE_WINDOW;
}
