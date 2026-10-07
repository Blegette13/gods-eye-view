import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOwnershipTitleReview } from './ownershipReview.js';

const parcel = { county: 'Bexar', countyFips: '48029', owner: { name: 'CAD OWNER LLC' }, property: { legalDescription: 'CAD DESCRIPTION' }, source: { provider: 'County GIS', recordCurrency: 'current', lastVerified: '2026-10-06' } };

test('CAD observations, current currency and caller assertions never verify title or enable scoring', () => {
  const review = buildOwnershipTitleReview({ ...parcel, title: { verified: true, titleClear: true }, owner: { ...parcel.owner, verified: true } });
  assert.equal(review.observed_cad_owner, 'CAD OWNER LLC');
  assert.equal(review.cad_legal_description, 'CAD DESCRIPTION');
  assert.equal(review.cad_source.lastRetrieved, '2026-10-06');
  assert.equal(review.ownership_verified, false);
  assert.equal(review.title_clear, null);
  assert.equal(review.legal_access_verified, null);
  assert.equal(review.ownership_title_score_ready, false);
  assert.equal(review.verified_document_count, 0);
  assert.equal(review.tasks.length, 8);
  assert.ok(review.tasks.every((task) => task.status === 'unknown'));
});

test('record routing handles county identity and never falls back to a different county', () => {
  assert.match(buildOwnershipTitleReview(parcel).recordLookup.url, /bexar.org/);
  assert.match(buildOwnershipTitleReview({ countyFips: '029' }).recordLookup.url, /bexar.org/);
  assert.match(buildOwnershipTitleReview({ county: ' Bexar County ' }).recordLookup.url, /bexar.org/);
  assert.match(buildOwnershipTitleReview({ county: 'Travis', countyFips: '48453' }).recordLookup.url, /traviscountytx.gov/);
  assert.match(buildOwnershipTitleReview({ county: 'Hays', countyFips: '48209' }).recordLookup.url, /hayscountytx.gov/);
  assert.match(buildOwnershipTitleReview({ county: 'Dallas', countyFips: '48113' }).recordLookup.url, /dallascounty.org/);
  assert.match(buildOwnershipTitleReview({ county: 'Williamson', countyFips: '48491' }).recordLookup.url, /wilcotx.gov/);
  for (const candidate of [{ county: 'Travis', countyFips: '48029' }, { county: 'Bexar', countyFips: '48453' }, {}]) {
    assert.equal(buildOwnershipTitleReview(candidate).recordLookup.url, null);
  }
});

test('mapped intersections prioritize document review without asserting a title defect', () => {
  const review = buildOwnershipTitleReview(parcel, {
    energy: { pipeline_crossing_count: 1, nearest_well_m: 0 },
    utilities: { transmission_crossing_count: 1 },
    growthRadar: { mtp_crossing_count: 1 },
    waterRights: { water_right_points_on_parcel: 1 },
  });
  assert.equal(review.tasks[0].id, 'survey-easements');
  assert.equal(review.tasks[0].triggers.length, 3);
  assert.equal(review.tasks[1].id, 'mineral-water');
  assert.equal(review.tasks[1].triggers.length, 2);
  assert.ok(review.tasks.every((task) => task.status === 'unknown'));
  assert.equal(review.title_clear, null);
});

test('missing, invalid and zero intersection metrics retain all baseline reviews without clearance', () => {
  for (const value of [null, undefined, '', ' ', false, true, -1, 0, 'invalid']) {
    const review = buildOwnershipTitleReview({}, { energy: { pipeline_crossing_count: value }, waterRights: { water_right_points_on_parcel: value } });
    assert.ok(review.tasks.every((task) => task.triggers.length === 0));
    assert.equal(review.tasks.find((task) => task.id === 'legal-access').status, 'unknown');
  }
  assert.equal(buildOwnershipTitleReview().observed_cad_owner, null);
});
