import test from 'node:test';
import assert from 'node:assert/strict';
import { ratePreferenceEvidence } from './preferenceRating.js';
import { normalizeLandCriteria } from './session.js';

test('intended business use cannot be rated as legally allowed from county GIS data', () => {
  const profile = normalizeLandCriteria({
    county: 'Travis', purpose: 'Industrial / logistics',
    budgetMax: '1000000', zip: '78704', acresMin: '5',
  });
  const result = ratePreferenceEvidence(profile, {
    address: 'AUSTIN TX 78704', acresReported: 10,
  });
  assert.equal(result.label, 'Possible profile match');
  assert.equal(result.matched, 2);
  assert.equal(result.unknown, 2);
  assert.equal(result.fitScore, null);
  assert.equal(result.checked, 2);
  assert.equal(result.configured, 4);
});

test('zero source acres cannot be treated as a verified rejection', () => {
  const profile = normalizeLandCriteria({ county: 'Travis', acresMin: 1 });
  const result = ratePreferenceEvidence(profile, { acresReported: 0 });
  assert.equal(result.label, 'Not rated');
  assert.equal(result.unknown, 1);
  assert.equal(result.outside, 0);
});

test('source-reported mismatch remains provisional and supported by counts', () => {
  const profile = normalizeLandCriteria({ county: 'Bexar', zip: '78205', acresMin: 8 });
  const result = ratePreferenceEvidence(profile, {
    address: 'SOME ST SAN ANTONIO TX 78206', acresReported: 12,
  });
  assert.equal(result.label, 'Source-reported mismatch');
  assert.equal(result.outside, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.fitScore, null);
});

test('no profile means no rating', () => {
  assert.equal(ratePreferenceEvidence(null, {}).label, 'Not rated');
});
