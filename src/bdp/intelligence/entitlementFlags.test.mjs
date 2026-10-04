import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveEntitlementFlags } from './entitlementFlags.js';

test('ETJ produces a jurisdiction review flag instead of a city-zoning conclusion', () => {
  const flags = deriveEntitlementFlags({
    jurisdiction_screen: 'san-antonio-etj',
    etj_overlap_percent: 100,
  });
  assert.deepEqual(flags.map((item) => item.id), [
    'san-antonio-etj-entitlement-review',
  ]);
});

test('city zoning flags split coverage, special conditions and future-use conflict', () => {
  const flags = deriveEntitlementFlags({
    jurisdiction_screen: 'san-antonio-city-zoned',
    city_zoning_coverage_percent: 100,
    dominant_zoning_share_percent: 65,
    dominant_zoning_base: 'I-1',
    zoning_special_condition_count: 1,
    dominant_zoning_spec_district: 'S',
    dominant_zoning_case_no: 'Z2026-1',
    future_land_use_coverage_percent: 100,
    dominant_future_land_use_share_percent: 90,
    dominant_future_land_use: 'Low Density Residential',
  });
  const ids = flags.map((item) => item.id);
  assert.ok(ids.includes('split-or-partial-zoning'));
  assert.ok(ids.includes('zoning-special-condition-review'));
  assert.ok(ids.includes('zoning-future-land-use-conflict'));
  assert.ok(ids.includes('legal-entitlement-unverified'));
});

test('unresolved jurisdiction is visible and does not claim legal entitlement', () => {
  const flags = deriveEntitlementFlags({
    jurisdiction_screen: 'outside-or-unresolved',
    city_zoning_coverage_percent: 0,
    etj_overlap_percent: 0,
  });
  assert.equal(flags[0].id, 'entitlement-jurisdiction-unresolved');
});
