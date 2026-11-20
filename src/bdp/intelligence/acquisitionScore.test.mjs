import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BDP_SCORE_TOTAL_WEIGHT,
  BDP_SCORE_WEIGHTS,
  buildCurrentScreeningComponents,
  calculateBdpScore,
  normalizeComponentScore,
  scoreEnvironmental,
  scoreEpaCleanupEnvironment,
  scoreFemaFloodWater,
  scoreTerrainSoil,
  scoreTceqMswEnvironment,
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
  const cleanups = scoreEpaCleanupEnvironment({
    nearest_cleanup_m: 800,
    cleanup_sites_on_parcel: 0,
    cleanup_sites_within_5_mi: 3,
    superfund_within_5_mi: 1,
    rcra_within_5_mi: 1,
    brownfields_within_5_mi: 1,
  });
  const environmental = scoreEnvironmental({
    wetlands: { nwi_percent: 15 },
    cleanups: {
      nearest_cleanup_m: 800,
      cleanup_sites_on_parcel: 0,
      cleanup_sites_within_5_mi: 3,
      superfund_within_5_mi: 1,
      rcra_within_5_mi: 1,
      brownfields_within_5_mi: 1,
    },
  });
  const flood = scoreFemaFloodWater({ coverage_complete: true, mapped_flood_percent: 20, floodway_acres: 2 });
  const terrainSoil = scoreTerrainSoil({
    terrain: { slope: { meanDegrees: 6 } },
    soils: { dominant: { mappedSharePercent: 70, farmlandClass: 'Prime farmland' } },
  });

  assert.equal(wetlands.confidence, 0.35);
  assert.equal(cleanups.confidence, 0.5);
  assert.equal(environmental.confidence, 0.62);
  assert.equal(flood.confidence, 0.45);
  assert.equal(terrainSoil.confidence, 0.7);
  assert.ok(cleanups.score < 100);
  assert.ok(environmental.evidence.some((item) => item.includes('Superfund')));
  assert.ok(terrainSoil.evidence.some((item) => item.includes('Prime farmland')));
});

test('EPA cleanup overlap can sharply reduce the preliminary environmental score', () => {
  const cleanups = scoreEpaCleanupEnvironment({
    nearest_cleanup_m: 0,
    cleanup_sites_on_parcel: 1,
    cleanup_sites_within_5_mi: 1,
    superfund_within_5_mi: 1,
    rcra_within_5_mi: 0,
    brownfields_within_5_mi: 0,
  });
  assert.ok(cleanups.score <= 10);
  assert.ok(cleanups.evidence.some((item) => item.includes('mapped on parcel')));
});

test('builds only currently supported screening categories', () => {
  const components = buildCurrentScreeningComponents({
    wetlands: { nwi_percent: 0 },
    cleanups: {
      nearest_cleanup_m: 9000,
      cleanup_sites_on_parcel: 0,
      cleanup_sites_within_5_mi: 0,
      superfund_within_5_mi: 0,
      rcra_within_5_mi: 0,
      brownfields_within_5_mi: 0,
    },
    flood: { coverage_complete: true, mapped_flood_percent: 0, floodway_acres: 0 },
    terrain: { slope: { meanDegrees: 2 } },
    soils: { dominant: { mappedSharePercent: 80, farmlandClass: '' } },
  });
  assert.deepEqual(Object.keys(components).sort(), ['environmental', 'floodWater', 'terrainSoil']);
  const result = calculateBdpScore({ components });
  assert.equal(result.coveragePercent, 23);
  assert.equal(result.readiness, 'insufficient-evidence');
  assert.equal(components.environmental.confidence, 0.62);
});


test('TCEQ MSW point screening penalizes on-tract and unauthorized history without claiming contamination', () => {
  const result = scoreTceqMswEnvironment({
    coverage_complete: true,
    nearest_msw_site_m: 0,
    msw_points_on_parcel: 1,
    active_landfills_within_1_mi: 1,
    active_landfills_within_3_mi: 1,
    closed_sites_within_1_mi: 0,
    closed_sites_within_3_mi: 0,
    unauthorized_sites_within_1_mi: 1,
    unauthorized_sites_within_3_mi: 1,
    hazardous_history_sites_within_3_mi: 1,
    all_msw_sites_within_5_mi: 3,
  });
  assert.ok(result.score < 50);
  assert.equal(result.confidence, 0.45);
  assert.match(result.note, /do not establish exact waste boundaries or parcel contamination/i);
});

