import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TWDB_WATER_SERVICE_AREAS_URL,
  PUCT_WATER_CCN_URL,
  US_GOV_TRANSMISSION_ARCHIVE_URL,
  buildUtilityParcelMetricsSql,
  buildPuctSewerMetricsSql,
  buildPuctSewerMapSql,
  buildPuctWaterMetricsSql,
  buildPuctWaterMapSql,
  buildUtilityParcelQueryUrls,
  normalizeTransmissionLines,
  normalizeWaterCcn,
  normalizeWaterServiceAreas,
} from './utilityContract.js';

const parcel = {
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-98.5, 29.4],
      [-98.49, 29.4],
      [-98.49, 29.41],
      [-98.5, 29.41],
      [-98.5, 29.4],
    ]],
  },
};

test('utility sources stay on the intended public screening services', () => {
  assert.match(TWDB_WATER_SERVICE_AREAS_URL, /services\.twdb\.texas\.gov/);
  assert.match(PUCT_WATER_CCN_URL, /services\.twdb\.texas\.gov/);
  assert.match(US_GOV_TRANSMISSION_ARCHIVE_URL, /PowerTransmissionInfrastructure/);
});

test('builds bounded water and transmission queries', () => {
  const urls = buildUtilityParcelQueryUrls(parcel);
  for (const url of Object.values(urls)) {
    assert.match(url, /\/query\?/);
    assert.match(url, /f=geojson/);
    assert.match(url, /returnGeometry=true/);
  }
});

test('normalizes utility source geometry and rejects capped results', () => {
  const water = normalizeWaterServiceAreas({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: parcel.geometry,
      properties: { PWSName: 'Example Water', PWSId: 'TX0001' },
    }],
  });
  assert.equal(water.features.length, 1);

  const ccn = normalizeWaterCcn({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: parcel.geometry,
      properties: { CCN_NO: '12345', UTILITY: 'Example Water' },
    }],
  });
  assert.equal(ccn.features[0].properties.CCN_NO, '12345');

  const lines = normalizeTransmissionLines({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-98.5, 29.4], [-98.49, 29.41]] },
      properties: { OWNER: 'Example Grid', VOLTAGE: 138 },
    }],
  });
  assert.equal(lines.features.length, 1);

  assert.throws(() => normalizeWaterServiceAreas({ type: 'FeatureCollection',
    exceededTransferLimit: true, features: [] }), /capped/);
  assert.throws(() => normalizeWaterServiceAreas({ type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: null, properties: { PWSName: 'Unlocated' },
  }] }), /missing or unsupported/);
  assert.throws(() => normalizeTransmissionLines({ type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: parcel.geometry, properties: { OWNER: 'Wrong geometry' },
  }] }), /missing or unsupported/);
});

test('utility metric SQL keeps service territory separate from transmission proximity', () => {
  const empty = { type: 'FeatureCollection', features: [] };
  const sql = buildUtilityParcelMetricsSql(parcel, {
    waterServiceAreas: empty,
    waterCcn: empty,
    transmission: empty,
  });
  assert.match(sql, /water_service_overlap_percent/);
  assert.match(sql, /water_ccn_overlap_percent/);
  assert.match(sql, /nearest_transmission_m/);
  assert.match(sql, /archived-2024/);
  assert.match(buildPuctSewerMetricsSql(parcel), /bdp_puct_sewer_ccn_metrics/);
  assert.match(buildPuctWaterMetricsSql(parcel), /bdp_puct_water_ccn_metrics/);
  const mapSql = buildPuctSewerMapSql({ west: -98.6, south: 29.3, east: -98.4, north: 29.5 });
  assert.match(mapSql, /ST_Intersection/);
  assert.match(mapSql, /LIMIT 501/);
  assert.match(buildPuctWaterMapSql({ west: -98.6, south: 29.3, east: -98.4, north: 29.5 }), /bdp_puct_water_ccn/);
  assert.throws(() => buildPuctSewerMapSql({ west: -100, south: 29, east: -99, north: 30 }), /bounded Texas/);
});
