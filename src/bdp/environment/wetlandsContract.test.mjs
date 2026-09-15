import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNwiOverlapSql,
  buildNwiParcelQueryUrl,
  normalizeNwiFeatureCollection,
  normalizeWetlandsParcelRequest,
} from './wetlandsContract.js';

const parcel = {
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-98.50, 29.40],
      [-98.49, 29.40],
      [-98.49, 29.41],
      [-98.50, 29.41],
      [-98.50, 29.40],
    ]],
  },
};

test('normalizes parcel geometry and derives a bounded NWI query envelope', () => {
  const request = normalizeWetlandsParcelRequest(parcel);
  assert.deepEqual(request.bounds, {
    west: -98.50,
    south: 29.40,
    east: -98.49,
    north: 29.41,
  });

  const url = new URL(buildNwiParcelQueryUrl(parcel));
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.match(url.searchParams.get('outFields'), /WETLAND_TYPE/);
});

test('keeps only polygon wetland features and the fields used by screening', () => {
  const normalized = normalizeNwiFeatureCollection({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: parcel.geometry.coordinates },
        properties: { ATTRIBUTE: 'PFO1A', WETLAND_TYPE: 'Freshwater Forested/Shrub Wetland', ACRES: 12.5, EXTRA: 'drop' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-98.5, 29.4] },
        properties: { ATTRIBUTE: 'not-used' },
      },
    ],
  });

  assert.equal(normalized.features.length, 1);
  assert.deepEqual(Object.keys(normalized.features[0].properties).sort(), ['ACRES', 'ATTRIBUTE', 'WETLAND_TYPE']);
});

test('builds PostGIS acreage and percentage calculations from trusted GeoJSON', () => {
  const sql = buildNwiOverlapSql(parcel, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: parcel.geometry.coordinates },
      properties: { ATTRIBUTE: 'PFO1A', WETLAND_TYPE: 'Freshwater Forested/Shrub Wetland', ACRES: 1 },
    }],
  });

  assert.match(sql, /ST_Intersection/);
  assert.match(sql, /nwi_mapped_acres/);
  assert.match(sql, /nwi_percent/);
  assert.match(sql, /preliminary_non_nwi_acres/);
});
