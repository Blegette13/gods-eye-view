import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBdpLandSearch } from './landSearch.js';

test('parses explicit parcel and account commands', () => {
  assert.deepEqual(parseBdpLandSearch('parcel: 12345'), {
    kind: 'parcel',
    value: '12345',
    command: 'parcel',
  });
  assert.deepEqual(parseBdpLandSearch('acct ABC-77'), {
    kind: 'parcel',
    value: 'ABC-77',
    command: 'acct',
  });
});

test('parses explicit owner commands', () => {
  assert.deepEqual(parseBdpLandSearch('owner: Smith Holdings LLC'), {
    kind: 'owner',
    value: 'Smith Holdings LLC',
    command: 'owner',
  });
});

test('leaves ordinary God\'s Eye location searches untouched', () => {
  assert.equal(parseBdpLandSearch('Austin, TX'), null);
  assert.equal(parseBdpLandSearch('29.4241,-98.4936'), null);
  assert.equal(parseBdpLandSearch('78205'), null);
});

test('rejects empty or oversized land commands', () => {
  assert.equal(parseBdpLandSearch('parcel:'), null);
  assert.equal(parseBdpLandSearch(`parcel: ${'x'.repeat(65)}`), null);
  assert.equal(parseBdpLandSearch('owner: A'), null);
  assert.equal(parseBdpLandSearch(`owner: ${'x'.repeat(71)}`), null);
});
