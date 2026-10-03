import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveUtilitiesFlags } from './utilitiesFlags.js';

test('utilities flags preserve service-capacity verification', () => {
  const flags = deriveUtilitiesFlags({
    water_service_overlap_percent: 100,
    water_ccn_overlap_percent: 100,
    transmission_crossing_count: 0,
  });
  assert.ok(flags.some((item) => item.id === 'utility-capacity-unverified'));
});

test('utilities flags warn on absent current service and archived line crossing', () => {
  const flags = deriveUtilitiesFlags({
    water_service_overlap_percent: 0,
    water_ccn_overlap_percent: 20,
    transmission_crossing_count: 1,
    transmission_length_on_parcel_m: 400,
  });
  assert.ok(flags.some((item) => item.id === 'no-current-water-service-boundary-overlap'));
  assert.ok(flags.some((item) => item.id === 'archived-transmission-line-crossing'));
});
