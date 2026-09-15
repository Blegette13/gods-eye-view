import assert from 'node:assert/strict';
import test from 'node:test';
import {
  build3depStatisticsUrl,
  normalizeTerrainParcelRequest,
  summarizeTerrainStatistics,
} from './terrainContract.js';

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

test('normalizes GeoJSON parcel to ArcGIS WGS84 polygon rings', () => {
  const request = normalizeTerrainParcelRequest(parcel);
  assert.equal(request.arcgisGeometry.spatialReference.wkid, 4326);
  assert.equal(request.arcgisGeometry.rings.length, 1);
  assert.equal(request.positions, 5);
});

test('builds elevation and slope statistics URLs against USGS 3DEP', () => {
  const elevation = new URL(build3depStatisticsUrl(parcel, { mode: 'elevation' }));
  const slope = new URL(build3depStatisticsUrl(parcel, { mode: 'slope' }));
  assert.equal(elevation.searchParams.get('geometryType'), 'esriGeometryPolygon');
  assert.equal(elevation.searchParams.get('f'), 'json');
  assert.equal(JSON.parse(elevation.searchParams.get('renderingRule')).rasterFunction, 'None');
  assert.equal(JSON.parse(slope.searchParams.get('renderingRule')).rasterFunction, 'Slope Degrees');
});

test('summarizes elevation and slope statistics into tract metrics', () => {
  const summary = summarizeTerrainStatistics(
    { statistics: [{ min: 100, max: 130, mean: 112, standardDeviation: 5, count: 1000 }] },
    { statistics: [{ min: 0, max: 16, mean: 6, standardDeviation: 2, count: 1000 }] },
  );
  assert.equal(summary.elevation.reliefMeters, 30);
  assert.ok(summary.elevation.meanFeet > 360 && summary.elevation.meanFeet < 370);
  assert.equal(summary.slope.meanDegrees, 6);
  assert.equal(summary.terrainClass, 'moderate');
  assert.equal(summary.screeningPixelSizeMeters, 10);
});
