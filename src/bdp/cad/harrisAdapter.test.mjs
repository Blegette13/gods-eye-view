import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeHarrisFeature, buildHarrisParcelLookupUrl, buildHarrisOwnerLookupUrl,
  buildHarrisBoundsUrl, harrisCadAdapter } from './harrisAdapter.js';

const geometry = { type: 'Polygon', coordinates: [[[-95.11,29.91],[-95.10,29.91],[-95.10,29.92],[-95.11,29.91]]] };
const feature = (properties, shape = geometry) => ({ type: 'Feature', properties, geometry: shape });
const id = '0402810000356';

test('Harris published account, tax year and acreage remain unverified source observations', () => {
  const parcel = normalizeHarrisFeature(feature({ HCAD_NUM: id, acct_num: id, site_county: 'HARRIS',
    owner_name_1: 'OWNER ONE', owner_name_2: 'OWNER TWO', owner_name_3: 'OWNER ONE',
    mail_addr_1: '123 MAIN ST', mail_city: 'HOUSTON', mail_state: 'TX', mail_zip: '77009',
    site_str_num: 0, site_str_name: 'DIAMONDHEAD', site_str_sfx: 'BLVD', site_city: 'CROSBY',
    Acreage: '992.8000 AC', tax_year: '2026', land_value: 2586462, total_market_val: 2744877,
    total_appraised_val: 277551, Stacked: 1, CONDO_FLAG: '1', legal_dscr_1: 'TR 1', legal_dscr_2: 'ABST 37' }));
  assert.equal(parcel.id, `48201:${id}`);
  assert.equal(parcel.owner.name, 'OWNER ONE; OWNER TWO');
  assert.equal(parcel.owner.mailingAddress, '123 MAIN ST HOUSTON TX 77009');
  assert.equal(parcel.property.situsAddress, 'DIAMONDHEAD BLVD CROSBY');
  assert.equal(parcel.property.legalDescription, 'TR 1 ABST 37');
  assert.equal(parcel.property.acres, 992.8);
  assert.equal(parcel.valuation.marketValue, 2744877);
  assert.equal(parcel.valuation.assessedValue, null);
  assert.equal(parcel.providerData.publishedAppraisedValue, 277551);
  assert.equal(parcel.providerData.taxYear, 2026);
  assert.equal(parcel.providerData.stacked, 1);
  assert.equal(parcel.source.recordCurrency, 'unverified');
  assert.match(parcel.source.sourceNotice, /share geometry/);
  assert.equal(parcel.acquisition.askingPrice, null);
  assert.equal(parcel.acquisition.verifiedSalePrice, null);
});

test('unknown units, invalid numbers and conflicting source identifiers fail closed', () => {
  for (const acreage of [undefined, '', '10000 SQ FT', '992.8', false]) {
    assert.equal(normalizeHarrisFeature(feature({ HCAD_NUM: id, Acreage: acreage })).property.acres, null);
  }
  assert.equal(normalizeHarrisFeature(feature({ HCAD_NUM: id, total_market_val: false })).valuation.marketValue, null);
  assert.equal(normalizeHarrisFeature(feature({ HCAD_NUM: id, acct_num: '0402810000357' })), null);
  assert.equal(normalizeHarrisFeature(feature({ HCAD_NUM: id, site_county: 'HAYS' })), null);
  assert.equal(normalizeHarrisFeature(feature({ HCAD_NUM: '12' })), null);
  assert.equal(normalizeHarrisFeature(feature({ HCAD_NUM: id }, null)), null);
});

test('Harris queries bound results, escape owners and preserve exact account IDs', () => {
  const parcel = new URL(buildHarrisParcelLookupUrl(id));
  assert.equal(parcel.searchParams.get('where'), `HCAD_NUM='${id}'`);
  assert.equal(parcel.searchParams.get('outSR'), '4326');
  const owner = new URL(buildHarrisOwnerLookupUrl("O'NEIL", { limit: 1000 }));
  assert.equal(owner.searchParams.get('resultRecordCount'), '251');
  assert.match(owner.searchParams.get('where'), /owner_name_3 LIKE '%O''NEIL%'/);
  assert.throws(() => buildHarrisParcelLookupUrl("123' OR 1=1"), /13 digits/);
  assert.throws(() => buildHarrisOwnerLookupUrl('%'), /owner/);
  for (const invalid of [null, '', false, -181]) {
    assert.throws(() => buildHarrisBoundsUrl({ west: invalid, south: 29, east: -95, north: 30 }), /bounds/);
  }
  const bounds = new URL(buildHarrisBoundsUrl({ west: -95.2, south: 29.8, east: -95.1, north: 29.9, limit: 2000 }));
  assert.equal(bounds.searchParams.get('resultRecordCount'), '1000');
});

test('partial, capped, invalid and repeated Harris results cannot be screened', async () => {
  const prior = globalThis.fetch;
  try {
    for (const data of [
      { type: 'FeatureCollection', exceededTransferLimit: true, features: [] },
      { type: 'FeatureCollection', properties: { exceededTransferLimit: true }, features: [] },
      { type: 'FeatureCollection', data: { properties: { exceededTransferLimit: true } }, features: [] },
      { type: 'FeatureCollection', features: [feature({ HCAD_NUM: id }, null)] },
      { type: 'FeatureCollection', features: [feature({ HCAD_NUM: id }), feature({ HCAD_NUM: id })] },
      { type: 'FeatureCollection', features: Array(6).fill(feature({ HCAD_NUM: id })) },
    ]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => data });
      await assert.rejects(harrisCadAdapter.fetchParcel(id), /truncated|invalid|bounded/);
    }
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection',
      features: [feature({ HCAD_NUM: id, tax_year: '2026' })] }) });
    assert.equal((await harrisCadAdapter.fetchParcel(id)).providerData.taxYear, 2026);
    assert.equal((await harrisCadAdapter.fetchParcelsByOwner('OWNER'))[0].parcelId, id);
  } finally { globalThis.fetch = prior; }
});
