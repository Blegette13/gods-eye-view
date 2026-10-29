import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewReportedValuation, VALUATION_REVIEW_NOTICE } from './valuationReview.js';

test('flags the live-inspection pattern of source land + improvement figures exceeding reported value', () => {
  const input = Object.freeze({
    landValue: 1198206,
    improvementValue: 95897,
    marketValue: 695000,
  });
  const review = reviewReportedValuation(input);
  assert.equal(review.status, 'review-required');
  assert.deepEqual(review.flags, ['land-exceeds-reported', 'components-exceed-reported']);
  assert.equal(input.landValue, 1198206);
  assert.equal(input.improvementValue, 95897);
  assert.equal(input.marketValue, 695000);
  assert.match(VALUATION_REVIEW_NOTICE, /confirm current values directly/);
  assert.doesNotMatch(VALUATION_REVIEW_NOTICE, /fraud|incorrect|approved|fair market value/i);
});

test('does not create a reassuring verdict for missing, blank, invalid or negative source figures', () => {
  for (const input of [
    null, {}, { marketValue: null, landValue: 100 },
    { marketValue: '', improvementValue: 0 },
    { marketValue: Number.NaN, landValue: 42 },
    { marketValue: -5, landValue: 100 },
    { marketValue: 500, improvementValue: -200 },
  ]) assert.equal(reviewReportedValuation(input).status, 'insufficient-evidence');
});

test('small differences or component values below a reported total are not flagged as proven reconciliation', () => {
  for (const value of [
    { marketValue: 100000, landValue: 60000, improvementValue: 40000 },
    { marketValue: 100000, landValue: 60000, improvementValue: 41499 },
    { marketValue: 100000, landValue: null, improvementValue: 30000 },
    { marketValue: 0, landValue: 0, improvementValue: 0 },
  ]) {
    const review = reviewReportedValuation(value);
    assert.equal(review.status, 'not-indicated');
    assert.deepEqual(review.flags, []);
  }
});

test('flags individual nonland component excess without inventing absent components', () => {
  const review = reviewReportedValuation({
    marketValue: 100000, improvementValue: 200000, landValue: null,
  });
  assert.equal(review.status, 'review-required');
  assert.deepEqual(review.flags, ['improvements-exceed-reported']);
});

test('review results are immutable and do not expose a value estimation', () => {
  const review = reviewReportedValuation({ marketValue: 10, landValue: 100 });
  assert.equal(Object.isFrozen(review), true);
  assert.equal(Object.isFrozen(review.flags), true);
  assert.equal(Object.hasOwn(review, 'verifiedValue'), false);
  assert.equal(Object.hasOwn(review, 'suggestedPrice'), false);
});
