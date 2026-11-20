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

test('Harris parcel/account/owner commands keep leading zeros and county routing', () => {
  for (const command of ['parcel', 'account']) {
    assert.deepEqual(parseBdpLandSearch(`HARRIS ${command}: 0402810000356`), {
      kind: 'parcel', value: '0402810000356', command, county: 'Harris',
    });
  }
  assert.deepEqual(parseBdpLandSearch('harris owner: Lakewood Development'), {
    kind: 'owner', value: 'Lakewood Development', command: 'owner', county: 'Harris',
  });
});

test('county-prefixed commands route Travis and preserve Bexar defaults', () => {
  assert.deepEqual(parseBdpLandSearch('TRAVIS parcel: 12345'), {
    kind: 'parcel', value: '12345', command: 'parcel', county: 'Travis',
  });
  assert.deepEqual(parseBdpLandSearch('bexar owner: Smith LLC'), {
    kind: 'owner', value: 'Smith LLC', command: 'owner', county: 'Bexar',
  });
  assert.deepEqual(parseBdpLandSearch('Williamson owner: Smith LLC'), {
    kind: 'owner', value: 'Smith LLC', command: 'owner', county: 'Williamson',
  });
  assert.deepEqual(parseBdpLandSearch('Hays parcel: 10003'), {
    kind: 'parcel', value: '10003', command: 'parcel', county: 'Hays',
  });
  assert.deepEqual(parseBdpLandSearch('dallas owner: Smith LLC'), {
    kind: 'owner', value: 'Smith LLC', command: 'owner', county: 'Dallas',
  });
  assert.equal(parseBdpLandSearch('Collin parcel: 123'), null);
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
