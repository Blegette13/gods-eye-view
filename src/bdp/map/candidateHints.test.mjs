import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestViewportParcels } from './candidateHints.js';
import { normalizeLandCriteria } from '../acquisition/session.js';

function parcel(county, acres, zip = '78704', id = '123') {
  return {
    county, parcelId: id,
    property: {
      acres, situsAddress: 'EXAMPLE ROAD AUSTIN TX ' + zip,
      geometry: { type: 'Polygon', coordinates: [[
        [-97.76, 30.24], [-97.75, 30.24],
        [-97.75, 30.25], [-97.76, 30.24],
      ]] },
    },
  };
}

test('pins require a known positive reported field match and mapped source parcel polygon', () => {
  const criteria = normalizeLandCriteria({ county: 'Travis', acresMin: 5, acresMax: 50, zip: '78704' });
  const pins = suggestViewportParcels({
    criteria,
    parcels: [
      parcel('Travis', 12),
      parcel('Travis', 0, '78704', '124'),
      parcel('Travis', 75, '78704', '125'),
      parcel('Bexar', 12, '78704', '126'),
      { ...parcel('Travis', 12, '78704', '127'), property: { acres: 12, geometry: null } },
    ],
  });
  assert.equal(pins.length, 2, 'zero acreage unknown but ZIP source match can still produce a provisional pin');
  assert.deepEqual(pins.map((p) => p.parcelId), ['123', '124']);
  assert.match(pins[0].caveat, /NOT VERIFIED/);
});

test('radius excludes source geometry outside geographic search distance', () => {
  const criteria = normalizeLandCriteria({ county: 'Travis', radiusMiles: 5, acresMin: 1 });
  assert.equal(suggestViewportParcels({
    criteria, center: { lon: -98.5, lat: 29.4 }, parcels: [parcel('Travis', 12)],
  }).length, 0);
  assert.equal(suggestViewportParcels({
    criteria, center: { lon: -97.755, lat: 30.245 }, parcels: [parcel('Travis', 12)],
  }).length, 1);
});

test('no acreage or address evidence means no suitability pin just because budget and purpose exist', () => {
  const criteria = normalizeLandCriteria({
    county: 'Travis', purpose: 'Residential development', budgetMax: 500000,
  });
  assert.deepEqual(suggestViewportParcels({
    criteria, parcels: [parcel('Travis', 12)],
  }), []);
});

test('pins are bounded and duplicate county IDs do not multiply markers', () => {
  const criteria = normalizeLandCriteria({ county: 'Travis', acresMin: 1 });
  const source = Array.from({ length: 80 }, (_, n) => parcel('Travis', 10, '78704', String(n + 1)));
  const pins = suggestViewportParcels({ criteria, parcels: source, limit: 24 });
  assert.equal(pins.length, 24);
  assert.equal(suggestViewportParcels({
    criteria, parcels: [source[0], source[0]],
  }).length, 1);
});
