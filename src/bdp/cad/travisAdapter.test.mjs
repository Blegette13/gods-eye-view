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
  // TCAD_Travis_County_Property is only the county-owned subset, not all Travis parcels.
  assert.match(TRAVIS_PARCEL_LAYER_URL, /\/TCAD\/MapServer\/0$/);
  assert.doesNotMatch(TRAVIS_PARCEL_LAYER_URL, /TCAD_Travis_County_Property/);
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

test('viewport keeps identifiable Travis parcels visible but reports every unidentified polygon', async () => {
  const prior = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      type: 'FeatureCollection',
      features: [feature({ PROP_ID: 10 }), feature({ PROP_ID: null }), feature({ PROP_ID: 11 })],
    }) });
    const parcels = await travisCadAdapter.fetchParcelsInBounds({ west: -97.8, south: 30.2, east: -97.7, north: 30.3 });
    assert.deepEqual(parcels.map((parcel) => parcel.parcelId), ['10', '11']);
    assert.deepEqual(parcels.viewportCoverage, { receivedCount: 3, omittedUnidentified: 1 });
    assert.equal(Object.keys(parcels).includes('viewportCoverage'), false);
    await assert.rejects(travisCadAdapter.fetchParcelsByOwner('SMITH'), /missing or invalid property ID/);
  } finally {
    globalThis.fetch = prior;
  }
});

test('viewport fails closed for malformed shapes and duplicate IDs', async () => {
  const prior = globalThis.fetch;
  const bounds = { west: -97.8, south: 30.2, east: -97.7, north: 30.3 };
  try {
    for (const features of [
      [feature({ PROP_ID: 1 }), { ...feature({ PROP_ID: null }), geometry: null }],
      [feature({ PROP_ID: 1 }), feature({ PROP_ID: 1 })],
    ]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features }) });
      await assert.rejects(travisCadAdapter.fetchParcelsInBounds(bounds), /geometry|repeats/);
    }
  } finally {
    globalThis.fetch = prior;
  }
});

test('dense Travis viewport remains explicitly incomplete rather than disabling the parcel service', async () => {
  const prior = globalThis.fetch;
  const bounds = { west: -97.8, south: 30.2, east: -97.7, north: 30.3 };
  try {
    for (const result of [
      { type: 'FeatureCollection', features: [feature({ PROP_ID: 1 })], exceededTransferLimit: true },
      { type: 'FeatureCollection', features: Array.from({ length: 4 },
        (_, index) => feature({ PROP_ID: 50 + index })) },
    ]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => result });
      const parcels = await travisCadAdapter.fetchParcelsInBounds(bounds, { limit: 3 });
      assert.equal(parcels.length, 0, 'never render a capped source subset as a complete map');
      assert.equal(parcels.viewportCoverage.overLimit, true);
      assert.equal(parcels.viewportCoverage.receivedCount, result.features.length);
      assert.equal(parcels.viewportCoverage.omittedUnidentified, 0);
      assert.equal(Object.keys(parcels).includes('viewportCoverage'), false);
    }
    // Exact-ID source requests MUST NOT accept capped results as complete.
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      type: 'FeatureCollection', features: [feature({ PROP_ID: 12 })],
      exceededTransferLimit: true,
    }) });
    await assert.rejects(travisCadAdapter.fetchParcel('12'), /truncated/);
  } finally {
    globalThis.fetch = prior;
  }
});

test('malformed county source responses remain unavailable instead of inventing zero parcels', async () => {
  const prior = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      error: { code: 498, message: 'restricted' },
    }) });
    await assert.rejects(travisCadAdapter.fetchParcelsInBounds({
      west: -97.8, south: 30.2, east: -97.7, north: 30.3,
    }), /malformed.*498/);
  } finally {
    globalThis.fetch = prior;
  }
});

