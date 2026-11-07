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

test('progressive source windows have only a merged exterior (not six stacked orange boxes)',()=>{
  const windows=[
    {west:0,south:0,east:2,north:2},
    {west:1,south:1,east:3,north:3},
    {west:1,south:1,east:3,north:3},
  ];
  const geometry={type:'Polygon',coordinates:[ring]};
  const coll=parcelGeoJsonWithBoundaries([parcel('008',geometry)],{focalBoundsList:windows});
  const footprints=coll.features.filter((f)=>f.properties.bdpFocusFootprint);
  assert.equal(footprints.length,1);
  assert.deepEqual(footprints[0].geometry.coordinates,[
    [0,0],[2,0],[2,1],[3,1],[3,3],[1,3],[1,2],[0,2],[0,0],
  ]);
  assert.equal(footprints[0].properties.bdpParcelId,null);
  assert.equal(coll.features.filter((f)=>f.properties.bdpParcelId==='48453:008').length,2,
    'real source parcel and its selectable polygon boundary remain unchanged');
  assert.strictEqual(coll.features[1].geometry,geometry);
});

test('disjoint completed source-query windows remain separately visible, no invented bridge',()=>{
  const coll=parcelGeoJsonWithBoundaries([],{focalBoundsList:[
    {west:0,south:0,east:1,north:1},
    {west:3,south:0,east:4,north:1},
  ]});
  assert.equal(coll.features.length,2);
  assert.deepEqual(coll.features.map((f)=>f.id),[
    'land-discovery-focus-footprint','land-discovery-focus-footprint-1',
  ]);
  for(const feature of coll.features) {
    assert.equal(feature.properties.bdpFocusFootprint,true);
    assert.equal(feature.properties.bdpParcelId,null);
    assert.deepEqual(feature.geometry.coordinates[0],feature.geometry.coordinates.at(-1));
  }
});
