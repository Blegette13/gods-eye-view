import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeDiscoveryCandidates } from './discoveryFeedback.js';
import { normalizeLandCriteria } from '../acquisition/session.js';

const criteria = normalizeLandCriteria({
  county: 'Travis', acresMin: 5, acresMax: 100,
  purpose: 'Residential development', budgetMax: 600000,
});
const property = (id, acres) => ({
  county: 'Travis', parcelId: String(id),
  property: {
    acres, situsAddress: 'Example Road Austin TX 78704',
    geometry: { type: 'Polygon', coordinates: [[
      [-97.76, 30.24], [-97.75, 30.24],
      [-97.75, 30.25], [-97.76, 30.24],
    ]] },
  },
});

test('not-scanned data must never be described as zero eligible properties', () => {
  for (const views of [[], [{ complete: false, reason: 'zoom-in', parcels: [] }]]) {
    const summary = summarizeDiscoveryCandidates({ criteria, viewports: views });
    assert.equal(summary.state, 'not-scanned');
    assert.equal(summary.count, null);
    assert.match(summary.message, /Not scanned yet/);
  }
});

test('zero match count explicitly covers a completed current viewport only', () => {
  const summary = summarizeDiscoveryCandidates({
    criteria, viewports: [{ complete: true, parcels: [property('A', 0), property('B', 120)] }],
  });
  assert.equal(summary.state, 'zero');
  assert.equal(summary.count, 0);
  assert.equal(summary.scanned, 2);
  assert.match(summary.message, /NOT mean none exist in the county or radius/);
});

test('count all provisional source matches separately from a 24-pin map cap', () => {
  const parcels = Array.from({ length: 47 }, (_, i) => property(i + 1, 15));
  const summary = summarizeDiscoveryCandidates({
    criteria, viewports: [{ complete: true, parcels }],
  });
  assert.equal(summary.state, 'matches');
  assert.equal(summary.count, 47);
  assert.equal(summary.scanned, 47);
  assert.equal(summary.pins.length, 24);
  assert.match(summary.message, /47 possible matches/);
  assert.match(summary.message, /24 pins shown/);
});

test('budget and intended use alone cannot claim evaluated matches', () => {
  const profile = normalizeLandCriteria({
    county: 'Travis', purpose: 'Industrial / logistics', budgetMax: 2000000,
  });
  const summary = summarizeDiscoveryCandidates({
    criteria: profile, viewports: [{ complete: true, parcels: [property(1, 10)] }],
  });
  assert.equal(summary.state, 'needs-evidence');
  assert.equal(summary.count, null);
  assert.match(summary.message, /cannot be verified/);
});

test('missing Census radius origin never implies zero suitable parcels', () => {
  const radiusCriteria = normalizeLandCriteria({ county: 'Travis', radiusMiles: 25, acresMin: 3 });
  const result = summarizeDiscoveryCandidates({
    criteria: radiusCriteria,
    viewports: [{ county: 'Travis', complete: true, parcels: [property(1, 15)] }],
  });
  assert.equal(result.state, 'unknown-geography');
  assert.equal(result.count, null);
  assert.match(result.message, /Census county geometry is required/);
});

test('county-only counts ignore complete records belonging to other pilot counties', () => {
  const only = summarizeDiscoveryCandidates({
    criteria, viewports: [
      { county: 'Travis', complete: true, parcels: [property(1, 15)] },
      { county: 'Bexar', complete: true, parcels: [{ ...property(2, 20), county: 'Bexar' }] },
    ],
  });
  assert.equal(only.count, 1);
  assert.equal(only.scanned, 1);
});
