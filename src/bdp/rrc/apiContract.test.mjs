import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRrcEnergySql,
  buildRrcFeaturesSql,
  normalizeRrcBounds,
  normalizeRrcParcelRequest,
} from './apiContract.js';

test('normalizes a bounded Bexar viewport', () => {
  const bounds = normalizeRrcBounds({
    west: -98.6,
    south: 29.35,
    east: -98.45,
    north: 29.5,
  });

  assert.equal(bounds.west, -98.6);
  assert.equal(bounds.north, 29.5);
  assert.throws(() => normalizeRrcBounds({
    west: -99,
    south: 29,
    east: -98,
    north: 30,
  }), /viewport/);
});

test('accepts polygon geometry and normalizes Texas county FIPS', () => {
  const request = normalizeRrcParcelRequest({
    countyFips: '48029',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-98.5, 29.4],
        [-98.49, 29.4],
        [-98.49, 29.41],
        [-98.5, 29.4],
      ]],
    },
  });

  assert.equal(request.countyFips, '029');
  assert.equal(request.geometry.type, 'Polygon');
});

test('rejects non-polygon parcel geometry', () => {
  assert.throws(() => normalizeRrcParcelRequest({
    geometry: { type: 'Point', coordinates: [-98.5, 29.4] },
  }), /Polygon or MultiPolygon/);
});

test('builds bounded RRC feature SQL without arbitrary browser SQL', () => {
  const sql = buildRrcFeaturesSql({
    west: -98.6,
    south: 29.35,
    east: -98.45,
    north: 29.5,
  }, { countyFips: '48029' });

  assert.match(sql, /bdp_rrc_wells/);
  assert.match(sql, /bdp_rrc_pipelines/);
  assert.match(sql, /ST_MakeEnvelope\(-98\.6, 29\.35, -98\.45, 29\.5, 4326\)/);
  assert.match(sql, /w\.county_fips = '029'/);
  assert.match(sql, /LIMIT 1500/);
});

test('builds parcel energy SQL from validated GeoJSON only', () => {
  const sql = buildRrcEnergySql({
    countyFips: '029',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-98.5, 29.4],
        [-98.49, 29.4],
        [-98.49, 29.41],
        [-98.5, 29.4],
      ]],
    },
  });

  assert.match(sql, /bdp_rrc_parcel_energy_metrics/);
  assert.match(sql, /ST_GeomFromGeoJSON/);
  assert.match(sql, /'029'/);
});
