import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRrcCountyArchiveName,
  createRrcCountyIngestionPlan,
  normalizeTexasCountyFips,
  RRC_COUNTY_DATASETS,
  RRC_NATIVE_CRS,
} from './rrcCatalog.js';

test('normalizes Texas county FIPS to three digits', () => {
  assert.equal(normalizeTexasCountyFips(29), '029');
  assert.equal(normalizeTexasCountyFips('029'), '029');
  assert.equal(normalizeTexasCountyFips('48029'), '029');
  assert.throws(() => normalizeTexasCountyFips('06037'), /Texas state code 48/);
  assert.throws(() => normalizeTexasCountyFips('030'), /Invalid Texas county FIPS/);
});

test('builds current RRC county archive naming convention', () => {
  assert.equal(buildRrcCountyArchiveName('wells', '029'), 'well029.zip');
  assert.equal(buildRrcCountyArchiveName('pipelines', '48029'), 'pipeline029.zip');
});

test('creates a two-dataset Bexar ingestion plan with provenance', () => {
  const plan = createRrcCountyIngestionPlan({ countyFips: '48029' });

  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((entry) => entry.filename), [
    'well029.zip',
    'pipeline029.zip',
  ]);
  assert.ok(plan.every((entry) => entry.fullFips === '48029'));
  assert.ok(plan.every((entry) => entry.provenanceRequired));
  assert.ok(plan.every((entry) => entry.nativeCrs === RRC_NATIVE_CRS));
  assert.equal(plan[0].targetTable, RRC_COUNTY_DATASETS.wells.targetTable);
  assert.equal(plan[1].targetTable, RRC_COUNTY_DATASETS.pipelines.targetTable);
});

test('deduplicates counties in a statewide work plan', () => {
  const plan = createRrcCountyIngestionPlan({
    countyFips: ['029', 29, '001'],
    datasets: ['wells'],
  });

  assert.deepEqual(plan.map((entry) => entry.countyFips), ['029', '001']);
});
