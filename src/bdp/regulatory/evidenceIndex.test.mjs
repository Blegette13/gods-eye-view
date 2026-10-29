import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegulatoryEvidenceIndexSql,
  validateRegulatoryEvidenceIndexResult,
  validateRegulatoryLedgerScope,
} from './evidenceIndex.js';

const scope = { countyFips: '48453', parcelId: '302959' };

test('index query is scoped to one parcel and returns only minimum local metadata', () => {
  const sql = buildRegulatoryEvidenceIndexSql(scope);
  assert.match(sql, /WHERE county_fips = '48453' AND parcel_id = '302959'/);
  assert.match(sql, /LIMIT 50/);
  assert.match(sql, /ORDER BY recorded_at DESC, id DESC/);
  assert.match(sql, /'verificationState', verification_state/);
  assert.doesNotMatch(sql, /source_url\b|notes\b|entered_by\b/i);
  assert.doesNotMatch(sql, /DELETE\s|UPDATE\s|INSERT\s|TRUNCATE\s/i);
  assert.ok(sql.trim().startsWith('WITH scoped AS'));
  assert.equal(validateRegulatoryLedgerScope(scope).countyFips, '48453');
});

test('reject SQL delimiters, untrusted identifiers and unbounded page requests', () => {
  for (const countyFips of ["48453' OR true --", '4845', '06037', '48453;']) {
    assert.throws(() => buildRegulatoryEvidenceIndexSql({ ...scope, countyFips }));
  }
  for (const parcelId of ["302959';DELETE FROM x;--", '302959 WHERE 1=1', '', 'é']) {
    assert.throws(() => buildRegulatoryEvidenceIndexSql({ ...scope, parcelId }));
  }
  for (const limit of [0, 101, -1, 1.3, '50', Infinity]) {
    assert.throws(() => buildRegulatoryEvidenceIndexSql(scope, { limit }));
  }
  assert.match(buildRegulatoryEvidenceIndexSql(scope, { limit: 10 }), /LIMIT 10/);
});

test('empty local evidence index does not imply any reviewed task or legal clearance', () => {
  const result = validateRegulatoryEvidenceIndexResult({
    countyFips: '48453', parcelId: '302959',
    totalEvents: 0, returnedEvents: 0, truncated: false, events: [],
    verifiedTasks: 0, legalClearance: null, acquisitionRecommendation: null,
  }, scope);
  assert.equal(result.totalEvents, 0);
  assert.equal(result.verifiedTasks, 0);
  assert.equal(result.legalClearance, null);
  assert.equal(result.acquisitionRecommendation, null);
  assert.deepEqual(result.events, []);
});

test('events must be unverified and scoped to the originally requested county/parcel', () => {
  const result = {
    countyFips: '48453', parcelId: '302959',
    totalEvents: 2, returnedEvents: 1, truncated: true,
    events: [{ id: 7, taskId: 'verify-zoning-designation',
      verificationState: 'unverified', eventType: 'review-note',
      sourceDate: null, sourceTitle: null }],
    verifiedTasks: 0, legalClearance: null, acquisitionRecommendation: null,
  };
  const good = validateRegulatoryEvidenceIndexResult(result, scope);
  assert.equal(good.totalEvents, 2);
  assert.equal(good.truncated, true);
  assert.equal(good.events[0].verificationState, 'unverified');
  for (const change of [
    { countyFips: '48029' }, { parcelId: 'another' },
    { totalEvents: 0 }, { truncated: false }, { returnedEvents: 2 },
    { verifiedTasks: 1 }, { legalClearance: true }, { acquisitionRecommendation: 'BUY' },
    { events: [{ id: 7, taskId: 'verify-zoning-designation', verificationState: 'verified' }] },
  ]) {
    assert.throws(() => validateRegulatoryEvidenceIndexResult({ ...result, ...change }, scope),
      undefined, JSON.stringify(change));
  }
});
