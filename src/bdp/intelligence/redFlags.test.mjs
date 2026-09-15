import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveBdpRedFlags, summarizeBdpRedFlags } from './redFlags.js';

test('flags pipeline crossings, floodway, wetlands, cleanup proximity, and steep terrain', () => {
  const flags = deriveBdpRedFlags({
    parcel: { property: { acres: 100 } },
    energy: {
      pipeline_crossing_count: 2,
      pipeline_length_on_parcel_m: 850,
      nearest_well_m: 120,
    },
    flood: {
      floodway_acres: 4,
      sfha_acres: 30,
      mapped_flood_percent: 35,
    },
    wetlands: {
      nwi_mapped_acres: 25,
      nwi_percent: 25,
    },
    cleanups: {
      cleanup_sites_on_parcel: 0,
      nearest_cleanup_m: 600,
      nearest_site_name: 'TEST SUPERFUND',
      nearest_is_superfund: true,
      nearest_is_rcra: false,
      superfund_within_5_mi: 1,
      rcra_within_5_mi: 0,
    },
    terrain: {
      slope: { meanDegrees: 12, maxDegrees: 30 },
    },
  });

  const ids = flags.map((item) => item.id);
  assert.ok(ids.includes('pipeline-crossing'));
  assert.ok(ids.includes('nearby-rrc-well'));
  assert.ok(ids.includes('fema-floodway'));
  assert.ok(ids.includes('fema-sfha'));
  assert.ok(ids.includes('nwi-wetlands'));
  assert.ok(ids.includes('nearby-epa-cleanup'));
  assert.ok(ids.includes('superfund-within-5-mi'));
  assert.ok(ids.includes('steep-terrain'));
  assert.ok(ids.includes('mineral-rights-unverified'));
  assert.ok(ids.includes('water-rights-ownership-unverified'));

  const summary = summarizeBdpRedFlags(flags);
  assert.ok(summary.high >= 3);
  assert.ok(summary.blockingCount >= 3);
  assert.equal(summary.highestSeverity, 'high');
});

test('flags an EPA cleanup record mapped on the parcel as high severity', () => {
  const flags = deriveBdpRedFlags({
    parcel: { property: { acres: 30 } },
    cleanups: {
      cleanup_sites_on_parcel: 1,
      nearest_cleanup_m: 0,
      nearest_site_name: 'ON TRACT CLEANUP',
      nearest_is_superfund: false,
      nearest_is_rcra: true,
      superfund_within_5_mi: 0,
      rcra_within_5_mi: 1,
    },
  });
  const cleanup = flags.find((item) => item.id === 'epa-cleanup-on-parcel');
  assert.equal(cleanup.severity, 'high');
  assert.match(cleanup.detail, /material environmental due-diligence/i);
});

test('flags unverified parcel ownership and valuation source currency', () => {
  const flags = deriveBdpRedFlags({
    parcel: {
      property: { acres: 25 },
      source: {
        provider: 'Bexar County ArcGIS REST',
        recordCurrency: 'unverified',
        lastVerified: '2026-09-15T22:00:00.000Z',
        sourceNotice: 'Verify current ownership with CAD and deed records.',
      },
    },
  });

  const sourceFlag = flags.find((item) => item.id === 'parcel-source-currency-unverified');
  assert.equal(sourceFlag.severity, 'medium');
  assert.equal(sourceFlag.evidence.recordCurrency, 'unverified');
  assert.equal(sourceFlag.evidence.provider, 'Bexar County ArcGIS REST');
  assert.match(sourceFlag.detail, /Verify current ownership/i);
});

test('escalates explicitly stale parcel source currency', () => {
  const flags = deriveBdpRedFlags({
    parcel: {
      source: {
        recordCurrency: 'stale',
        provider: 'Example CAD',
      },
    },
  });
  const sourceFlag = flags.find((item) => item.id === 'parcel-source-currency-unverified');
  assert.equal(sourceFlag.severity, 'high');
});

test('does not create hazard flags when screening evidence is clear or missing', () => {
  const flags = deriveBdpRedFlags({
    parcel: { property: { acres: 100 } },
    energy: { pipeline_crossing_count: 0, nearest_well_m: 5000 },
    flood: { floodway_acres: 0, sfha_acres: 0, mapped_flood_percent: 0 },
    wetlands: { nwi_mapped_acres: 0, nwi_percent: 0 },
    cleanups: {
      cleanup_sites_on_parcel: 0,
      nearest_cleanup_m: 9000,
      superfund_within_5_mi: 0,
      rcra_within_5_mi: 0,
    },
    terrain: { slope: { meanDegrees: 2, maxDegrees: 5 } },
  });

  assert.deepEqual(flags.map((item) => item.id).sort(), [
    'mineral-rights-unverified',
    'water-rights-ownership-unverified',
  ]);
  const summary = summarizeBdpRedFlags(flags);
  assert.equal(summary.high, 0);
  assert.equal(summary.medium, 0);
  assert.equal(summary.info, 2);
});

test('uses parcel percentage to escalate large SFHA overlap', () => {
  const flags = deriveBdpRedFlags({
    parcel: { property: { acres: 40 } },
    flood: { floodway_acres: 0, sfha_acres: 20, mapped_flood_percent: 50 },
  });
  const sfha = flags.find((item) => item.id === 'fema-sfha');
  assert.equal(sfha.severity, 'high');
  assert.equal(sfha.evidence.parcelPercent, 50);
});
