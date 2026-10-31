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
  assert.equal(elevation.searchParams.has('renderingRule'), false);
  assert.equal(elevation.searchParams.has('pixelSize'), false);
  assert.equal(slope.searchParams.has('pixelSize'), false);
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
  assert.equal(summary.screeningPixelSizeMeters, null);
  assert.equal(summary.coverage_complete, true);
});

test('partial 3DEP response preserves real slope without inventing an elevation or sample size', () => {
  const slope = { statistics: [{ min: 0, max: 65, mean: 4.075, count: 172215 }] };
  const result = summarizeTerrainStatistics(null, slope);
  assert.equal(result.coverage_complete, false);
  assert.equal(result.elevation_source_status, 'unavailable');
  assert.equal(result.slope_source_status, 'returned');
  assert.equal(result.elevation.meanFeet, null);
  assert.equal(result.elevation.reliefFeet, null);
  assert.equal(result.slope.meanDegrees, 4.075);
  assert.equal(result.terrainClass, 'gentle');
  assert.equal(result.screeningPixelSizeMeters, null);
});

test('terrain refuses zero count, missing mean, and fully absent statistics', () => {
  const valid = { statistics: [{ min: 10, max: 12, mean: 11, count: 10 }] };
  assert.throws(() => summarizeTerrainStatistics(null, null), /no usable terrain evidence/);
  assert.throws(() => summarizeTerrainStatistics({ statistics: [] }, valid), /no usable raster statistics/);
  assert.throws(() => summarizeTerrainStatistics({ statistics: [{ mean: 3, count: 0 }] }, valid), /no usable raster statistics/);
});
