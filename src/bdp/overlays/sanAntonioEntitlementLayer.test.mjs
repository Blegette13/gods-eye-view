import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAN_ANTONIO_ENTITLEMENT_MAP_SOURCES,
  buildSanAntonioEntitlementMapUrl,
  createSanAntonioEntitlementLayer,
} from './sanAntonioEntitlementLayer.js';

const bounds = {
  west: -98.6,
  south: 29.3,
  east: -98.4,
  north: 29.5,
};

test('entitlement map queries are bounded GeoJSON requests', () => {
  for (const source of Object.values(SAN_ANTONIO_ENTITLEMENT_MAP_SOURCES)) {
    const url = new URL(buildSanAntonioEntitlementMapUrl(source, bounds));
    assert.equal(url.searchParams.get('f'), 'geojson');
    assert.equal(url.searchParams.get('returnGeometry'), 'true');
    assert.equal(url.searchParams.get('geometry'), '-98.6,29.3,-98.4,29.5');
    assert.equal(url.searchParams.get('resultRecordCount'), '2000');
  }
});

test('entitlement layer keeps one God’s Eye identity for three planning sources', () => {
  const layer = createSanAntonioEntitlementLayer();
  assert.equal(layer.id, 'bdp-san-antonio-entitlement');
  assert.equal(layer.name, 'BDP · San Antonio Entitlement');
  assert.match(layer.source, /San Antonio/i);
});
