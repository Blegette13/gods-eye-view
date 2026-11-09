import assert from 'node:assert/strict';
import test from 'node:test';
import { screenBdpParcelTerrain } from './bdp-terrain.js';
import { describeBdpSourceCoverage } from '../../src/bdp/intelligence/sourceCoverage.js';

const input = {
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-97.758, 30.245],
      [-97.754, 30.245],
      [-97.754, 30.248],
      [-97.758, 30.248],
      [-97.758, 30.245],
    ]],
  },
};
const elevations = { statistics: [{ min: 150, max: 170, mean: 161, count: 200 }] };
const slopes = { statistics: [{ min: 0, max: 65, mean: 4.075, count: 172215 }] };

test('slope response survives an elevation timeout but reports LIMITED evidence', async () => {
  const metrics = await screenBdpParcelTerrain(input, {
    fetchJson: async (url) => {
      const rendering = new URL(url).searchParams.get('renderingRule');
      if (!rendering) throw new Error('elevation request timed out');
      return slopes;
    },
  });
  assert.equal(metrics.coverage_complete, false);
  assert.equal(metrics.elevation.meanMeters, null);
  assert.equal(metrics.slope.meanDegrees, 4.075);
  assert.equal(describeBdpSourceCoverage('terrain', metrics).status, 'limited');
});

test('full 3DEP measurements only when elevation and slope both have usable statistics', async () => {
  const metrics = await screenBdpParcelTerrain(input, {
    fetchJson: async (url) => new URL(url).searchParams.has('renderingRule') ? slopes : elevations,
  });
  assert.equal(metrics.coverage_complete, true);
  assert.equal(metrics.elevation.meanMeters, 161);
  assert.equal(metrics.slope.meanDegrees, 4.075);
  assert.equal(describeBdpSourceCoverage('terrain', metrics).status, 'returned');
});

test('an empty slope response and valid elevation leaves slope UNKNOWN', async () => {
  const metrics = await screenBdpParcelTerrain(input, {
    fetchJson: async (url) => new URL(url).searchParams.has('renderingRule') ? { statistics: [] } : elevations,
  });
  assert.equal(metrics.coverage_complete, false);
  assert.equal(metrics.slope.meanDegrees, null);
  assert.equal(metrics.terrainClass, 'unknown');
  assert.equal(describeBdpSourceCoverage('terrain', metrics).status, 'limited');
});

test('two missing or invalid 3DEP responses fail closed', async () => {
  await assert.rejects(
    screenBdpParcelTerrain(input, { fetchJson: async () => ({ statistics: [] }) }),
    /no usable terrain evidence/,
  );
});
