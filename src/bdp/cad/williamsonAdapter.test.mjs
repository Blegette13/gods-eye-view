import assert from 'node:assert/strict';
import test from 'node:test';
import { WILLIAMSON_COUNTY_FIPS, WILLIAMSON_PARCEL_LAYER_URL, normalizeWilliamsonFeature,
  buildWilliamsonParcelLookupUrl, buildWilliamsonOwnerLookupUrl, buildWilliamsonBoundsUrl,
  williamsonCadAdapter } from './williamsonAdapter.js';

const geometry = { type: 'Polygon', coordinates: [[[-97.67,30.64],[-97.66,30.64],[-97.66,30.65],[-97.67,30.64]]] };
const feature = (properties) => ({ type: 'Feature', geometry, properties });

test('WCAD county GIS fields normalize with unverified currency and no invented sale', () => {
  const parcel = normalizeWilliamsonFeature(feature({ PropertyID: '00123', PropertyNumber: 'P-123', PARCELID: 'MAP-1',
    PrimaryOwner: 'OWNER LLC', MailingAddress: 'PO BOX 100', PropertyAddress: '1 TEST ST', LegalDesc: 'LOT 1', Acres: '12.5',
    TotalPropMktValue: 500000, TotalLandMktValue: 200000, TotalImpMktValue: 300000, TotalAssessedValue: 320000,
    DataDate: 'unverified' }));
  assert.equal(parcel.id, '48491:00123');
  assert.equal(parcel.countyFips, WILLIAMSON_COUNTY_FIPS);
  assert.equal(parcel.property.acres, 12.5);
  assert.equal(parcel.owner.name, 'OWNER LLC');
  assert.equal(parcel.valuation.marketValue, 500000);
  assert.equal(parcel.acquisition.askingPrice, null);
  assert.equal(parcel.acquisition.verifiedSalePrice, null);
  assert.equal(parcel.source.recordCurrency, 'unverified');
  assert.match(parcel.source.sourceNotice, /conflict/);
  assert.equal(parcel.providerData.mapParcelId, 'MAP-1');
});

test('unknown values and invalid geometry or identifiers cannot imply a clean parcel', () => {
  const parcel = normalizeWilliamsonFeature(feature({ PropertyID: '123', Acres: '', TotalPropMktValue: '', TotalLandMktValue: null }));
  assert.equal(parcel.property.acres, null);
  assert.equal(parcel.valuation.marketValue, null);
  assert.equal(parcel.acquisition.pricePerAcre, null);
  assert.equal(normalizeWilliamsonFeature({ properties: { PropertyID: '123' }, geometry: null }), null);
  assert.equal(normalizeWilliamsonFeature(feature({ PropertyID: null })), null);
});

test('official bounded GeoJSON queries escape owner text and validate bounds', () => {
  const parcel = new URL(buildWilliamsonParcelLookupUrl('00123'));
  assert.equal(parcel.pathname, `${new URL(WILLIAMSON_PARCEL_LAYER_URL).pathname}/query`);
  assert.equal(parcel.searchParams.get('where'), "PropertyID='00123'");
  assert.equal(parcel.searchParams.get('f'), 'geojson');
  assert.equal(parcel.searchParams.get('outSR'), '4326');
  const owner = new URL(buildWilliamsonOwnerLookupUrl("O'NEIL", { limit: 500 }));
  assert.equal(owner.searchParams.get('where'), "PrimaryOwner LIKE '%O''NEIL%'");
  assert.equal(owner.searchParams.get('resultRecordCount'), '251');
  const bounds = new URL(buildWilliamsonBoundsUrl({ west: -97.7, south: 30.6, east: -97.6, north: 30.7, limit: 5000 }));
  assert.equal(bounds.searchParams.get('inSR'), '4326');
  assert.equal(bounds.searchParams.get('resultRecordCount'), '1000');
  assert.throws(() => buildWilliamsonBoundsUrl({ west: -97.6, south: 30.6, east: -97.7, north: 30.7 }), /bounds/);
  assert.throws(() => buildWilliamsonOwnerLookupUrl('%'), /owner/);
  assert.throws(() => buildWilliamsonParcelLookupUrl("123' OR 1=1"), /ID/);
});

test('truncation, errors, missing polygons and duplicate identifiers fail the screen', async () => {
  const prior = globalThis.fetch;
  try {
    for (const data of [
      { type: 'FeatureCollection', features: Array(6).fill(feature({ PropertyID: '12' })) },
      { type: 'FeatureCollection', features: [], exceededTransferLimit: true },
      { error: { code: 498, message: 'token required' } },
      { type: 'FeatureCollection', features: [feature({ PropertyID: null })] },
      { type: 'FeatureCollection', features: [feature({ PropertyID: '12' }), feature({ PropertyID: '12' })] },
    ]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => data });
      await assert.rejects(williamsonCadAdapter.fetchParcel('12'), /bounded|truncated|missing|repeats/);
    }
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [feature({ PropertyID: '12' })] }) });
    assert.equal((await williamsonCadAdapter.fetchParcel('12')).id, '48491:12');
  } finally { globalThis.fetch = prior; }
});
