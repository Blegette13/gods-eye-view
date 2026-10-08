import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GROWTH_MAP_SOURCES,
  buildGrowthMapUrl,
  createSanAntonioGrowthLayer,
} from './sanAntonioGrowthLayer.js';

const bounds = { west: -98.6, south: 29.3, east: -98.4, north: 29.5 };

test('Growth Radar map queries stay bounded and GeoJSON', () => {
  for (const source of Object.values(GROWTH_MAP_SOURCES)) {
    const url = new URL(buildGrowthMapUrl(source, bounds));
    assert.equal(url.searchParams.get('f'), 'geojson');
    assert.equal(url.searchParams.get('returnGeometry'), 'true');
    assert.equal(url.searchParams.get('resultRecordCount'), '2000');
  }
});

test('Growth Radar uses one native God’s Eye layer identity', () => {
  const layer = createSanAntonioGrowthLayer();
  assert.equal(layer.id, 'bdp-san-antonio-growth');
  assert.equal(layer.name, 'BDP · San Antonio Growth Radar');
  assert.match(layer.source, /San Antonio/i);
});
