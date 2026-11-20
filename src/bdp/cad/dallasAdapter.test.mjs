import assert from 'node:assert/strict';
import test from 'node:test';
import { DALLAS_COUNTY_FIPS, DALLAS_PARCEL_LAYER_URL, normalizeDallasFeature,
  buildDallasParcelLookupUrl, buildDallasOwnerLookupUrl, buildDallasBoundsUrl,
  dallasCadAdapter } from './dallasAdapter.js';

const geometry = { type: 'Polygon', coordinates: [[[-96.96,32.61],[-96.95,32.61],[-96.95,32.62],[-96.96,32.61]]] };
const feature = (properties, shape = geometry) => ({ type: 'Feature', geometry: shape, properties });

test('DCAD published parcel and revaluation fields remain observations, not verified title or sale', () => {
  const parcel = normalizeDallasFeature(feature({ PARCELID: '16020870010190000', LOWPARCELID: '16020870010190000',
    OWNERNME1: 'OWNER ONE', OWNERNME2: 'OWNER TWO', SITEADDRESS: '575 PINNACLE DR',
    PRPRTYDSCRP: 'BLK 1 LT 19', STATEDAREA: '2.5 AC', LNDVALUE: 72000, IMPVALUE: 319400,
    CNTASSDVAL: 391400, LASTUPDATE: 1735208909000, REVALYR: 2026 }));
  assert.equal(parcel.id, '48113:16020870010190000');
  assert.equal(parcel.countyFips, DALLAS_COUNTY_FIPS);
  assert.equal(parcel.owner.name, 'OWNER ONE; OWNER TWO');
  assert.equal(parcel.property.acres, 2.5);
  assert.equal(parcel.valuation.marketValue, 391400);
  assert.equal(parcel.providerData.revaluationYear, 2026);
  assert.equal(parcel.source.recordCurrency, 'unverified');
  assert.equal(parcel.acquisition.askingPrice, null);
  assert.equal(parcel.acquisition.verifiedSalePrice, null);
});

test('missing or ambiguous acreage and appraisal values stay unknown', () => {
  const parcel = normalizeDallasFeature(feature({ PARCELID: '00123', STATEDAREA: '10000 SQ FT', CNTASSDVAL: '' }));
  assert.equal(parcel.property.acres, null);
  assert.equal(parcel.valuation.marketValue, null);
  assert.equal(parcel.acquisition.pricePerAcre, null);
  assert.equal(normalizeDallasFeature(feature({ PARCELID: '00123' }, null)), null);
  assert.equal(normalizeDallasFeature(feature({ PARCELID: 'ABC' })), null);
});

test('Dallas parcel, owner and viewport queries bound and escape source requests', () => {
  const parcel = new URL(buildDallasParcelLookupUrl('00123'));
  assert.equal(parcel.pathname, `${new URL(DALLAS_PARCEL_LAYER_URL).pathname}/query`);
  assert.equal(parcel.searchParams.get('where'), "PARCELID='00123'");
  assert.equal(parcel.searchParams.get('f'), 'geojson');
  const owner = new URL(buildDallasOwnerLookupUrl("O'NEIL", { limit: 500 }));
  assert.equal(owner.searchParams.get('where'), "OWNERNME1 LIKE '%O''NEIL%' OR OWNERNME2 LIKE '%O''NEIL%'");
  assert.equal(owner.searchParams.get('resultRecordCount'), '251');
  const bounds = new URL(buildDallasBoundsUrl({ west: -96.96, south: 32.61, east: -96.95, north: 32.62, limit: 5000 }));
  assert.equal(bounds.searchParams.get('inSR'), '4326');
  assert.equal(bounds.searchParams.get('resultRecordCount'), '1000');
  assert.throws(() => buildDallasBoundsUrl({ west: -96.95, south: 32.61, east: -96.96, north: 32.62 }), /bounds/);
  assert.throws(() => buildDallasOwnerLookupUrl('%'), /owner/);
  assert.throws(() => buildDallasParcelLookupUrl("123' OR 1=1"), /ID/);
});

test('capped, malformed and repeated DCAD features fail the screen', async () => {
  const prior = globalThis.fetch;
  try {
    for (const data of [
      { type: 'FeatureCollection', exceededTransferLimit: true, features: [feature({ PARCELID: '12' })] },
      { type: 'FeatureCollection', features: Array(6).fill(feature({ PARCELID: '12' })) },
      { type: 'FeatureCollection', features: [feature({ PARCELID: null })] },
      { type: 'FeatureCollection', features: [feature({ PARCELID: '12' }), feature({ PARCELID: '12' })] },
    ]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => data });
      await assert.rejects(dallasCadAdapter.fetchParcel('12'), /truncated|bounded|missing|repeated/);
    }
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection',
      features: [feature({ PARCELID: '12', REVALYR: 2026 })] }) });
    assert.equal((await dallasCadAdapter.fetchParcel('12')).id, '48113:12');
  } finally { globalThis.fetch = prior; }
});
