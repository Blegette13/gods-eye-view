import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PARCEL_PAGE_FEATURES,
  DEFAULT_PARCEL_PAGE_FEATURES,
  parseBoundedParcelPageRequest,
  checkTrustedParcelSource,
  classifyParcelMapPageCoverage,
} from './parcelPageContract.js';

const valid = () => ({
  countyFips: '48453',
  bounds: { west: -97.75, south: 30.25, east: -97.73, north: 30.27 },
});
const source = () => ({
  sourceId: 'travis-cad', countyFips: '48453', rightsState: 'approved',
  approvedCachingUntilMs: 2_000_000,
});

test('accepts only a narrow geographic request and reserves one overflow probe', () => {
  const page = parseBoundedParcelPageRequest(valid());
  assert.equal(page.countyFips, '48453');
  assert.deepEqual(page.bounds, valid().bounds);
  assert.equal(page.limit, DEFAULT_PARCEL_PAGE_FEATURES);
  assert.equal(page.probeLimit, DEFAULT_PARCEL_PAGE_FEATURES + 1);
  assert.ok(Object.isFrozen(page));
  assert.ok(Object.isFrozen(page.bounds));
  const capped = parseBoundedParcelPageRequest({ ...valid(), limit: MAX_PARCEL_PAGE_FEATURES });
  assert.equal(capped.probeLimit, MAX_PARCEL_PAGE_FEATURES + 1);
});

test('rejects user-supplied source, auth, cursor and coverage metadata', () => {
  for (const extra of [
    { sourceId: 'travis-cad' }, { role: 'admin' }, { authenticated: true },
    { rightsState: 'approved' }, { coverageState: 'complete' },
    { cursor: 'unsigned-token' }, { sql: 'SELECT *' }, { allCounties: true },
  ]) assert.equal(parseBoundedParcelPageRequest({ ...valid(), ...extra }), null);
});

test('rejects non-Texas or malformed county and nonnumeric/unbounded viewport', () => {
  const variants = [
    { ...valid(), countyFips: '4802' },
    { ...valid(), countyFips: '06037' },
    { ...valid(), countyFips: 48453 },
    { ...valid(), bounds: { ...valid().bounds, west: '-97.75' } },
    { ...valid(), bounds: { ...valid().bounds, north: Infinity } },
    { ...valid(), bounds: { ...valid().bounds, south: NaN } },
    { ...valid(), bounds: { ...valid().bounds, east: 180.1 } },
    { ...valid(), bounds: { ...valid().bounds, south: -91 } },
    { ...valid(), bounds: { west: 179.99, south: 30, east: -179.99, north: 30.01 } },
    { ...valid(), bounds: { west: -100, south: 30, east: -99.87, north: 30.01 } },
    { ...valid(), bounds: { west: -100, south: 30, east: -99.99, north: 30.13 } },
    { ...valid(), bounds: { ...valid().bounds, west: -97.73 } },
    { ...valid(), bounds: { ...valid().bounds, junk: 1 } },
    { ...valid(), bounds: { west: -97.7, south: 30.2, east: -97.6 } },
  ];
  for (const x of variants) assert.equal(parseBoundedParcelPageRequest(x), null);
});

test('rejects fractional, excessive, zero and string page size', () => {
  for (const limit of [0, 201, -1, 3.5, '100', NaN, Infinity, null]) {
    assert.equal(parseBoundedParcelPageRequest({ ...valid(), limit }), null);
  }
});

test('rights gate requires a trusted matching source with unexpired approval', () => {
  const plan = parseBoundedParcelPageRequest(valid());
  assert.equal(checkTrustedParcelSource({ plan, trustedSource: source(), nowMs: 1_000_000 }), true);
  for (const patch of [
    { countyFips: '48029' }, { rightsState: 'unreviewed' },
    { rightsState: 'revoked' }, { rightsState: 'restricted' },
    { approvedCachingUntilMs: 1_000_000 }, { approvedCachingUntilMs: null },
    { sourceId: '../../etc/passwd' },
  ]) assert.equal(checkTrustedParcelSource({ plan, trustedSource: { ...source(), ...patch }, nowMs: 1_000_000 }), false);
  assert.equal(checkTrustedParcelSource({
    plan: { ...plan, limit: 9_999, probeLimit: 10_000 }, trustedSource: source(), nowMs: 1_000_000,
  }), false);
  assert.equal(checkTrustedParcelSource({
    plan: { ...plan, bounds: { west: -100, south: 30, east: -99, north: 31 } },
    trustedSource: source(), nowMs: 1_000_000,
  }), false);
  assert.equal(checkTrustedParcelSource({ plan, trustedSource: source() }), false);
  assert.equal(checkTrustedParcelSource({ plan, trustedSource: source(), nowMs: -1 }), false);
});

test('classifies per-window coverage conservatively', () => {
  const complete = {
    providerState: 'complete', receivedRecords: 0,
    omittedUnidentified: 0, sourceTruncated: false, overflow: false,
  };
  assert.equal(classifyParcelMapPageCoverage(complete), 'complete');
  assert.equal(classifyParcelMapPageCoverage({ ...complete, overflow: true }), 'partial');
  assert.equal(classifyParcelMapPageCoverage({ ...complete, sourceTruncated: true }), 'unknown');
  assert.equal(classifyParcelMapPageCoverage({ ...complete, omittedUnidentified: 1 }), 'unknown');
  assert.equal(classifyParcelMapPageCoverage({ ...complete, receivedRecords: null }), 'unknown');
  assert.equal(classifyParcelMapPageCoverage({ ...complete, overflow: null }), 'unknown');
  assert.equal(classifyParcelMapPageCoverage({ ...complete, providerState: 'partial' }), 'partial');
  assert.equal(classifyParcelMapPageCoverage({ ...complete, providerState: 'unavailable' }), 'unavailable');
  assert.equal(classifyParcelMapPageCoverage({ ...complete, providerState: 'invalid' }), 'unknown');
  assert.equal(classifyParcelMapPageCoverage({ ...complete, providerState: 'unknown' }), 'unknown');
});
