import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTceqMswFeaturesSql,
  buildTceqMswParcelSql,
  normalizeTceqMswBounds,
} from './mswContract.js';

const parcel = {
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-98.5, 29.4],
      [-98.49, 29.4],
      [-98.49, 29.41],
      [-98.5, 29.41],
      [-98.5, 29.4],
    ]],
  },
};

test('TCEQ MSW viewport bounds are finite, ordered and capped', () => {
  const bounds = normalizeTceqMswBounds({
    west: -98.6,
    south: 29.3,
    east: -98.4,
    north: 29.5,
  });
  assert.equal(bounds.west, -98.6);
  assert.throws(
    () => normalizeTceqMswBounds({ west: -100, south: 28, east: -90, north: 35 }),
    /viewport/i,
  );
});

test('TCEQ MSW feature SQL preserves dataset/status context', () => {
  const sql = buildTceqMswFeaturesSql({
    west: -98.6,
    south: 29.3,
    east: -98.4,
    north: 29.5,
  });
  assert.match(sql, /bdp_tceq_msw_sites/);
  assert.match(sql, /physicalStatus/);
  assert.match(sql, /boundaryInferred/);
});

test('TCEQ MSW parcel SQL calls the validated PostGIS metrics function', () => {
  const sql = buildTceqMswParcelSql(parcel);
  assert.match(sql, /bdp_tceq_parcel_msw_metrics/);
  assert.match(sql, /ST_GeomFromGeoJSON/);
});
