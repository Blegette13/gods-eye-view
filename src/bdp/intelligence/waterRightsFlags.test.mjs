import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveWaterRightsFlags } from './waterRightsFlags.js';

test('flags a mapped TCEQ point on the parcel without inferring ownership', () => {
  const flags = deriveWaterRightsFlags({
    water_right_points_on_parcel: 1,
    water_right_points_within_1_mi: 1,
    water_right_points_within_5_mi: 3,
    distinct_water_rights_within_5_mi: 2,
    nearest_water_right_point_m: 0,
  });
  assert.ok(flags.some((item) => item.id === 'tceq-water-right-point-on-parcel'));
  assert.ok(flags.some((item) => item.id === 'tceq-water-right-ownership-unverified'));
  assert.ok(flags.every((item) => item.requiresVerification));
});

test('nearby TCEQ points remain low-severity context', () => {
  const flags = deriveWaterRightsFlags({
    water_right_points_on_parcel: 0,
    water_right_points_within_1_mi: 2,
    water_right_points_within_5_mi: 4,
    distinct_water_rights_within_5_mi: 3,
    nearest_water_right_point_m: 600,
  });
  assert.ok(flags.some((item) => item.id === 'tceq-water-right-point-nearby'));
  assert.equal(
    flags.find((item) => item.id === 'tceq-water-right-point-nearby').severity,
    'low',
  );
});
