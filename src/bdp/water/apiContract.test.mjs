import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BDP_WATER_API_BASE,
  buildTceqParcelWaterSql,
  normalizeWaterParcelRequest,
} from './apiContract.js';

const request = {
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

test('TCEQ water API stays inside BDP namespace', () => {
  assert.equal(BDP_WATER_API_BASE, '/api/bdp/water');
});

test('normalizes parcel geometry for TCEQ water screening', () => {
  const result = normalizeWaterParcelRequest(request);
  assert.equal(result.geometry.type, 'Polygon');
  assert.ok(result.bounds.west < result.bounds.east);
});

test('builds parcel-water metrics query through the validated PostGIS function', () => {
  const sql = buildTceqParcelWaterSql(request);
  assert.match(sql, /bdp_tceq_parcel_water_metrics/);
  assert.match(sql, /ST_GeomFromGeoJSON/);
});
