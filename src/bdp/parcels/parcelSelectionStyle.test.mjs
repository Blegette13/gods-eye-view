import assert from 'node:assert/strict';
import test from 'node:test';
import {
  styleSelectedParcelEntities,
  parcelExteriorCoordinates,
  recommendedParcelFocusRange,
} from './parcelSelectionStyle.js';

function feature(parcelId, graphicType) {
  return {
    id: `bdp-boundary:${parcelId}:0:0`,
    properties: { bdpParcelId: parcelId },
    [graphicType]: { material: 'previous-style', width: 99, outline: true },
  };
}
const options = {
  parcelIdForEntity: (entity) => entity.properties.bdpParcelId,
  defaultOutline: 'white',
  selectedOutline: 'blue',
  defaultFill: 'transparent',
  selectedFill: 'blue-hatch',
  defaultWidth: 2,
  selectedWidth: 5,
};

test('selects only exact county-prefixed ID and its pickable polygon/boundary parts', () => {
  const entities = [
    feature('48453:302959', 'polygon'),
    feature('48453:302959', 'polyline'),
    feature('48029:302959', 'polyline'),
    feature('48453:98765', 'polygon'),
  ];
  const hits = styleSelectedParcelEntities(entities, '48453:302959', options);
  assert.equal(hits, 2);
  assert.equal(entities[0].polygon.material, 'blue-hatch');
  assert.equal(entities[0].polygon.outline, false);
  assert.equal(entities[1].polyline.material, 'blue');
  assert.equal(entities[1].polyline.width, 5);
  assert.equal(entities[2].polyline.material, 'white');
  assert.equal(entities[2].polyline.width, 2);
  assert.equal(entities[3].polygon.material, 'transparent');
  assert.equal(entities[0].properties.bdpParcelId, '48453:302959');
  assert.equal(entities[1].id, 'bdp-boundary:48453:302959:0:0');
});

test('closing a property restores normal strokes; selecting another clears old stroke', () => {
  const one = feature('48453:302959', 'polyline');
  const two = feature('48453:7', 'polyline');
  styleSelectedParcelEntities([one, two], '48453:302959', options);
  styleSelectedParcelEntities([one, two], '48453:7', options);
  assert.equal(one.polyline.material, 'white');
  assert.equal(two.polyline.material, 'blue');
  styleSelectedParcelEntities([one, two], null, options);
  assert.equal(one.polyline.material, 'white');
  assert.equal(two.polyline.material, 'white');
  assert.equal(two.polyline.width, 2);
});

test('missing entity data or a missing selection never invents a parcel match', () => {
  assert.equal(styleSelectedParcelEntities(null, '48453:1', options), 0);
  assert.equal(styleSelectedParcelEntities([], '48453:1', options), 0);
  assert.equal(styleSelectedParcelEntities([{ polygon: {} }], '48453:1', {
    ...options,
    parcelIdForEntity: () => null,
  }), 0);
  assert.equal(styleSelectedParcelEntities([feature('48453:1', 'polyline')], '1', options), 0);
});

test('selective focus uses real exterior geographic rings, including multipart', () => {
  const ringA = [[-97.75, 30.25], [-97.74, 30.25], [-97.75, 30.26], [-97.75, 30.25]];
  const hole = [[-97.745, 30.251], [-97.744, 30.251], [-97.745, 30.251]];
  const ringB = [[-97.71, 30.22], [-97.70, 30.22], [-97.71, 30.22]];
  assert.deepEqual(parcelExteriorCoordinates({ type: 'Polygon', coordinates: [ringA, hole] }), ringA);
  assert.deepEqual(parcelExteriorCoordinates({
    type: 'MultiPolygon',
    coordinates: [[ringA], [ringB]],
  }), [...ringA, ...ringB]);
});

test('invalid/missing or out-of-range geometry is never used as a camera target', () => {
  for (const geometry of [
    null,
    { type: 'LineString', coordinates: [[-97, 30]] },
    { type: 'Polygon', coordinates: [] },
    { type: 'Polygon', coordinates: [[[NaN, 30]]] },
    { type: 'Polygon', coordinates: [[[192, 30]]] },
    { type: 'Polygon', coordinates: [[[0, 100]]] },
    { type: 'MultiPolygon', coordinates: [null] },
  ]) {
    assert.deepEqual(parcelExteriorCoordinates(geometry), []);
  }
});

test('parcel camera framing is specific for a small urban lot and adjusts for large tracts', () => {
  const small = { type: 'Polygon', coordinates: [[
    [-97.75790, 30.19158], [-97.75774, 30.19158],
    [-97.75774, 30.19177], [-97.75790, 30.19158],
  ]] };
  const large = { type: 'Polygon', coordinates: [[
    [-97.80, 30.20], [-97.77, 30.20],
    [-97.77, 30.23], [-97.80, 30.20],
  ]] };
  assert.equal(recommendedParcelFocusRange(small), 450);
  assert.ok(recommendedParcelFocusRange(large) > 3000);
  assert.equal(recommendedParcelFocusRange(null), null);
  assert.equal(recommendedParcelFocusRange({ type: 'Point', coordinates: [-97.7, 30.2] }), null);
});
