import assert from 'node:assert/strict';
import test from 'node:test';
import { runBdpParcelScreening } from './screeningSession.js';

const parcel = {
  id: '48029:123',
  parcelId: '123',
  property: {
    acres: 100,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-98.50, 29.40],
        [-98.49, 29.40],
        [-98.49, 29.41],
        [-98.50, 29.41],
        [-98.50, 29.40],
      ]],
    },
  },
};

test('collects screening evidence and derives score coverage/red flags', async () => {
  const result = await runBdpParcelScreening(parcel, {
    energyLoader: async () => ({ pipeline_crossing_count: 1, nearest_well_m: 2000 }),
    floodLoader: async () => ({ mapped_flood_percent: 10, floodway_acres: 0, sfha_acres: 10 }),
    wetlandsLoader: async () => ({ nwi_percent: 5, nwi_mapped_acres: 5 }),
    cleanupsLoader: async () => ({
      nearest_cleanup_m: 1000,
      cleanup_sites_on_parcel: 0,
      cleanup_sites_within_5_mi: 1,
      superfund_within_5_mi: 1,
      rcra_within_5_mi: 0,
      brownfields_within_5_mi: 0,
      nearest_site_name: 'TEST SITE',
    }),
    soilsLoader: async () => ({ dominant: { mappedSharePercent: 80, farmlandClass: 'Prime farmland' } }),
    terrainLoader: async () => ({ slope: { meanDegrees: 3, maxDegrees: 8 } }),
    transportationLoader: async () => ({
      nearest_road_m: 20,
      nearest_road_name: 'FM 1234',
      road_centerlines_within_250_ft: 1,
      nearest_aadt_current: 12000,
      nearest_station_m: 1000,
      nearest_station_5yr_change_percent: 10,
    }),
  });

  assert.equal(result.sourceCoveragePercent, 100);
  assert.equal(result.score.coveragePercent, 31);
  assert.equal(result.score.readiness, 'insufficient-evidence');
  assert.ok(result.redFlags.some((item) => item.id === 'pipeline-crossing'));
  assert.ok(result.redFlags.some((item) => item.id === 'nearby-epa-cleanup'));
  assert.ok(result.redFlags.some((item) => item.id === 'legal-access-unverified'));
  assert.deepEqual(result.failedSources, []);
  assert.ok(result.score.components.environmental.evidence.some((item) => item.includes('Superfund')));
  assert.equal(result.score.components.accessTraffic.status, 'preliminary');
});

test('keeps partial evidence when providers fail', async () => {
  const unavailable = Object.assign(new Error('PostGIS not configured'), { status: 503 });
  const result = await runBdpParcelScreening(parcel, {
    energyLoader: async () => { throw unavailable; },
    floodLoader: async () => { throw unavailable; },
    wetlandsLoader: async () => { throw unavailable; },
    cleanupsLoader: async () => { throw unavailable; },
    soilsLoader: async () => ({ dominant: { mappedSharePercent: 90, farmlandClass: '' } }),
    terrainLoader: async () => ({ slope: { meanDegrees: 4, maxDegrees: 9 } }),
    transportationLoader: async () => { throw unavailable; },
  });

  assert.equal(result.sourceCoveragePercent, (2 / 7) * 100);
  assert.deepEqual(result.succeededSources.sort(), ['soils', 'terrain']);
  assert.deepEqual(result.failedSources.sort(), ['cleanups', 'energy', 'flood', 'transportation', 'wetlands']);
  assert.equal(result.errors.energy.status, 503);
  assert.equal(result.errors.cleanups.status, 503);
  assert.equal(result.errors.transportation.status, 503);
  assert.equal(result.score.coveragePercent, 5);
  assert.equal(result.score.components.environmental.status, 'unknown');
  assert.equal(result.score.components.floodWater.status, 'unknown');
  assert.equal(result.score.components.terrainSoil.status, 'preliminary');
  assert.equal(result.score.components.accessTraffic.status, 'unknown');
});