test('environment score gains confidence when TCEQ MSW joins NWI and EPA evidence', () => {
  const result = scoreEnvironmental({
    wetlands: { nwi_percent: 0 },
    cleanups: {
      nearest_cleanup_m: 9000,
      cleanup_sites_on_parcel: 0,
      cleanup_sites_within_5_mi: 0,
      superfund_within_5_mi: 0,
      rcra_within_5_mi: 0,
      brownfields_within_5_mi: 0,
    },
    msw: {
      coverage_complete: true,
      nearest_msw_site_m: 9000,
      msw_points_on_parcel: 0,
      active_landfills_within_1_mi: 0,
      active_landfills_within_3_mi: 0,
      closed_sites_within_1_mi: 0,
      closed_sites_within_3_mi: 0,
      unauthorized_sites_within_1_mi: 0,
      unauthorized_sites_within_3_mi: 0,
      hazardous_history_sites_within_3_mi: 0,
      all_msw_sites_within_5_mi: 0,
    },
  });
  assert.equal(result.confidence, 0.72);
  assert.match(result.source, /TCEQ MSW/);
});

test('MSW empty, partial and stale imports cannot earn favorable environmental scores', () => {
  for (const coverage_complete of [undefined, false]) {
    assert.equal(scoreTceqMswEnvironment({ coverage_complete, all_msw_sites_within_5_mi: 0 }), null);
  }
  assert.equal(scoreTceqMswEnvironment({ coverage_complete: true, all_msw_sites_within_5_mi: 0 }), null);
});

test('missing or incomplete FEMA coverage cannot earn a favorable flood score', () => {
  for (const coverage_complete of [undefined, false]) {
    assert.equal(scoreFemaFloodWater({ coverage_complete, mapped_flood_percent: 0 }), null);
  }
});

test('EPA requires all scored counts and a measured distance when nearby records exist', () => {
  const clear = { nearest_cleanup_m: null, cleanup_sites_on_parcel: 0, cleanup_sites_within_5_mi: 0,
    superfund_within_5_mi: 0, rcra_within_5_mi: 0, brownfields_within_5_mi: 0 };
  assert.equal(scoreEpaCleanupEnvironment(clear).score, 100);
  for (const field of ['cleanup_sites_on_parcel', 'cleanup_sites_within_5_mi', 'superfund_within_5_mi',
    'rcra_within_5_mi', 'brownfields_within_5_mi']) {
    for (const value of [undefined, null, false, '', ' ', -1, 0.5, [], {}]) {
      assert.equal(scoreEpaCleanupEnvironment({ ...clear, [field]: value }), null, `${field}: ${String(value)}`);
    }
  }
  assert.equal(scoreEpaCleanupEnvironment({ cleanup_sites_on_parcel: 0 }), null);
  assert.equal(scoreEpaCleanupEnvironment({ ...clear, superfund_within_5_mi: 1 }), null);
  assert.equal(scoreEpaCleanupEnvironment({ ...clear, cleanup_sites_within_5_mi: 1 }), null);
  assert.equal(scoreEpaCleanupEnvironment({ ...clear, nearest_cleanup_m: -1 }), null);
  assert.ok(scoreEpaCleanupEnvironment({ ...clear, cleanup_sites_within_5_mi: 1, nearest_cleanup_m: 100 }).score < 100);
  const wetlandOnly = scoreEnvironmental({ wetlands: { nwi_percent: 10 }, cleanups: { cleanup_sites_on_parcel: 0 } });
  assert.equal(wetlandOnly.confidence, 0.35);
  assert.equal(wetlandOnly.source, 'USFWS NWI screening');
});

test('malformed percentages, slopes and floodway metrics cannot become favorable observations', () => {
  for (const value of [false, true, '', ' ', [], {}, -1, 101, Infinity, NaN]) {
    assert.equal(scoreWetlandsEnvironment({ nwi_percent: value }), null);
    assert.equal(scoreFemaFloodWater({ coverage_complete: true, mapped_flood_percent: value, floodway_acres: 0 }), null);
  }
  for (const value of [undefined, null, false, -1, ' ']) {
    assert.equal(scoreFemaFloodWater({ coverage_complete: true, mapped_flood_percent: 0, floodway_acres: value }), null);
  }
  for (const value of [false, [], {}, -1, 91]) {
    assert.equal(scoreTerrainSoil({ terrain: { slope: { meanDegrees: value } } }), null);
  }
  assert.equal(scoreWetlandsEnvironment({ nwi_percent: '0' }).score, 100);
  assert.equal(scoreFemaFloodWater({ coverage_complete: true, mapped_flood_percent: 0, floodway_acres: 0 }).score, 100);
  assert.equal(scoreTerrainSoil({ terrain: { slope: { meanDegrees: false } },
    soils: { dominant: { mappedSharePercent: 80 } } }).confidence, 0.45);
  assert.equal(normalizeComponentScore(false), null);
});
