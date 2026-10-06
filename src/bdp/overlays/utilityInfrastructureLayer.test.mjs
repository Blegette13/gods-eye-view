import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UTILITY_MAP_SOURCES,
  buildUtilityMapQueryUrl,
} from './utilityInfrastructureLayer.js';

const bounds = {
  west: -98.6,
  south: 29.3,
  east: -98.4,
  north: 29.5,
};

test('utility map queries stay bounded and request GeoJSON', () => {
  for (const source of Object.values(UTILITY_MAP_SOURCES).filter((item) => item.id !== 'sewer-ccn')) {
    const url = new URL(buildUtilityMapQueryUrl(source, bounds));
    assert.equal(url.searchParams.get('f'), 'geojson');
    assert.equal(url.searchParams.get('returnGeometry'), 'true');
    assert.equal(url.searchParams.get('geometry'), '-98.6,29.3,-98.4,29.5');
    assert.equal(url.searchParams.get('resultRecordCount'), '2000');
  }
  const sewer = new URL(buildUtilityMapQueryUrl(UTILITY_MAP_SOURCES.sewerCcn, bounds), 'http://localhost');
  assert.equal(sewer.pathname, '/api/bdp/utilities/sewer-ccn-map');
  assert.equal(sewer.searchParams.get('west'), '-98.6');
  assert.equal(sewer.searchParams.get('north'), '29.5');
});

test('utility map query rejects invalid bounds', () => {
  assert.throws(
    () => buildUtilityMapQueryUrl(UTILITY_MAP_SOURCES.waterService, {
      west: -98.4,
      south: 29.3,
      east: -98.6,
      north: 29.5,
    }),
    /invalid WGS84 bounds/i,
  );
});
