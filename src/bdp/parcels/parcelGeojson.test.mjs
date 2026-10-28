import assert from 'node:assert/strict';
import test from 'node:test';
import { parcelGeoJsonWithBoundaries } from './parcelGeojson.js';

const ring = [[-97.75, 30.25], [-97.74, 30.25], [-97.74, 30.26], [-97.75, 30.25]];
const hole = [[-97.748, 30.251], [-97.747, 30.251], [-97.747, 30.252], [-97.748, 30.251]];
function parcel(id, geometry) {
  return {
    id: `48453:${id}`,
    parcelId: String(id),
    county: 'Travis',
    owner: { name: 'EXAMPLE OWNER' },
    property: { geometry, acres: null },
  };
}

test('single parcel keeps its polygon and creates visible, pickable lines for exterior and hole', () => {
  const geometry = { type: 'Polygon', coordinates: [ring, hole] };
  const collection = parcelGeoJsonWithBoundaries([parcel(1, geometry)]);
  assert.equal(collection.type, 'FeatureCollection');
  assert.equal(collection.features.length, 3);
  assert.strictEqual(collection.features[0].geometry, geometry);
  assert.deepEqual(collection.features.slice(1).map((feature) => feature.geometry), [
    { type: 'LineString', coordinates: ring },
    { type: 'LineString', coordinates: hole },
  ]);
  for (const feature of collection.features) {
    assert.equal(feature.properties.bdpParcelId, '48453:1');
  }
  assert.deepEqual(collection.features.slice(1).map((feature) => feature.id), [
    'bdp-boundary:48453:1:0:0',
    'bdp-boundary:48453:1:0:1',
  ]);
});

test('multipart parcels preserve each part and unrelated parcel selection identity', () => {
  const source = [
    parcel(2, { type: 'MultiPolygon', coordinates: [[ring], [hole, ring]] }),
    parcel(3, { type: 'Polygon', coordinates: [ring] }),
  ];
  const collection = parcelGeoJsonWithBoundaries(source);
  assert.equal(collection.features.length, 6);
  assert.equal(collection.features.filter((feature) => feature.geometry.type === 'LineString').length, 4);
  assert.equal(collection.features.filter((feature) => feature.properties.bdpParcelId === '48453:2').length, 4);
  assert.equal(collection.features.filter((feature) => feature.properties.bdpParcelId === '48453:3').length, 2);
  assert.equal(source[0].property.geometry.coordinates.length, 2);
});

test('missing geometries are not invented, invalid rings are rejected', () => {
  assert.deepEqual(parcelGeoJsonWithBoundaries([parcel(4, null)]).features, []);
  assert.throws(() => parcelGeoJsonWithBoundaries([
    parcel(5, { type: 'Polygon', coordinates: [[]] }),
  ]), /invalid boundary/);
  assert.throws(() => parcelGeoJsonWithBoundaries([
    parcel(6, { type: 'MultiPolygon', coordinates: [null] }),
  ]), /missing rings/);
});
