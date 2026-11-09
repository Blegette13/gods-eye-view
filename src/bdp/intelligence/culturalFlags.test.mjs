import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveCulturalFlags } from './culturalFlags.js';

test('cemetery intersection is high severity and restricted archaeology stays unresolved', () => {
  const flags = deriveCulturalFlags({
    nearest_cemetery_m: 0,
    nearest_cemetery_name: 'Example Cemetery',
    cemeteries_intersecting_parcel: 1,
    cemetery_overlap_acres: 2.5,
    cemetery_overlap_percent: 5,
    cemeteries_within_1_mi: 1,
    archaeology_public_screen_status: 'restricted-location-data-not-screened',
  });

  const cemetery = flags.find((item) => item.id === 'thc-cemetery-overlap');
  assert.equal(cemetery.severity, 'high');
  assert.equal(cemetery.evidence.overlapAcres, 2.5);

  const archaeology = flags.find((item) => item.id === 'archeology-public-screen-incomplete');
  assert.equal(archaeology.severity, 'info');
  assert.match(archaeology.detail, /must not be interpreted as archeological clearance/i);
});

test('nearby cemetery remains contextual when it does not overlap the parcel', () => {
  const flags = deriveCulturalFlags({
    nearest_cemetery_m: 300,
    nearest_cemetery_name: 'Nearby Cemetery',
    cemeteries_intersecting_parcel: 0,
    cemetery_overlap_acres: 0,
    cemetery_overlap_percent: 0,
    cemeteries_within_1_mi: 1,
    archaeology_public_screen_status: 'restricted-location-data-not-screened',
  });

  assert.equal(
    flags.find((item) => item.id === 'thc-cemetery-adjacent').severity,
    'medium',
  );
  assert.ok(flags.some((item) => item.id === 'archeology-public-screen-incomplete'));
});

test('public cultural screen never emits a fake archeology-clear state', () => {
  const flags = deriveCulturalFlags({
    nearest_cemetery_m: null,
    cemeteries_intersecting_parcel: 0,
    cemeteries_within_1_mi: 0,
  });

  assert.deepEqual(flags.map((item) => item.id), [
    'archeology-public-screen-incomplete',
  ]);
});
