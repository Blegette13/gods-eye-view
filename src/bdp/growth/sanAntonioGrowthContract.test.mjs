import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAN_ANTONIO_MTP_URL,
  SAN_ANTONIO_PRELIMINARY_PLAT_URL,
  SAN_ANTONIO_REGIONAL_CENTERS_URL,
  buildSanAntonioGrowthQueryUrls,
  buildSanAntonioGrowthSql,
  normalizeSanAntonioMtp,
  normalizeSanAntonioPreliminaryPlats,
  normalizeSanAntonioRegionalCenters,
} from './sanAntonioGrowthContract.js';

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

test('Growth Radar sources stay on official City of San Antonio services', () => {
  for (const url of [
    SAN_ANTONIO_MTP_URL,
    SAN_ANTONIO_PRELIMINARY_PLAT_URL,
    SAN_ANTONIO_REGIONAL_CENTERS_URL,
  ]) assert.ok(url.startsWith('https://services.arcgis.com/'));
});

test('Growth Radar queries a padded 25-mile screening vicinity as GeoJSON', () => {
  const urls = buildSanAntonioGrowthQueryUrls(parcel);
  for (const url of Object.values(urls)) {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('f'), 'geojson');
    assert.equal(parsed.searchParams.get('returnGeometry'), 'true');
    assert.equal(parsed.searchParams.get('resultRecordCount'), '2000');
  }
});

test('normalizes MTP lines, preliminary-plat polygons and regional-center polygons', () => {
  const mtp = normalizeSanAntonioMtp({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-98.5, 29.4], [-98.4, 29.5]] },
      properties: { StreetName: 'TEST ROAD', PropRow: '120' },
    }],
  });
  assert.equal(mtp.features[0].properties.StreetName, 'TEST ROAD');

  const plats = normalizeSanAntonioPreliminaryPlats({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: parcel.geometry,
      properties: { PlatName: 'TEST PLAT', PlatNumber: '123' },
    }],
  });
  assert.equal(plats.features[0].properties.PlatName, 'TEST PLAT');

  const centers = normalizeSanAntonioRegionalCenters({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: parcel.geometry,
      properties: { Name: 'TEST CENTER' },
    }],
  });
  assert.equal(centers.features[0].properties.Name, 'TEST CENTER');
});

test('Growth Radar SQL calculates proximity/counts but explicitly withholds growth score', () => {
  const empty = { type: 'FeatureCollection', features: [] };
  const sql = buildSanAntonioGrowthSql(parcel, {
    thoroughfares: empty,
    preliminaryPlats: empty,
    regionalCenters: empty,
  });
  assert.match(sql, /nearest_mtp_m/);
  assert.match(sql, /preliminary_plats_within_25_mi/);
  assert.match(sql, /regional_centers_within_25_mi/);
  assert.match(sql, /'growth_score_ready', false/);
});
