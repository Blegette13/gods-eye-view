import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveGrowthRadarFlags } from './growthRadarFlags.js';

test('MTP crossing and preliminary plat on parcel trigger review', () => {
  const flags = deriveGrowthRadarFlags({
    mtp_crossing_count: 1,
    mtp_proposed_or_changed_within_5_mi: 2,
    preliminary_plats_on_parcel: 1,
    preliminary_plats_within_5_mi: 4,
    regional_centers_within_5_mi: 1,
    nearest_mtp_street: 'TEST ROAD',
    nearest_preliminary_plat_name: 'TEST PLAT',
  });
  const ids = flags.map((item) => item.id);
  assert.ok(ids.includes('mtp-corridor-crosses-parcel'));
  assert.ok(ids.includes('planned-mobility-change-within-5-mi'));
  assert.ok(ids.includes('preliminary-plat-on-parcel'));
  assert.ok(ids.includes('regional-center-within-5-mi'));
});

test('nearby plats stay contextual when they do not overlap the tract', () => {
  const flags = deriveGrowthRadarFlags({
    mtp_crossing_count: 0,
    mtp_proposed_or_changed_within_5_mi: 0,
    preliminary_plats_on_parcel: 0,
    preliminary_plats_within_5_mi: 3,
    regional_centers_within_5_mi: 0,
  });
  const plat = flags.find((item) => item.id === 'preliminary-plat-activity-within-5-mi');
  assert.equal(plat.severity, 'info');
  assert.match(plat.detail, /do not guarantee construction/i);
});