test('dense Travis viewport retries 4 bounded county GIS tiles and renders a complete deduplicated set', async () => {
  const prior = globalThis.fetch;
  const bounds = { west:-97.8, south:30.2, east:-97.7, north:30.3 };
  const requests = [];
  try {
    globalThis.fetch = async (url) => {
      const qs = new URL(url).searchParams;
      assert.equal(qs.get('geometryType'), 'esriGeometryEnvelope');
      assert.equal(qs.get('f'), 'geojson');
      const area = qs.get('geometry').split(',').map(Number);
      requests.push(area);
      if (requests.length === 1) {
        return { ok:true, json:async()=>({
          type:'FeatureCollection', features:[feature({PROP_ID:1})],
          exceededTransferLimit:true,
        }) };
      }
      const tileNumber = requests.length - 1;
      return { ok:true, json:async()=>({
        type:'FeatureCollection',
        features: [feature({PROP_ID:9000}), feature({PROP_ID:8000+tileNumber})],
      }) };
    };
    const parcels = await travisCadAdapter.fetchParcelsInBounds(bounds, {limit:500});
    assert.deepEqual(parcels.map((x)=>x.parcelId),['9000','8001','8002','8003','8004']);
    assert.equal(parcels.viewportCoverage.tiled, true);
    assert.equal(parcels.viewportCoverage.tileQueries, 4);
    assert.equal(parcels.viewportCoverage.receivedCount, 8);
    assert.equal(parcels.viewportCoverage.omittedUnidentified, 0);
    assert.equal(requests.length, 5);
    assert.equal(Object.keys(parcels).includes('viewportCoverage'), false);
  } finally { globalThis.fetch = prior; }
});

test('an unresolved dense viewport fails closed after bounded child queries', async () => {
  const prior = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return { ok:true, json:async()=>({
        type:'FeatureCollection', features:[feature({PROP_ID:1})],
        exceededTransferLimit:true,
      }) };
    };
    const incomplete = await travisCadAdapter.fetchParcelsInBounds({
      west:-97.8,south:30.2,east:-97.7,north:30.3,
    },{limit:500});
    assert.equal(incomplete.length,0);
    assert.equal(incomplete.viewportCoverage.overLimit,true);
    assert.equal(incomplete.viewportCoverage.tileAttempted,true);
    assert.match(incomplete.viewportCoverage.tileFailureReason,/truncated/);
    assert.ok(calls <= 21, 'one initial query and at most twenty child tiles');
  } finally { globalThis.fetch = prior; }
});

test('high-altitude Free Explorer recovers bounded CENTRAL parcels without asserting full-screen coverage', async () => {
  const prior = globalThis.fetch;
  const full = { west: -97.8, south: 30.2, east: -97.7, north: 30.3 };
  let requests = 0;
  let centerEnvelope = null;
  try {
    globalThis.fetch = async (url) => {
      requests++;
      const bounds = new URL(url).searchParams.get('geometry').split(',').map(Number);
      if (requests === 1) return { ok:true, json:async()=>({
        type:'FeatureCollection', features:[feature({PROP_ID:999})],
        exceededTransferLimit:true,
      }) };
      centerEnvelope = bounds;
      return { ok:true, json:async()=>({
        type:'FeatureCollection', features:[feature({PROP_ID:111}),feature({PROP_ID:222})],
      }) };
    };
    const parcels = await travisCadAdapter.fetchParcelsInBounds(full, {
      limit:500, focusOnDense:true,
    });
    assert.equal(requests, 2);
    assert.deepEqual(parcels.map((p)=>p.parcelId),['111','222']);
    assert.equal(parcels.viewportCoverage.focalOnly,true);
    assert.equal(parcels.viewportCoverage.receivedCount,2);
    assert.ok(parcels.viewportCoverage.focalBounds);
    const half = parcels.viewportCoverage.focalBounds;
    assert.deepEqual(centerEnvelope,[half.west,half.south,half.east,half.north]);
    assert.ok(half.west > full.west && half.east < full.east);
    assert.ok(half.south > full.south && half.north < full.north);
    assert.equal(parcels.viewportCoverage.overLimit,undefined);
  } finally { globalThis.fetch = prior; }
});

test('capped central footprint still reports UNKNOWN instead of a falsely complete zoomed-out parcel inventory', async () => {
  const prior = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async () => {
      requests++;
      return {ok:true,json:async()=>({
        type:'FeatureCollection',features:[feature({PROP_ID:13})],exceededTransferLimit:true,
      })};
    };
    const results = await travisCadAdapter.fetchParcelsInBounds({
      west:-97.8,south:30.2,east:-97.7,north:30.3,
    },{limit:500,focusOnDense:true});
    assert.equal(results.length,0);
    assert.equal(results.viewportCoverage.overLimit,true);
    assert.equal(results.viewportCoverage.attemptedCentralFootprint,true);
    assert.ok(requests <= 22);
  } finally {globalThis.fetch=prior;}
});
