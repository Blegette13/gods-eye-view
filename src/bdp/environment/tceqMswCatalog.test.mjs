import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TCEQ_MSW_DATASETS,
  createTceqMswIngestionPlan,
  getTceqMswDataset,
} from './tceqMswCatalog.js';

test('TCEQ MSW catalog uses the official statewide files', () => {
  assert.equal(TCEQ_MSW_DATASETS.facilities.filename, 'msw-facilities-texas.xls');
  assert.equal(TCEQ_MSW_DATASETS.closed.filename, 'msw-closed-facilities-texas.xls');
  assert.equal(TCEQ_MSW_DATASETS.revoked.filename, 'msw-revoked-or-not-issued-texas.xls');
  assert.equal(TCEQ_MSW_DATASETS.unnumbered.filename, 'msw-unum-texas.xlsx');
  for (const spec of Object.values(TCEQ_MSW_DATASETS)) {
    assert.match(spec.url, /^https://www.tceq.texas.gov//);
  }
});

test('TCEQ MSW ingestion plan preserves source provenance', () => {
  const plan = createTceqMswIngestionPlan({ datasets: ['facilities', 'unnumbered'] });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].targetTable, 'bdp_tceq_msw_sites');
  assert.equal(plan[0].provenanceRequired, true);
  assert.match(plan[0].fieldGuideUrl, /gi-613/i);
  assert.equal(plan[1].historical, true);
});

test('TCEQ MSW catalog rejects unsupported dataset names', () => {
  assert.throws(() => getTceqMswDataset('mystery'), /Unsupported TCEQ MSW dataset/);
});
