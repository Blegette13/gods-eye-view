import assert from 'node:assert/strict';
import test from 'node:test';
import {
  THC_CEMETERY_LAYER_URL,
  buildThcCemeteryMetricsSql,
  buildThcCemeteryParcelQueryUrl,
  buildThcCemeteryViewportQueryUrl,
  normalizeCemeteryBounds,
  normalizeThcCemeteryFeatureCollection,
} from './cemeteryContract.js';

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

test('uses the public THC Historic Sites Atlas cemetery polygon layer', () => {
  assert.match(THC_CEMETERY_LAYER_URL, /services7\.arcgis\.com/);
  assert.match(THC_CEMETERY_LAYER_URL, /FeatureServer\/5$/);
});

test('cemetery query is spatially bounded and requests WGS84 GeoJSON', () => {
  const url = new URL(buildThcCemeteryParcelQueryUrl(parcel));
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.equal(url.searchParams.get('outSR'), '4326');
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.match(url.searchParams.get('outFields'), /CEMNAME/);
  assert.match(url.searchParams.get('outFields'), /CEMTYPE/);
});

test('normalizes only polygon cemetery geometry and preserves public Atlas fields', () => {
  const result = normalizeThcCemeteryFeatureCollection({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: parcel.geometry,
        properties: {
          CEMNAME: 'Example Cemetery',
          CEMTYPE: 'Cemetery',
          CEMNUM: 'ABC-001',
          AtlasNum: 123,
        },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-98.5, 29.4] },
        properties: { CEMNAME: 'Ignored point' },
      },
    ],
  });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.CEMNAME, 'Example Cemetery');
});

test('cemetery metrics calculate overlap/proximity and explicitly withhold restricted archaeology', () => {
  const sql = buildThcCemeteryMetricsSql(parcel, {
    type: 'FeatureCollection',
    features: [],
  });
  assert.match(sql, /cemetery_overlap_acres/);
  assert.match(sql, /cemeteries_within_5_mi/);
  assert.match(sql, /restricted-location-data-not-screened/);
});


test('cemetery viewport query is bounded and rejects state-scale requests', () => {
  const bounds = normalizeCemeteryBounds({
    west: -98.7,
    south: 29.2,
    east: -98.3,
    north: 29.6,
  });
  const url = new URL(buildThcCemeteryViewportQueryUrl(bounds));
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.throws(
    () => buildThcCemeteryViewportQueryUrl({
      west: -106,
      south: 25,
      east: -93,
      north: 36,
    }),
    /viewport/i,
  );
});
