import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreUtilitiesInfrastructure } from '../../src/bdp/intelligence/utilitiesScore.js';
import { deriveUtilitiesFlags } from '../../src/bdp/intelligence/utilitiesFlags.js';
import { bdpUtilitiesProviderPlugin, screenBdpParcelUtilities } from './bdp-utilities.js';

test('utilities provider exposes a stable Vite plugin contract', () => {
  const plugin = bdpUtilitiesProviderPlugin();
  assert.equal(plugin.name, 'bdp-utilities-provider');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});

const geometry = { type: 'Polygon', coordinates: [[
  [-98.5, 29.4], [-98.49, 29.4], [-98.49, 29.41], [-98.5, 29.41], [-98.5, 29.4],
]] };

test('independent utility source outage preserves current PUCT territory and unknown service coverage', async () => {
  const result = await screenBdpParcelUtilities({ geometry }, {
    fetchSource: async (url) => {
      if (url.includes('Public_Water_Service_Areas')) throw new Error('source timed out');
      return { type: 'FeatureCollection', features: [] };
    },
    query: async (sql) => {
      if (sql.includes('bdp_puct_water_ccn_metrics')) {
        return { puct_water_ccn_coverage: 'mapped-snapshot', puct_water_ccn_overlap_percent: 42 };
      }
      if (sql.includes('bdp_puct_sewer_ccn_metrics')) {
        return { sewer_ccn_coverage: 'mapped-snapshot', sewer_ccn_overlap_percent: 5 };
      }
      return { water_service_area_count: 0, water_service_overlap_percent: 0,
        water_ccn_count: 0, water_ccn_overlap_percent: 0, transmission_crossing_count: 0 };
    },
  });
  assert.equal(result.sourceFeatureCounts.waterServiceAreas, null);
  assert.equal(result.sourceFeatureCounts.waterCcn, 0);
  assert.equal(result.metrics.water_service_overlap_percent, null);
  assert.equal(result.metrics.water_service_area_count, null);
  assert.equal(result.metrics.water_service_source_status, 'unavailable');
  assert.equal(result.metrics.water_ccn_overlap_percent, 0);
  assert.equal(result.metrics.puct_water_ccn_overlap_percent, 42);
  assert.equal(result.metrics.sewer_ccn_overlap_percent, 5);
  assert.equal(scoreUtilitiesInfrastructure(result.metrics), null);
  assert.equal(deriveUtilitiesFlags(result.metrics).some((flag) =>
    flag.id === 'no-current-water-service-boundary-overlap'), false);
});

test('archived transmission outage does not imply zero crossings', async () => {
  const result = await screenBdpParcelUtilities({ geometry }, {
    fetchSource: async (url) => {
      if (url.includes('PowerTransmissionInfrastructure')) throw new Error('source failed');
      return { type: 'FeatureCollection', features: [] };
    },
    query: async (sql) => sql.includes('bdp_puct_') ? {} : {
      water_service_overlap_percent: 0, transmission_crossing_count: 0,
      transmission_lines_within_1_mi: 0, transmission_data_currency: 'archived-2024',
    },
  });
  assert.equal(result.metrics.water_service_overlap_percent, 0);
  assert.equal(result.metrics.transmission_crossing_count, null);
  assert.equal(result.metrics.transmission_lines_within_1_mi, null);
  assert.equal(result.metrics.transmission_data_currency, null);
  assert.equal(result.sourceFeatureCounts.transmission, null);
});
