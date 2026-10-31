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
  assert.ok(result.score >= 70);
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

test('2021 water CCN copy cannot award favorable points or soften a negative screen', () => {
  const base = { water_service_overlap_percent: 0, nearest_transmission_m: null,
    transmission_crossing_count: 0 };
  const covered = scoreUtilitiesInfrastructure({ ...base, water_ccn_overlap_percent: 100 });
  const uncovered = scoreUtilitiesInfrastructure({ ...base, water_ccn_overlap_percent: 0 });
  assert.equal(covered.score, uncovered.score);
  assert.match(covered.evidence.join(' '), /2021 source; no score effect/);
  assert.equal(scoreUtilitiesInfrastructure({ water_ccn_overlap_percent: 100 }), null);
});
