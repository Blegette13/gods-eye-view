import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyParcel, normalizeParcel, validateParcel } from './parcelSchema.js';

test('createEmptyParcel returns the canonical BDP parcel shape', () => {
  const parcel = createEmptyParcel();
  assert.equal(parcel.property.acres, null);
  assert.equal(parcel.valuation.marketValue, null);
  assert.equal(parcel.acquisition.askingPrice, null);
  assert.equal(parcel.source.lastVerified, '');
  assert.equal(parcel.source.recordCurrency, 'unknown');
  assert.equal(parcel.source.sourceNotice, '');
});

test('normalizeParcel coerces numeric fields and derives a stable id', () => {
  const parcel = normalizeParcel({
    parcelId: 'R12345',
    county: 'Bexar',
    countyFips: '029',
    property: { acres: '42.5' },
    valuation: { marketValue: '1000000' },
    source: {
      recordCurrency: 'UNVERIFIED',
      sourceNotice: ' Verify source freshness. ',
    },
  });

  assert.equal(parcel.id, '029:R12345');
  assert.equal(parcel.property.acres, 42.5);
  assert.equal(parcel.valuation.marketValue, 1000000);
  assert.equal(parcel.jurisdiction.county, 'Bexar');
  assert.equal(parcel.source.recordCurrency, 'unverified');
  assert.equal(parcel.source.sourceNotice, 'Verify source freshness.');
  assert.deepEqual(validateParcel(parcel), []);
});

test('validateParcel reports missing core identity', () => {
  const errors = validateParcel(createEmptyParcel());
  assert.ok(errors.includes('parcelId is required'));
  assert.ok(errors.includes('county is required'));
});
