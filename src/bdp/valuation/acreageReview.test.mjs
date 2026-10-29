import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewReportedAcreage } from './acreageReview.js';

test('flags zero reported GIS acreage without inventing a parcel size', () => {
  const review = reviewReportedAcreage(0);
  assert.equal(review.kind, 'zero');
  assert.match(review.message, /source reports 0 acres/);
  assert.match(review.message, /current appraisal records and survey evidence/);
  assert.equal(Object.hasOwn(review, 'correctedAcres'), false);
});

test('does not claim missing acreage is a verified zero or a safe value', () => {
  for (const value of [null, undefined, '', NaN, Infinity, '0']) {
    assert.equal(reviewReportedAcreage(value), null);
  }
});

test('reported positive acreage needs no nonpositive warning; negatives are flagged', () => {
  assert.equal(reviewReportedAcreage(0.18), null);
  assert.equal(reviewReportedAcreage(100), null);
  const review = reviewReportedAcreage(-2);
  assert.equal(review.kind, 'negative');
  assert.match(review.message, /Do not use this value/);
});
