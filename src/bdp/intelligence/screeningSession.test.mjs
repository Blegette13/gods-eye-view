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
    soilsLoader: async () => ({ dominant: { mappedSharePercent: 80, farmlandClass: 'Prime farmland' } }),
    terrainLoader: async () => ({ slope: { meanDegrees: 3, maxDegrees: 8 } }),
  });

  assert.equal(result.sourceCoveragePercent, 100);
  assert.equal(result.score.coveragePercent, 23);
  assert.equal(result.score.readiness, 'insufficient-evidence');
  assert.ok(result.redFlags.some((item) => item.id === 'pipeline-crossing'));
  assert.deepEqual(result.failedSources, []);
});

test('keeps partial evidence when a provider fails', async () => {
  const unavailable = Object.assign(new Error('PostGIS not configured'), { status: 503 });
  const result = await runBdpParcelScreening(parcel, {
    energyLoader: async () => { throw unavailable; },
    floodLoader: async () => { throw unavailable; },
    wetlandsLoader: async () => { throw unavailable; },
    soilsLoader: async () => ({ dominant: { mappedSharePercent: 90, farmlandClass: '' } }),
    terrainLoader: async () => ({ slope: { meanDegrees: 4, maxDegrees: 9 } }),
  });

  assert.equal(result.sourceCoveragePercent, 40);
  assert.deepEqual(result.succeededSources.sort(), ['soils', 'terrain']);
  assert.deepEqual(result.failedSources.sort(), ['energy', 'flood', 'wetlands']);
  assert.equal(result.errors.energy.status, 503);
  assert.equal(result.score.coveragePercent, 5);
  assert.equal(result.score.components.environmental.status, 'unknown');
  assert.equal(result.score.components.floodWater.status, 'unknown');
  assert.equal(result.score.components.terrainSoil.status, 'preliminary');
});
