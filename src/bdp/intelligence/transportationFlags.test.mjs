import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAccessTrafficFlags } from './transportationFlags.js';

test('always preserves legal-access verification when TxDOT evidence exists', () => {
  const flags = deriveAccessTrafficFlags({
    nearest_road_m: 20,
    road_centerlines_within_250_ft: 1,
    nearest_aadt_current: 12000,
  });
  const ids = flags.map((item) => item.id);
  assert.ok(ids.includes('legal-access-unverified'));
  assert.ok(!ids.includes('roadway-proximity-poor'));
});

test('flags poor roadway proximity without claiming the parcel has no access', () => {
  const flags = deriveAccessTrafficFlags({
    nearest_road_m: 1000,
    road_centerlines_within_250_ft: 0,
  });
  const ids = flags.map((item) => item.id);
  assert.ok(ids.includes('roadway-proximity-poor'));
  assert.ok(ids.includes('no-txdot-centerline-within-250-ft'));
  const access = flags.find((item) => item.id === 'roadway-proximity-poor');
  assert.match(access.detail, /verify whether the tract has legal access/i);
});

test('treats high traffic volume and station trend as contextual evidence', () => {
  const flags = deriveAccessTrafficFlags({
    nearest_road_m: 15,
    road_centerlines_within_250_ft: 2,
    nearest_aadt_current: 65000,
    nearest_station_m: 1500,
    nearest_station_5yr_change_percent: -20,
  });
  const ids = flags.map((item) => item.id);
  assert.ok(ids.includes('high-traffic-corridor'));
  assert.ok(ids.includes('nearby-traffic-decline'));
});
