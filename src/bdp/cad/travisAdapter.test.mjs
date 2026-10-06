import assert from 'node:assert/strict';
import test from 'node:test';
import { TRAVIS_COUNTY_FIPS, TRAVIS_PARCEL_LAYER_URL,
  normalizeTravisFeature, buildTravisParcelLookupUrl, buildTravisOwnerLookupUrl,
  buildTravisBoundsUrl, travisCadAdapter } from './travisAdapter.js';

const geometry = { type: 'Polygon', coordinates: [[[-97.75,30.25],[-97.74,30.25],[-97.74,30.26],[-97.75,30.25]]] };
const feature = (properties) => ({ type: 'Feature', geometry, properties });

test('TCAD GIS records normalize to the shared parcel schema without legal or market inferences', () => {
  const parcel = normalizeTravisFeature(feature({ PROP_ID: 12345, geo_id: 'ABC-01', py_owner_name: 'CAD OWNER LLC',
    py_address: 'PO BOX 100', situs_address: '100 TEST ST', tcad_acres: 12.5, GIS_acres: 13,
    legal_desc: 'LOT TEST', market_value: 500000, assessed_val: 300000, appraised_val: 450000,
    land_homesite_val: 100000, land_non_homesite_val: '25000', imprv_homesite_val: 300000,
    imprv_non_homesite_val: 20000, deed_num: 'VOL 9', deed_date: 1700000000000 }));
  assert.equal(parcel.id, '48453:12345');
  assert.equal(parcel.countyFips, TRAVIS_COUNTY_FIPS);
  assert.equal(parcel.property.acres, 12.5);
  assert.equal(parcel.owner.name, 'CAD OWNER LLC');
  assert.equal(parcel.valuation.landValue, 125000);
  assert.equal(parcel.valuation.improvementValue, 320000);
  assert.equal(parcel.valuation.marketValue, 500000);
  assert.equal(parcel.acquisition.verifiedSalePrice, null);
  assert.equal(parcel.acquisition.askingPrice, null);
  assert.equal(parcel.source.recordCurrency, 'unverified');
  assert.match(parcel.source.sourceNotice, /recorded title/);
  assert.equal(parcel.providerData.deedNumber, 'VOL 9');
});

test('blank appraisal values remain unknown, including only GIS acreage', () => {
  const parcel = normalizeTravisFeature(feature({ PROP_ID: 456, tcad_acres: null, GIS_acres: 3,
    market_value: '', assessed_val: null, imprv_homesite_val: null, imprv_non_homesite_val: '',
    land_homesite_val: 'invalid', land_non_homesite_val: null }));
  assert.equal(parcel.property.acres, 3);
  assert.equal(parcel.valuation.marketValue, null);
  assert.equal(parcel.valuation.landValue, null);
  assert.equal(parcel.valuation.improvementValue, null);
  assert.equal(parcel.acquisition.pricePerAcre, null);
  assert.equal(normalizeTravisFeature(feature({ PROP_ID: 0 })).property.acres, null);
  assert.equal(normalizeTravisFeature({ properties: { PROP_ID: 7 }, geometry: null }), null);
});

test('county queries use official GeoJSON WGS84 service and bound results', () => {
  const parcel = new URL(buildTravisParcelLookupUrl('12345'));
  assert.equal(parcel.pathname, `${new URL(TRAVIS_PARCEL_LAYER_URL).pathname}/query`);
  assert.equal(parcel.searchParams.get('where'), "PROP_ID=12345 OR geo_id='12345'");
  assert.equal(parcel.searchParams.get('f'), 'geojson');
  assert.equal(parcel.searchParams.get('outSR'), '4326');
  const owner = new URL(buildTravisOwnerLookupUrl("O'NEIL", { limit: 500 }));
  assert.equal(owner.searchParams.get('where'), "py_owner_name LIKE '%O''NEIL%'");
  assert.equal(owner.searchParams.get('resultRecordCount'), '251');
  const bounds = new URL(buildTravisBoundsUrl({ west: -97.8, south: 30.2, east: -97.7, north: 30.3, limit: 5000 }));
  assert.equal(bounds.searchParams.get('inSR'), '4326');
  assert.equal(bounds.searchParams.get('resultRecordCount'), '1000');
  assert.throws(() => buildTravisBoundsUrl({ west: -97.7, south: 30.2, east: -97.8, north: 30.3 }), /bounds/);
  assert.throws(() => buildTravisOwnerLookupUrl('%'), /owner/);
  assert.throws(() => buildTravisParcelLookupUrl("123' OR 1=1"), /ID/);
});

test('capped, error and malformed responses fail instead of returning a safe-looking subset', async () => {
  const prior = globalThis.fetch;
  try {
    for (const data of [
      { type: 'FeatureCollection', features: Array(6).fill(feature({ PROP_ID: 12 })) },
      { type: 'FeatureCollection', features: [], exceededTransferLimit: true },
      { error: { code: 498, message: 'token required' } },
      { type: 'FeatureCollection', features: [feature({ PROP_ID: null })] },
      { type: 'FeatureCollection', features: [feature({ PROP_ID: 12 }), feature({ PROP_ID: 12 })] },
    ]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => data });
      await assert.rejects(travisCadAdapter.fetchParcel('12'), /bounded|truncated|missing|repeats/);
    }
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [feature({ PROP_ID: 12 })] }) });
    assert.equal((await travisCadAdapter.fetchParcel('12')).id, '48453:12');
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [
      feature({ PROP_ID: 21, geo_id: '12' }), feature({ PROP_ID: 12, geo_id: 'other' }),
    ] }) });
    assert.equal((await travisCadAdapter.fetchParcel('12')).id, '48453:12');
  } finally {
    globalThis.fetch = prior;
  }
});
