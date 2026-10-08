import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBdpSourceCoverage, describeBdpSourceCoverage } from './sourceCoverage.js';

test('empty or failed evidence never becomes a returned source', () => {
  for (const value of [null, undefined, {}, [], false, 0, 'ok']) {
    assert.equal(describeBdpSourceCoverage('terrain', value).status, 'unknown');
  }
  const result = describeBdpSourceCoverage('flood', { coverage_complete: true }, { message: 'private credentials' });
  assert.equal(result.status, 'unavailable');
  assert.ok(!JSON.stringify(result).includes('private credentials'));
});

test('FEMA and MSW require affirmative mapping coverage even with zero counts', () => {
  for (const source of ['flood', 'msw']) {
    for (const coverage of [undefined, false, 'true']) {
      const result = describeBdpSourceCoverage(source, { coverage_complete: coverage, count: 0 });
      assert.equal(result.status, 'limited');
      assert.match(result.detail, /cannot establish clearance/);
    }
    assert.equal(describeBdpSourceCoverage(source, { coverage_complete: true }).status, 'returned');
  }
  assert.equal(describeBdpSourceCoverage('wetlands', { coverage_complete: false }).status, 'limited');
});

test('partial utilities preserve individual failures and unverified snapshots in their coverage detail', () => {
  const metrics = { water_service_source_status: 'mapped', water_service_overlap_percent: 100,
    water_ccn_source_status: 'unavailable', transmission_source_status: 'unavailable',
    puct_water_ccn_coverage: 'not-ingested', sewer_ccn_coverage: 'stale-or-unverified' };
  const before = JSON.stringify(metrics);
  const result = describeBdpSourceCoverage('utilities', metrics);
  assert.equal(result.status, 'limited');
  for (const name of ['Archived water CCN', 'Archived transmission', 'Current PUCT water CCN', 'Current PUCT sewer CCN']) {
    assert.ok(result.detail.includes(name));
  }
  assert.equal(JSON.stringify(metrics), before);
  const returned = describeBdpSourceCoverage('utilities', { water_service_source_status: 'mapped',
    water_ccn_source_status: 'archived-2021', transmission_source_status: 'archived-2024',
    puct_water_ccn_coverage: 'mapped-snapshot', sewer_ccn_coverage: 'mapped-snapshot' });
  assert.equal(returned.status, 'returned');
  assert.match(returned.detail, /legal facts remain unverified/);
});

test('unresolved regional jurisdiction is limited evidence, not no-zoning clearance', () => {
  const result = describeBdpSourceCoverage('entitlement', { jurisdiction_screen: 'outside-or-unresolved', city_zoning_coverage_percent: 0 });
  assert.equal(result.status, 'limited');
  assert.match(result.detail, /responsible authority/);
});

test('ledger has exactly one immutable row per requested feed and does not count derived evidence', () => {
  const ledger = buildBdpSourceCoverage(['terrain', 'utilities', 'flood'], {
    terrain: { slope: { meanDegrees: 4 } }, utilities: { water_service_source_status: 'unavailable' },
    developmentConstraints: { coverage_complete: true },
  }, { flood: { status: 503 } });
  assert.deepEqual(Object.keys(ledger), ['terrain', 'utilities', 'flood']);
  assert.deepEqual(Object.values(ledger).map((item) => item.status), ['returned', 'limited', 'unavailable']);
  assert.ok(Object.isFrozen(ledger));
  assert.ok(Object.values(ledger).every(Object.isFrozen));
});
