import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEXAR_COUNTY_FIPS,
  buildBexarBoundsUrl,
  buildBexarParcelLookupUrl,
  normalizeBexarFeature,
} from './bexarAdapter.js';

test('normalizeBexarFeature maps BCAD fields into the BDP parcel contract', () => {
  const parcel = normalizeBexarFeature({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[-98.5, 29.4], [-98.49, 29.4], [-98.49, 29.41], [-98.5, 29.4]]],
    },
    properties: {
      OBJECTID: 12,
      PropID: 123456,
      AcctNumb: 'A-123456',
      Situs: '100 TEST RD',
      Owner: 'TEST OWNER LLC',
      AddrLn1: 'PO BOX 100',
      AddrCity: 'SAN ANTONIO',
      AddrSt: 'TX',
      Zip: '78205',
      LglDesc: 'TEST LEGAL DESCRIPTION',
      LandVal: 200000,
      ImprVal: 50000,
      TotVal: 250000,
      Acres: 10,
      TaxUnits: 'TEST',
      Exempts: '',
      PropUse: 'F1',
    },
  });

  assert.equal(parcel.countyFips, BEXAR_COUNTY_FIPS);
  assert.equal(parcel.parcelId, '123456');
  assert.equal(parcel.owner.name, 'TEST OWNER LLC');
  assert.equal(parcel.property.acres, 10);
  assert.equal(parcel.valuation.marketValue, 250000);
  assert.equal(parcel.acquisition.pricePerAcre, 25000);
  assert.equal(parcel.providerData.accountNumber, 'A-123456');
  assert.equal(parcel.property.geometry.type, 'Polygon');
});

test('parcel lookup URL uses the official ArcGIS query endpoint', () => {
  const url = new URL(buildBexarParcelLookupUrl('123456'));
  assert.equal(url.hostname, 'maps.bexar.org');
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.match(url.searchParams.get('where'), /PropID=123456/);
  assert.equal(url.searchParams.get('outSR'), '4326');
});

test('bounds query is WGS84 and capped at the ArcGIS service limit', () => {
  const url = new URL(buildBexarBoundsUrl({
    west: -98.6,
    south: 29.3,
    east: -98.4,
    north: 29.5,
    limit: 5000,
  }));
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.equal(url.searchParams.get('resultRecordCount'), '1000');
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
});
