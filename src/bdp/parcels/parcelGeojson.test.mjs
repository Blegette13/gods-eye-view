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

test('source focal preview draws a distinct query-footprint outline without inventing a parcel identity', () => {
  const bounds={west:-97.8,south:30.2,east:-97.7,north:30.3};
  const geometry={type:'Polygon',coordinates:[ring]};
  const coll=parcelGeoJsonWithBoundaries([parcel('003',geometry)], {focalBounds:bounds});
  const footprint=coll.features[0];
  assert.equal(footprint.id,'land-discovery-focus-footprint');
  assert.equal(footprint.geometry.type,'LineString');
  assert.equal(footprint.properties.bdpFocusFootprint,true);
  assert.equal(footprint.properties.bdpParcelId,null);
  assert.deepEqual(footprint.geometry.coordinates,[
    [-97.8,30.2],[-97.7,30.2],[-97.7,30.3],[-97.8,30.3],[-97.8,30.2],
  ]);
  assert.equal(coll.features.length,3,'one focus line, one source polygon and one pickable parcel boundary');
  assert.throws(()=>parcelGeoJsonWithBoundaries([], {
    focalBounds:{west:0,east:0,south:0,north:1},
  }),/Invalid sourced focus/);
});
