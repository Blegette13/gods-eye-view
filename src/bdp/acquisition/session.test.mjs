import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACQUISITION_STAGES, LAND_PURPOSES, normalizeLandCriteria,
  createAcquisitionSession, acquisitionSnapshot, reviewLandCriteria,
} from './session.js';

test('criteria are optional, bounded and do not silently invent buyer targets', () => {
  assert.throws(() => normalizeLandCriteria(), /Select a supported Texas county/);
  assert.deepEqual(normalizeLandCriteria({
    county: 'Bexar', radiusMiles: '25', purpose: LAND_PURPOSES[0], zip: '78205', budgetMax: '250000',
    acresMin: '2', acresMax: '15',
  }), {
    county: 'Bexar', radiusMiles: 25, purpose: LAND_PURPOSES[0], zip: '78205', budgetMax: 250000, acresMin: 2, acresMax: 15,
  });
  for (const input of [
    { county: 'Unknown' }, { county: 'Bexar', radiusMiles: 200 },
    { purpose: 'Unverified zoning approved' }, { zip: '1234' },
    { zip: '123456' }, { budgetMax: '-1' }, { acresMin: 'NaN' },
    { acresMin: '10', acresMax: '3' }, { acresMax: 'Infinity' },
  ]) assert.throws(() => normalizeLandCriteria({ county: 'Bexar', ...input }));
});

test('session pipeline preserves county-qualified IDs and rejects unrelated data', () => {
  const board = createAcquisitionSession();
  const source = {
    county: 'Travis', parcelId: '000123', countyFips: '48453',
    property: { situsAddress: '100 TEST ST AUSTIN TX 78704', acres: 0 },
    owner: { name: 'SOURCE-REPORTED OWNER' },
    source: { provider: 'County GIS', recordCurrency: 'unverified' },
  };
  const a = board.add(source);
  assert.equal(a.key, 'Travis:000123');
  assert.equal(a.parcelId, '000123');
  assert.equal(a.acresReported, 0);
  assert.equal(a.recordCurrency, 'unverified');
  assert.equal(board.add(source), a, 'duplicate should not overwrite stage');
  assert.equal(board.move(a.key, 'Under Contract'), true);
  assert.equal(board.add(source).stage, 'Under Contract');
  assert.equal(board.move(a.key, 'Not a stage'), false);
  assert.equal(board.all().length, 1);
  assert.equal(board.all()[0].stage, 'Under Contract');
  assert.equal(board.remove(a.key), true);
  assert.equal(board.all().length, 0);
  assert.equal(board.add({ county: 'Other', parcelId: '1' }), null);
  assert.equal(acquisitionSnapshot({ county: 'Travis', parcelId: null }), null);
  assert.equal(ACQUISITION_STAGES.length, 6);
});

test('matching is advisory only: asking price and permitted use always unknown', () => {
  const criteria = normalizeLandCriteria({
    county: 'Travis', radiusMiles: 10, purpose: LAND_PURPOSES[1], zip: '78704',
    budgetMax: '1000000', acresMin: '1', acresMax: '5',
  });
  const entry = acquisitionSnapshot({
    county: 'Travis', parcelId: '303', property: { situsAddress: 'AUSTIN TX 78704', acres: 0 },
    valuation: { marketValue: 500000 },
  });
  const found = reviewLandCriteria(criteria, entry);
  assert.deepEqual(found.map((x) => x.status), [
    'reported-match', 'unknown', 'unknown', 'unknown',
  ]);
  const other = reviewLandCriteria(criteria, {
    ...entry, address: 'Other TX 78705', acresReported: 6,
  });
  assert.deepEqual(other.map((x) => x.status), [
    'reported-outside', 'reported-outside', 'unknown', 'unknown',
  ]);
  assert.ok(found.every((x) => !x.status.includes('verified')));
});

test('five-digit street numbers cannot masquerade as a source ZIP preference match', () => {
  const criteria = normalizeLandCriteria({ county: 'Travis', zip: '12345' });
  const entry = {
    address: '12345 Main Street Austin TX 78704',
    acresReported: null,
  };
  assert.equal(reviewLandCriteria(criteria, entry)[0].status, 'reported-outside');
  assert.equal(reviewLandCriteria(criteria, {
    ...entry, address: '12345 Main Street, Austin TX',
  })[0].status, 'unknown');
});

test('session snapshots cannot be mutated by changing source objects afterwards', () => {
  const parcel = { county: 'Bexar', parcelId: '77', property: { situsAddress: 'A', acres: 3 } };
  const board = createAcquisitionSession();
  const saved = board.add(parcel);
  parcel.property.situsAddress = 'Changed';
  parcel.parcelId = 'changed';
  assert.equal(saved.address, 'A');
  assert.equal(saved.parcelId, '77');
  assert.ok(Object.isFrozen(saved));
});
