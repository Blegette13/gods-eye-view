import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import {
  EXACT_PARCEL_COVERAGE_SQL, MAX_COVERAGE_EVIDENCE_AGE_MS,
  buildExactParcelCoverageStatement, assessExactParcelCoverageEvidence,
} from './parcelExactCoverageEvidence.js';

const NOW = 1_000_000;
const request = () => parseBoundedParcelPageRequest({
  countyFips: '48453',
  bounds: { west: -97.76, south: 30.24, east: -97.73, north: 30.27 },
  limit: 2,
});
const source = () => ({
  sourceId: 'travis-cad', countyFips: '48453',
  rightsState: 'approved', approvedCachingUntilMs: NOW + 300_000,
});
const row = () => ({
  source_id: 'travis-cad', county_fips: '48453', ingest_run_id: '42',
  run_outcome: 'complete', coverage_state: 'complete',
  received_records: 2, omitted_unidentified: 0, source_truncated: false,
  observed_at_ms: NOW - 30_000, exact_window: true,
});
const args = () => ({
  plan: request(), trustedSource: source(),
  trustedRunId: 42, rows: [row()], pageOverflow: false, nowMs: NOW,
});
const unknown = {
  windowCoverage: 'unknown', viewportCoverage: 'unknown',
  completenessVerified: false, geometryDelivered: false,
};
const partial = {
  windowCoverage: 'partial', viewportCoverage: 'unknown',
  completenessVerified: false, geometryDelivered: false,
};

test('fixed source-window SQL binds validated county, source/run and exact WGS bounds only', () => {
  const statement = buildExactParcelCoverageStatement({
    plan: request(), trustedSourceId: 'travis-cad', trustedRunId: 42,
  });
  assert.ok(statement);
  assert.deepEqual(statement.values, ['48453', 'travis-cad', 42, -97.76, 30.24, -97.73, 30.27]);
  assert.equal(statement.text, EXACT_PARCEL_COVERAGE_SQL);
  assert.ok(Object.isFrozen(statement));
  assert.ok(Object.isFrozen(statement.values));
  assert.match(statement.text, /public\.ST_Equals\(/);
  assert.match(statement.text, /LIMIT 2$/);
  assert.match(statement.text, /sr\.rights_state = 'approved'/);
  assert.match(statement.text, /ir\.id = cw\.ingest_run_id/);
  assert.doesNotMatch(statement.text, /\b(?:INSERT|UPDATE|DELETE|COPY|GRANT|EXECUTE)\b/i);
});

test('forged SQL fragments and unbounded request are rejected before building query', () => {
  const good = request();
  for (const attempt of [
    { ...good, probeLimit: 200 },
    { ...good, countyFips: 'bad' },
    { ...good, bounds: { ...good.bounds, east: -97.2 } },
    { ...good, limit: 201 },
    null,
  ]) assert.equal(buildExactParcelCoverageStatement({
    plan: attempt, trustedSourceId: 'travis-cad', trustedRunId: 42,
  }), null);
  for (const sourceId of ["travis';DROP", 'travis cad', 'POSTGRES']) {
    assert.equal(buildExactParcelCoverageStatement({
      plan: good, trustedSourceId: sourceId, trustedRunId: 42,
    }), null);
  }
  assert.equal(buildExactParcelCoverageStatement({
    plan: good, trustedSourceId: 'travis-cad', trustedRunId: '42',
  }), null);
});

test('complete exact source window is never promoted to an entire viewport', () => {
  const result = assessExactParcelCoverageEvidence(args());
  assert.deepEqual(result, {
    windowCoverage: 'complete', viewportCoverage: 'unknown',
    completenessVerified: true, geometryDelivered: false,
  });
  assert.ok(Object.isFrozen(result));
});

test('a page overflow downgrades even a source-complete window to partial', () => {
  assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), pageOverflow: true,
  }), partial);
});

test('missing, duplicate or untrusted row shapes never establish complete coverage', () => {
  for (const rows of [
    null, [], [row(), row()],
    [{ ...row(), owner_name: 'untrusted' }],
    [{ ...row(), exact_window: 'true' }],
    [{ ...row(), exact_window: false }],
    [{ ...row(), observed_at_ms: '970000' }],
  ]) assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), rows,
  }), unknown);
});

test('county/source/run mismatch or bad source caching rights cannot assert coverage', () => {
  for (const change of [
    { source_id: 'other-cad' },
    { county_fips: '48029' },
    { ingest_run_id: '43' },
    { ingest_run_id: '9e2' },
    { ingest_run_id: '9007199254740993' },
  ]) assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), rows: [{ ...row(), ...change }],
  }), unknown);
  for (const change of [
    { rightsState: 'revoked' },
    { approvedCachingUntilMs: NOW },
    { countyFips: '48029' },
  ]) assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), trustedSource: { ...source(), ...change },
  }), unknown);
});

test('stale or future coverage evidence fails closed', () => {
  for (const observedAtMs of [
    NOW - MAX_COVERAGE_EVIDENCE_AGE_MS - 1,
    NOW + 1, 0, 1.2,
  ]) assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), rows: [{ ...row(), observed_at_ms: observedAtMs }],
  }), unknown);
  assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), maxEvidenceAgeMs: 100,
  }), unknown);
  assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), maxEvidenceAgeMs: 2 * MAX_COVERAGE_EVIDENCE_AGE_MS,
  }), unknown);
});

test('unidentified, truncated, incomplete run, and unknown counts cannot declare complete', () => {
  for (const change of [
    { run_outcome: 'partial' },
    { received_records: null },
    { received_records: -1 },
    { omitted_unidentified: null },
    { omitted_unidentified: 1 },
    { source_truncated: null },
    { source_truncated: true },
  ]) assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), rows: [{ ...row(), ...change }],
  }), unknown);
});

test('coverage state partial or explicitly unavailable is never reported as complete', () => {
  assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), rows: [{ ...row(), coverage_state: 'partial' }],
  }), partial);
  assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), rows: [{ ...row(), coverage_state: 'unknown' }],
  }), unknown);
  assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), rows: [{ ...row(), coverage_state: 'unavailable' }],
  }), {
    windowCoverage: 'unavailable', viewportCoverage: 'unknown',
    completenessVerified: false, geometryDelivered: false,
  });
});

test('zero source records can qualify only an exact complete source window, never a whole map', () => {
  const result = assessExactParcelCoverageEvidence({
    ...args(), rows: [{ ...row(), received_records: 0 }],
  });
  assert.equal(result.windowCoverage, 'complete');
  assert.equal(result.viewportCoverage, 'unknown');
  assert.equal(result.geometryDelivered, false);
});

test('browser-supplied coverage or unexpected source state cannot affect the fixed SQL', () => {
  const p = request();
  const requestWithClaims = { ...p, coverageState: 'complete' };
  assert.equal(buildExactParcelCoverageStatement({
    plan: requestWithClaims, trustedSourceId: 'travis-cad', trustedRunId: 42,
  })?.text, EXACT_PARCEL_COVERAGE_SQL);
  assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), rows: [{ ...row(), coverage_state: 'complete', exact_window: false }],
  }), unknown);
});

test('invalid input values, malformed timestamps and page flags remain unknown', () => {
  for (const value of [undefined, 0, 'false']) {
    assert.deepEqual(assessExactParcelCoverageEvidence({
      ...args(), pageOverflow: value,
    }), unknown);
  }
  assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), nowMs: Number.NaN,
  }), unknown);
  assert.deepEqual(assessExactParcelCoverageEvidence({
    ...args(), trustedRunId: 0,
  }), unknown);
});
