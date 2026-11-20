import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveMswFlags } from './mswFlags.js';

test('flags on-tract point and nearby active landfill without claiming exact waste boundary', () => {
  const flags = deriveMswFlags({
    nearest_msw_site_m: 0,
    nearest_site_name: 'TEST LANDFILL',
    msw_points_on_parcel: 1,
    active_landfills_within_1_mi: 1,
    active_landfills_within_3_mi: 1,
    closed_sites_within_1_mi: 0,
    closed_sites_within_3_mi: 0,
    unauthorized_sites_within_1_mi: 0,
    unauthorized_sites_within_3_mi: 0,
    hazardous_history_sites_within_3_mi: 0,
  });
  assert.ok(flags.some((item) => item.id === 'tceq-msw-point-on-parcel'));
  assert.ok(flags.some((item) => item.id === 'active-landfill-within-1-mi'));
  assert.match(
    flags.find((item) => item.id === 'tceq-msw-point-on-parcel').detail,
    /gate, benchmark, centroid/i,
  );
});

test('flags historical unauthorized and hazardous-history sites separately', () => {
  const flags = deriveMswFlags({
    msw_points_on_parcel: 0,
    active_landfills_within_1_mi: 0,
    active_landfills_within_3_mi: 0,
    closed_sites_within_1_mi: 0,
    closed_sites_within_3_mi: 0,
    unauthorized_sites_within_1_mi: 1,
    unauthorized_sites_within_3_mi: 1,
    hazardous_history_sites_within_3_mi: 2,
  });
  assert.ok(flags.some((item) => item.id === 'historical-unauthorized-dump-within-1-mi'));
  assert.ok(flags.some((item) => item.id === 'historical-msw-hazardous-history-within-3-mi'));
});

test('does not produce MSW hazard flags for a clear screen', () => {
  assert.deepEqual(deriveMswFlags({
    msw_points_on_parcel: 0,
    active_landfills_within_1_mi: 0,
    active_landfills_within_3_mi: 0,
    closed_sites_within_1_mi: 0,
    closed_sites_within_3_mi: 0,
    unauthorized_sites_within_1_mi: 0,
    unauthorized_sites_within_3_mi: 0,
    hazardous_history_sites_within_3_mi: 0,
  }), []);
});
