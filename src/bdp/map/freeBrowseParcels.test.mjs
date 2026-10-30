import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldDiscoverFreeParcels, FREE_BROWSE_PARCEL_HEIGHT_METERS,
  freeBrowseCountyUrl, countyFromFreeBrowseResponse,
  freeBrowseVisibleParcels,
} from './freeBrowseParcels.js';

const county = (name, geoid) => ({
  type: 'Feature',
  properties: { NAME: name, GEOID: geoid, STATE: '48' },
  geometry: { type: 'Polygon', coordinates: [[
    [-97.8, 30.2], [-97.7, 30.2], [-97.7, 30.3], [-97.8, 30.2],
  ]] },
});
const fc = (features) => ({ type: 'FeatureCollection', features });

test('free parcel activation is a 1.3km camera-height gate, not a county requirement', () => {
  assert.equal(FREE_BROWSE_PARCEL_HEIGHT_METERS, 1300);
  assert.equal(shouldDiscoverFreeParcels(1299), true);
  assert.equal(shouldDiscoverFreeParcels(1300), true);
  assert.equal(shouldDiscoverFreeParcels(1301), false);
  assert.equal(shouldDiscoverFreeParcels(2700), false);
  assert.equal(shouldDiscoverFreeParcels(NaN), false);
  assert.equal(shouldDiscoverFreeParcels(null), false);
  assert.equal(shouldDiscoverFreeParcels(-1), false);
});

test('county source lookup uses actual camera point, not invented county selection', () => {
  const url = new URL(freeBrowseCountyUrl({ lat: 30.27, lon: -97.74 }));
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryPoint');
  assert.equal(url.searchParams.get('resultRecordCount'), '2');
  const point = JSON.parse(url.searchParams.get('geometry'));
  assert.deepEqual([point.x, point.y], [-97.74, 30.27]);
  assert.equal(freeBrowseCountyUrl({lat: 0, lon: 0}), null);
  assert.equal(countyFromFreeBrowseResponse(fc([county('Travis','48453')])), 'Travis');
  assert.equal(countyFromFreeBrowseResponse(fc([county('Unknown','48999')])), null);
  assert.equal(countyFromFreeBrowseResponse(fc([
    county('Travis','48453'), county('Bexar','48029'),
  ])), null, 'border ambiguity must fail closed');
  assert.throws(() => countyFromFreeBrowseResponse({error:'provider down'}));
});

test('list includes every distinct identifiable parcel in a complete loaded map view', () => {
  const polygon = county('Travis','48453').geometry;
  const make = (parcelId, acres) => ({
    county: 'Travis', parcelId,
    property: { geometry:polygon, situsAddress:'123 Source Road', acres },
  });
  const rows = freeBrowseVisibleParcels({
    county:'Travis', reason:'complete', complete:true,
    parcels: [make('00001', 0.3), make('A-12', null), make('00001', 0.3)],
  });
  assert.equal(rows.count, 2);
  assert.equal(rows.complete, true);
  assert.equal(rows.rows[0].parcelId, '00001');
  assert.equal(rows.rows[1].parcelId, 'A-12');
  assert.equal(rows.rows[1].acresReported, null);
  assert.match(rows.message, /NOT verified for sale/);
});

test('partial county data is always labeled incomplete; no viewport produces no false zero', () => {
  const missing = freeBrowseVisibleParcels({
    county:'Travis', parcels:[], reason:'over-limit', complete:false,
  });
  assert.equal(missing.count, null);
  const partial = freeBrowseVisibleParcels({
    county:'Travis', parcels: [{
      county:'Travis',parcelId:'901',
      property:{geometry:county('Travis','48453').geometry,acres:1},
    }], reason:'partial',complete:false,
  });
  assert.equal(partial.count, 1);
  assert.equal(partial.complete, false);
  assert.match(partial.message, /PARTIAL source coverage/);
});
