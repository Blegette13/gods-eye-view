import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyFutureLandUse,
  classifyZoningBase,
  entitlementPlanningConsistency,
  scoreEntitlementZoning,
} from './entitlementScore.js';

test('broadly classifies San Antonio zoning and future-use labels', () => {
  assert.equal(classifyZoningBase('R-6'), 'residential');
  assert.equal(classifyZoningBase('I-1'), 'industrial');
  assert.equal(classifyZoningBase('FR'), 'rural');
  assert.equal(classifyZoningBase('OCL'), 'unresolved');
  assert.equal(classifyFutureLandUse('Low Density Residential'), 'residential');
  assert.equal(classifyFutureLandUse('Business Park'), 'commercial');
});

test('planning consistency remains broad rather than a legal use determination', () => {
  assert.equal(
    entitlementPlanningConsistency('residential', 'residential'),
    'aligned',
  );
  assert.equal(
    entitlementPlanningConsistency('residential', 'mixed-special'),
    'generally-compatible',
  );
  assert.equal(
    entitlementPlanningConsistency('industrial', 'residential'),
    'potential-conflict',
  );
});

test('scores a well-covered city-zoned parcel as preliminary evidence', () => {
  const result = scoreEntitlementZoning({
    jurisdiction_screen: 'san-antonio-city-zoned',
    city_zoning_coverage_percent: 100,
    dominant_zoning_share_percent: 95,
    dominant_zoning_base: 'R-6',
    zoning_special_condition_count: 0,
    future_land_use_coverage_percent: 100,
    dominant_future_land_use_share_percent: 90,
    dominant_future_land_use: 'Low Density Residential',
  });
  assert.ok(result.score >= 80);
  assert.ok(result.confidence < 1);
  assert.equal(result.planningConsistency, 'aligned');
  assert.match(result.note, /screening only/i);
});

test('does not score ETJ or poorly covered city zoning as legal certainty', () => {
  assert.equal(scoreEntitlementZoning({
    jurisdiction_screen: 'san-antonio-etj',
    city_zoning_coverage_percent: 0,
  }), null);
  assert.equal(scoreEntitlementZoning({
    jurisdiction_screen: 'san-antonio-city-zoned',
    city_zoning_coverage_percent: 40,
    dominant_zoning_share_percent: 40,
  }), null);
});
