import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreAccessTraffic } from './accessTrafficScore.js';

test('returns unknown when no TxDOT evidence is available', () => {
  assert.equal(scoreAccessTraffic(null), null);
  assert.equal(scoreAccessTraffic({}), null);
});

test('rewards close mapped roadway and useful traffic volume while remaining preliminary', () => {
  const result = scoreAccessTraffic({
    nearest_road_m: 20,
    road_centerlines_within_250_ft: 1,
    nearest_aadt_current: 18000,
    nearest_station_m: 1000,
    nearest_station_5yr_change_percent: 12,
  });
  assert.ok(result.score > 70);
  assert.equal(result.confidence, 0.55);
  assert.match(result.note, /does not establish legal access/i);
});

test('penalizes distant mapped road proximity', () => {
  const close = scoreAccessTraffic({ nearest_road_m: 20 });
  const distant = scoreAccessTraffic({ nearest_road_m: 2000 });
  assert.ok(close.score > distant.score);
});
