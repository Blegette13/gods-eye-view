import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTceqWaterRightsIngestionPlan,
  getTceqWaterRightsDataset,
  TCEQ_WATER_RIGHTS_DATASETS,
  TCEQ_WATER_RIGHTS_VIEWER_ITEM_ID,
} from './tceqWaterRightsCatalog.js';

test('catalogs official active and inactive TCEQ water-right files', () => {
  assert.equal(TCEQ_WATER_RIGHTS_DATASETS.active.filename, 'wractive.xlsx');
  assert.equal(TCEQ_WATER_RIGHTS_DATASETS.inactive.filename, 'wrinactive.xlsx');
  assert.match(TCEQ_WATER_RIGHTS_DATASETS.active.url, /^https:\/\/www\.tceq\.texas\.gov\//);
  assert.match(TCEQ_WATER_RIGHTS_DATASETS.inactive.url, /^https:\/\/www\.tceq\.texas\.gov\//);
  assert.equal(TCEQ_WATER_RIGHTS_VIEWER_ITEM_ID, 'ccf87bc930604daca3c2148baa266434');
});

test('builds deduplicated statewide ingestion work with provenance', () => {
  const plan = createTceqWaterRightsIngestionPlan({
    datasets: ['active', 'inactive', 'active'],
  });

  assert.deepEqual(plan.map((entry) => entry.dataset), ['active', 'inactive']);
  assert.ok(plan.every((entry) => entry.targetTable === 'bdp_tceq_water_rights'));
  assert.ok(plan.every((entry) => entry.provenanceRequired));
  assert.ok(plan.every((entry) => entry.viewerItemId === TCEQ_WATER_RIGHTS_VIEWER_ITEM_ID));
});

test('rejects unsupported datasets', () => {
  assert.throws(() => getTceqWaterRightsDataset('groundwater'), /Unsupported TCEQ/);
});
