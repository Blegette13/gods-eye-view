import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTxdotParcelMetricsSql,
  buildTxdotParcelQueryUrls,
  normalizeTxdotAadt,
  normalizeTxdotAadtHistory,
  normalizeTxdotRoadways,
} from './txdotContract.js';

const parcel = {
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-98.50, 29.40],
      [-98.48, 29.40],
      [-98.48, 29.42],
      [-98.50, 29.42],
      [-98.50, 29.40],
    ]],
  },
};

const lineCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [[-98.51, 29.41], [-98.47, 29.41]],
    },
    properties: {
      RTE_NM: 'IH0035',
      RTE_PRFX: 'IH',
      RTE_NBR: '0035',
      MAP_LBL: 'IH 35',
      SYSTEM: 'ON',
      EXT_DATE: '2026-09-01',
      AADT_CUR: 125000,
    },
  }],
};

const historyCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-98.49, 29.41] },
    properties: {
      TRFC_STATN_ID: 'TEST-001',
      CNTY_NM: 'BEXAR',
      LATEST_AADT_YR: 2025,
      AADT_RPT_QTY: 120000,
      AADT_RPT_HIST_01_QTY: 116000,
      AADT_RPT_HIST_02_QTY: 112000,
      AADT_RPT_HIST_03_QTY: 108000,
      AADT_RPT_HIST_04_QTY: 100000,
    },
  }],
};

test('TxDOT parcel queries use official GIS services with WGS84 envelopes', () => {
  const urls = buildTxdotParcelQueryUrls(parcel);
  for (const urlText of Object.values(urls)) {
    const url = new URL(urlText);
    assert.equal(url.searchParams.get('inSR'), '4326');
    assert.equal(url.searchParams.get('outSR'), '4326');
    assert.equal(url.searchParams.get('f'), 'geojson');
    assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
    assert.equal(url.searchParams.get('resultRecordCount'), '2000');
  }
});

test('normalizes roadway, AADT and history geometry separately', () => {
  assert.equal(normalizeTxdotRoadways(lineCollection).features.length, 1);
  assert.equal(normalizeTxdotAadt(lineCollection).features.length, 1);
  assert.equal(normalizeTxdotAadtHistory(historyCollection).features.length, 1);
});

test('TxDOT metrics SQL keeps road, current AADT and station trend distinct', () => {
  const sql = buildTxdotParcelMetricsSql(parcel, {
    roadways: lineCollection,
    aadt: lineCollection,
    history: historyCollection,
  });

  assert.match(sql, /nearest_road_m/);
  assert.match(sql, /road_centerline_intersects_parcel/);
  assert.match(sql, /nearest_aadt_current/);
  assert.match(sql, /nearest_station_5yr_change_percent/);
  assert.match(sql, /ST_DWithin/);
  assert.match(sql, /16093\.44/);
});

test('rejects capped TxDOT source collections instead of treating them as complete', () => {
  const capped = {
    type: 'FeatureCollection',
    features: Array.from({ length: 2000 }, () => lineCollection.features[0]),
  };
  assert.throws(() => normalizeTxdotRoadways(capped), /capped/);
});
