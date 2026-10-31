import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveBdpRedFlags } from '../intelligence/redFlags.js';
import { HAYS_COUNTY_FIPS, HAYS_PARCEL_LAYER_URL, normalizeHaysFeature,
  buildHaysParcelLookupUrl, buildHaysOwnerLookupUrl, buildHaysBoundsUrl,
  haysCadAdapter } from './haysAdapter.js';

const geometry = { type: 'Polygon', coordinates: [[[-97.86,30.08],[-97.85,30.08],[-97.85,30.09],[-97.86,30.08]]] };
const feature = (properties, shape = geometry) => ({ type: 'Feature', geometry: shape, properties });

test('Hays public CAD copy is selectable while 2022 records stay stale and unverified', () => {
  const parcel = normalizeHaysFeature(feature({ Prop_ID: '10003', FIPS: '48209', OWNER_NAME: 'OWNER LP',
    LEGAL_AREA: 5.584, LGL_AREA_U: 'Acres', LEGAL_DESC: 'TRACT 1', MKT_VALUE: 900000,
    LAND_VALUE: 800000, IMP_VALUE: 100000, TAX_YEAR: 2022, DATE_ACQ: 202202 }));
  assert.equal(parcel.id, '48209:10003');
  assert.equal(parcel.countyFips, HAYS_COUNTY_FIPS);
  assert.equal(parcel.property.acres, 5.584);
  assert.equal(parcel.owner.name, 'OWNER LP');
  assert.equal(parcel.providerData.taxYear, 2022);
  assert.equal(parcel.source.recordCurrency, 'stale');
  assert.match(parcel.source.sourceNotice, /2022/);
  assert.equal(parcel.acquisition.verifiedSalePrice, null);
  assert.equal(parcel.acquisition.askingPrice, null);
  const currencyFlag = deriveBdpRedFlags({ parcel }).find((flag) => flag.id === 'parcel-source-currency-unverified');
  assert.equal(currencyFlag.severity, 'high');
  assert.equal(currencyFlag.evidence.recordCurrency, 'stale');
});

test('unknown acreage units and missing values cannot become zero or fabricated acres', () => {
  const parcel = normalizeHaysFeature(feature({ Prop_ID: '12', LEGAL_AREA: 10, LGL_AREA_U: 'square feet', MKT_VALUE: '' }));
  assert.equal(parcel.property.acres, null);
  assert.equal(parcel.valuation.marketValue, null);
  assert.equal(parcel.acquisition.pricePerAcre, null);
  assert.equal(normalizeHaysFeature(feature({ Prop_ID: '12', FIPS: '48029' })), null);
  assert.equal(normalizeHaysFeature(feature({ Prop_ID: '12' }, null)), null);
});

test('Hays lookup, owner and viewport queries are bounded and escaped', () => {
  const parcel = new URL(buildHaysParcelLookupUrl('00123'));
  assert.equal(parcel.pathname, `${new URL(HAYS_PARCEL_LAYER_URL).pathname}/query`);
  assert.equal(parcel.searchParams.get('where'), "Prop_ID='00123'");
  assert.equal(parcel.searchParams.get('f'), 'geojson');
  const owner = new URL(buildHaysOwnerLookupUrl("O'NEIL", { limit: 500 }));
  assert.equal(owner.searchParams.get('where'), "OWNER_NAME LIKE '%O''NEIL%'");
  assert.equal(owner.searchParams.get('resultRecordCount'), '251');
  const bounds = new URL(buildHaysBoundsUrl({ west: -97.9, south: 30, east: -97.8, north: 30.1, limit: 5000 }));
  assert.equal(bounds.searchParams.get('inSR'), '4326');
  assert.equal(bounds.searchParams.get('resultRecordCount'), '1000');
  assert.throws(() => buildHaysBoundsUrl({ west: -97.8, south: 30, east: -97.9, north: 30.1 }), /bounds/);
  assert.throws(() => buildHaysOwnerLookupUrl('%'), /owner/);
  assert.throws(() => buildHaysParcelLookupUrl("123' OR 1=1"), /ID/);
});

test('GeoJSON transfer limits, county conflicts and repeated IDs fail rather than show a subset', async () => {
  const prior = globalThis.fetch;
  try {
    for (const data of [
      { type: 'FeatureCollection', properties: { exceededTransferLimit: true }, features: [feature({ Prop_ID: '12' })] },
      { type: 'FeatureCollection', features: Array(6).fill(feature({ Prop_ID: '12' })) },
      { type: 'FeatureCollection', features: [feature({ Prop_ID: '12', FIPS: '48453' })] },
      { type: 'FeatureCollection', features: [feature({ Prop_ID: '12' }), feature({ Prop_ID: '12' })] },
    ]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => data });
      await assert.rejects(haysCadAdapter.fetchParcel('12'), /truncated|bounded|conflicting|repeated/);
    }
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection',
      features: [feature({ Prop_ID: '12', FIPS: '48209', TAX_YEAR: 2022 })] }) });
    assert.equal((await haysCadAdapter.fetchParcel('12')).id, '48209:12');
  } finally { globalThis.fetch = prior; }
});
