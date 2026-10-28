import assert from 'node:assert/strict';
import test from 'node:test';
import { AUSTIN_SOURCE_LAYERS, buildAustinPointQueryUrl, summarizeAustinPointResponse } from './austinSourceContract.js';

test('Austin GIS source registry includes city jurisdiction, actual zoning and named overlay', () => {
  assert.match(AUSTIN_SOURCE_LAYERS.jurisdiction.url, /maps\.austintexas\.gov.*JurisdictionsFill/);
  assert.match(AUSTIN_SOURCE_LAYERS.zoning.url, /maps\.austintexas\.gov.*Zoning_1/);
  assert.match(AUSTIN_SOURCE_LAYERS.etodOverlay.url, /maps\.austintexas\.gov.*Zoning_2/);
});

test('point queries use WGS84, requested fields, bounded count and ArcGIS intersect', () => {
  const url = buildAustinPointQueryUrl('zoning', -97.7578, 30.2466);
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryPoint');
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.equal(url.searchParams.get('returnGeometry'), 'false');
  assert.equal(url.searchParams.get('resultRecordCount'), '20');
  assert.equal(url.searchParams.get('f'), 'json');
  assert.equal(url.searchParams.get('spatialRel'), 'esriSpatialRelIntersects');
  assert.deepEqual(JSON.parse(url.searchParams.get('geometry')), {
    x: -97.7578, y: 30.2466, spatialReference: { wkid: 4326 },
  });
  assert.equal(url.searchParams.get('outFields'), 'ZONING_ZTYPE,ZONING_BASE');
  assert.throws(() => buildAustinPointQueryUrl('unknown', -97, 30), /Unknown/);
  assert.throws(() => buildAustinPointQueryUrl('zoning', NaN, 30), /WGS84/);
});

test('empty point zoning or jurisdiction results are unknown, never no-zoning clearance', () => {
  for (const name of Object.keys(AUSTIN_SOURCE_LAYERS)) {
    const out = summarizeAustinPointResponse(name, { features: [] });
    assert.equal(out.count, 0);
    assert.equal(out.status, 'unknown-no-point-match');
    assert.match(out.disclaimer, /NOT verified/);
  }
});

test('multiple classifications, capped results and malformed data fail conservative', () => {
  const feature = (base) => ({ attributes: { ZONING_ZTYPE: base, ZONING_BASE: base } });
  assert.equal(summarizeAustinPointResponse('zoning', {
    features: [feature('SF-3'), feature('CS')],
  }).status, 'ambiguous-multiple-point-matches');
  assert.equal(summarizeAustinPointResponse('zoning', {
    features: [feature('SF-3')], exceededTransferLimit: true,
  }).status, 'incomplete');
  assert.throws(() => summarizeAustinPointResponse('zoning', { error: { message: 'fail' } }), /valid ArcGIS/);
  assert.throws(() => summarizeAustinPointResponse('zoning', { features: [{ properties: {} }] }), /missing attributes/);
});
