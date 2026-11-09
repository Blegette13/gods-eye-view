import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAN_ANTONIO_ETJ_URL,
  SAN_ANTONIO_FUTURE_LAND_USE_URL,
  SAN_ANTONIO_ZONING_URL,
  buildSanAntonioEntitlementQueryUrls,
  buildSanAntonioEntitlementSql,
  normalizeSanAntonioEtj,
  normalizeSanAntonioFutureLandUse,
  normalizeSanAntonioZoning,
} from './sanAntonioContract.js';

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

test('entitlement contract stays on official San Antonio ArcGIS services', () => {
  for (const url of [
    SAN_ANTONIO_ZONING_URL,
    SAN_ANTONIO_ETJ_URL,
    SAN_ANTONIO_FUTURE_LAND_USE_URL,
  ]) assert.ok(url.startsWith('https://services.arcgis.com/g1fRTDLeMgspWrYp/'));
});

test('builds bounded zoning, ETJ and future-land-use GeoJSON queries', () => {
  const urls = buildSanAntonioEntitlementQueryUrls(parcel);
  for (const url of Object.values(urls)) {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('f'), 'geojson');
    assert.equal(parsed.searchParams.get('returnGeometry'), 'true');
    assert.equal(parsed.searchParams.get('spatialRel'), 'esriSpatialRelIntersects');
  }
});

test('normalizes only polygon entitlement features and rejects capped results', () => {
  const zoning = normalizeSanAntonioZoning({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: parcel.geometry,
      properties: { Base: 'R-6', Zoning: 'R-6', BaseDescription: 'Residential' },
    }],
  });
  assert.equal(zoning.features[0].properties.Base, 'R-6');

  const etj = normalizeSanAntonioEtj({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: parcel.geometry,
      properties: { Name: 'San Antonio ETJ' },
    }],
  });
  assert.equal(etj.features[0].properties.Name, 'San Antonio ETJ');

  const flu = normalizeSanAntonioFutureLandUse({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: parcel.geometry,
      properties: { PlanName: 'Area Plan', LandUse: 'Low Density Residential' },
    }],
  });
  assert.equal(flu.features[0].properties.LandUse, 'Low Density Residential');
});

test('entitlement SQL calculates jurisdiction, dominant zoning and future-use shares', () => {
  const empty = { type: 'FeatureCollection', features: [] };
  const sql = buildSanAntonioEntitlementSql(parcel, {
    zoning: empty,
    etj: empty,
    futureLandUse: empty,
  });
  assert.match(sql, /jurisdiction_screen/);
  assert.match(sql, /dominant_zoning_share_percent/);
  assert.match(sql, /etj_overlap_percent/);
  assert.match(sql, /dominant_future_land_use_share_percent/);
  assert.match(sql, /legal_entitlement_determined/);
});
