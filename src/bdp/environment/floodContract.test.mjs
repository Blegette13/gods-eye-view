import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFemaOverlapSql,
  buildFemaParcelQueryUrl,
  classifyFemaFloodFeature,
  normalizeFemaFeatureCollection,
} from './floodContract.js';

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

test('classifies FEMA floodway, SFHA, and moderate features', () => {
  assert.equal(classifyFemaFloodFeature({ properties: { ZONE_SUBTY: 'FLOODWAY', SFHA_TF: 'T' } }), 'floodway');
  assert.equal(classifyFemaFloodFeature({ properties: { FLD_ZONE: 'AE', SFHA_TF: 'T' } }), 'sfha');
  assert.equal(classifyFemaFloodFeature({ properties: { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD' } }), 'moderate');
  assert.equal(classifyFemaFloodFeature({ properties: { FLD_ZONE: 'X' } }), 'other');
});

test('builds bounded FEMA parcel query', () => {
  const url = new URL(buildFemaParcelQueryUrl(parcel));
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.equal(url.searchParams.get('outSR'), '4326');
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.match(url.searchParams.get('outFields'), /SFHA_TF/);
});

test('normalizes FEMA features with a BDP hazard class', () => {
  const normalized = normalizeFemaFeatureCollection({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: parcel.geometry,
      properties: { FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T', EXTRA: 'drop' },
    }],
  });
  assert.equal(normalized.features.length, 1);
  assert.equal(normalized.features[0].properties.bdp_class, 'sfha');
  assert.equal(Object.hasOwn(normalized.features[0].properties, 'EXTRA'), false);
});

test('builds de-duplicated PostGIS flood acreage metrics', () => {
  const sql = buildFemaOverlapSql(parcel, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: parcel.geometry,
      properties: { FLD_ZONE: 'AE', SFHA_TF: 'T' },
    }],
  });
  assert.match(sql, /ST_UnaryUnion/);
  assert.match(sql, /floodway_acres/);
  assert.match(sql, /sfha_acres/);
  assert.match(sql, /mapped_flood_percent/);
  assert.match(sql, /preliminary_non_mapped_flood_acres/);
});
