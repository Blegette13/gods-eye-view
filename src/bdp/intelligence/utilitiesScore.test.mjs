import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreUtilitiesInfrastructure } from './utilitiesScore.js';

test('utilities score rewards mapped water service but stays preliminary', () => {
  const result = scoreUtilitiesInfrastructure({
    water_service_overlap_percent: 100,
    water_ccn_overlap_percent: 100,
    nearest_transmission_m: 1200,
    transmission_crossing_count: 0,
  });
  assert.ok(result.score > 70);
  assert.ok(result.confidence < 0.5);
  assert.match(result.note, /capacity/i);
});

test('utilities score penalizes no mapped water service and transmission crossings', () => {
  const result = scoreUtilitiesInfrastructure({
    water_service_overlap_percent: 0,
    water_ccn_overlap_percent: 0,
    nearest_transmission_m: 0,
    transmission_crossing_count: 2,
  });
  assert.ok(result.score < 50);
});
