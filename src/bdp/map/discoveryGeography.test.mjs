import test from 'node:test';
import assert from 'node:assert/strict';
import {
  censusCountyUrl, countyForCriteria, countyPoint, validateCountyFeatures,
  radiusLineCoordinates, radiusEnvelope, countyBoundaryLines,
} from './discoveryGeography.js';

const feature = {
  type: 'Feature',
  properties: { GEOID: '48029', NAME: 'Bexar', STATE: '48', INTPTLAT: '+29.44985', INTPTLON: '-98.52012' },
  geometry: { type: 'Polygon', coordinates: [[
    [-98.6, 29.4], [-98.5, 29.4], [-98.5, 29.5], [-98.6, 29.4],
  ]] },
};

test('pilot county FIPS and Census 2026 source URL are exact', () => {
  assert.equal(countyForCriteria({ county: 'Bexar' }).fips, '48029');
  assert.equal(countyForCriteria({ county: 'Travis' }).fips, '48453');
  assert.equal(countyForCriteria({ county: 'Missing' }), null);
  const url = new URL(censusCountyUrl({ geoid: '48029' }));
  assert.equal(url.searchParams.get('where'), "GEOID='48029'");
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.equal(url.searchParams.get('outSR'), '4326');
  const env = new URL(censusCountyUrl({ envelope: radiusEnvelope({lat:29.5,lon:-98.5},25) }));
  assert.equal(env.searchParams.get('where'), "STATE='48'");
  assert.equal(env.searchParams.get('geometryType'), 'esriGeometryEnvelope');
});

test('county geometry is based on actual Census source fields and fails closed', () => {
  assert.deepEqual(validateCountyFeatures({ type: 'FeatureCollection', features: [feature] }), [feature]);
  assert.deepEqual(countyPoint(feature), { lat: 29.44985, lon: -98.52012 });
  assert.equal(countyBoundaryLines([feature]).features.length, 1);
  for (const data of [
    { error: {code: 499} },
    { type: 'FeatureCollection', features: [feature], exceededTransferLimit: true },
    { type: 'FeatureCollection', features: [{ ...feature, properties: { GEOID: '06037' } }] },
    { type: 'FeatureCollection', features: [{ ...feature, geometry: null }] },
  ]) assert.throws(() => validateCountyFeatures(data));
  assert.equal(countyPoint({ properties: {} }), null);
});

test('geodesic radius loop is distinct from county border and starts at Census internal point', () => {
  const point = countyPoint(feature);
  const ring = radiusLineCoordinates(point, 25);
  assert.equal(ring.length, 97);
  assert.ok(Math.abs(ring[0][0] - ring.at(-1)[0]) < 1e-9);
  assert.ok(Math.abs(ring[0][1] - ring.at(-1)[1]) < 1e-9);
  assert.equal(radiusLineCoordinates(point, 0).length, 0);
  assert.equal(radiusLineCoordinates(point, 100).length, 0);
  assert.ok(radiusEnvelope(point, 25).east > point.lon);
  assert.ok(radiusEnvelope(point, 25).west < point.lon);
  assert.equal(radiusEnvelope(point, 0), null);
});
