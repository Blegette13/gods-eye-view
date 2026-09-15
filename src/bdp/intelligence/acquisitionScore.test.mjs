import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BDP_SCORE_TOTAL_WEIGHT,
  BDP_SCORE_WEIGHTS,
  buildCurrentScreeningComponents,
  calculateBdpScore,
  normalizeComponentScore,
  scoreFemaFloodWater,
  scoreTerrainSoil,
  scoreWetlandsEnvironment,
} from './acquisitionScore.js';

test('BDP score weights remain a 100-point model', () => {
  assert.equal(BDP_SCORE_TOTAL_WEIGHT, 100);
  assert.equal(Object.values(BDP_SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0), 100);
});

test('normalizes component score without converting unknown into zero', () => {
  assert.equal(normalizeComponentScore(null), null);
  assert.equal(normalizeComponentScore(undefined), null);
  assert.equal(normalizeComponentScore(-20), 0);
  assert.equal(normalizeComponentScore(120), 100);
});

test('calculates score only across known categories and exposes coverage', () => {
  const result = calculateBdpScore({
    components: {
      environmental: { score: 80, confidence: 0.5 },
      floodWater: { score: 50, confidence: 0.5 },
      terrainSoil: { score: 100, confidence: 1 },
    },
  });

  assert.equal(result.coveredWeight, 23);
  assert.equal(result.coveragePercent, 23);
  assert.equal(result.readiness, 'insufficient-evidence');
  assert.equal(result.missingCategories.length, 7);
  assert.ok(result.score > 70 && result.score < 80);
  assert.ok(result.confidenceAdjustedCoveragePercent < result.coveragePercent);
});

test('marks a sufficiently covered model as decision-support', () => {
  const components = Object.fromEntries(
    Object.keys(BDP_SCORE_WEIGHTS).map((category) => [category, { score: 80, confidence: 0.9 }]),
  );
  const result = calculateBdpScore({ components });
  assert.equal(result.score, 80);
  assert.equal(result.coveragePercent, 100);
  assert.equal(result.confidenceAdjustedCoveragePercent, 90);
  assert.equal(result.readiness, 'decision-support');
  assert.deepEqual(result.missingCategories, []);
});

test('screening helpers remain explicitly preliminary', () => {
  const wetlands = scoreWetlandsEnvironment({ nwi_percent: 15 });
  const flood = scoreFemaFloodWater({ mapped_flood_percent: 20, floodway_acres: 2 });
  const terrainSoil = scoreTerrainSoil({
    terrain: { slope: { meanDegrees: 6 } },
    soils: { dominant: { mappedSharePercent: 70, farmlandClass: 'Prime farmland' } },
  });

  assert.equal(wetlands.confidence, 0.35);
  assert.equal(flood.confidence, 0.45);
  assert.equal(terrainSoil.confidence, 0.7);
  assert.ok(flood.score < wetlands.score);
  assert.ok(terrainSoil.evidence.some((item) => item.includes('Prime farmland')));
});

test('builds only currently supported screening categories', () => {
  const components = buildCurrentScreeningComponents({
    wetlands: { nwi_percent: 0 },
    flood: { mapped_flood_percent: 0, floodway_acres: 0 },
    terrain: { slope: { meanDegrees: 2 } },
    soils: { dominant: { mappedSharePercent: 80, farmlandClass: '' } },
  });
  assert.deepEqual(Object.keys(components).sort(), ['environmental', 'floodWater', 'terrainSoil']);
  const result = calculateBdpScore({ components });
  assert.equal(result.coveragePercent, 23);
  assert.equal(result.readiness, 'insufficient-evidence');
});
