import assert from 'node:assert/strict';
import test from 'node:test';
import { AUSTIN_SOURCE_LAYERS, buildAustinPointQueryUrl, summarizeAustinPointResponse, austinParcelBounds, buildAustinParcelCandidateQueryUrl, validateAustinCandidateCollection, buildAustinJurisdictionAttributeQueryUrl, summarizeAustinJurisdictionCandidates } from './austinSourceContract.js';

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


const parcelShape = {
  type: 'Polygon', coordinates: [[
    [-97.759, 30.246], [-97.757, 30.246], [-97.757, 30.248],
    [-97.759, 30.248], [-97.759, 30.246],
  ]],
};

test('parcels must use bounded geometry candidates, never pretend one point covers the tract', () => {
  const url = buildAustinParcelCandidateQueryUrl('zoning', parcelShape);
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.equal(url.searchParams.get('outSR'), '4326');
  assert.equal(url.searchParams.get('returnGeometry'), 'true');
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.equal(url.searchParams.get('resultRecordCount'), '100');
  assert.equal(url.searchParams.get('geometry'), '-97.759,30.246,-97.757,30.248');
  assert.deepEqual([...austinParcelBounds(parcelShape)], [-97.759, 30.246, -97.757, 30.248]);
  assert.throws(() => buildAustinParcelCandidateQueryUrl('zoning', null), /Full Polygon/);
  assert.throws(() => buildAustinParcelCandidateQueryUrl('zoning', parcelShape, {limit: 900}), /limit/);
});

test('multipart parcel extents include both polygons and reject malformed rings', () => {
  const second = { type: 'Polygon', coordinates: [[
    [-97.755, 30.244], [-97.754, 30.244], [-97.754, 30.245],
    [-97.755, 30.245], [-97.755, 30.244],
  ]] };
  assert.deepEqual(austinParcelBounds({
    type: 'MultiPolygon', coordinates: [parcelShape.coordinates, second.coordinates],
  }), [-97.759, 30.244, -97.754, 30.248]);
  assert.throws(() => austinParcelBounds({
    type: 'Polygon', coordinates: [[[-97.759, 30.246], [-97.757, 30.246], [-97.757, 30.248], [-97.759, 30.248]]],
  }), /closed/);
});

test('an empty candidate result remains UNKNOWN, and capped or malformed results are rejected', () => {
  const empty = validateAustinCandidateCollection('zoning', {
    type: 'FeatureCollection', features: [],
  });
  assert.equal(empty.status, 'unknown-no-envelope-candidates');
  assert.equal(empty.exactOverlapCalculated, false);
  const match = validateAustinCandidateCollection('zoning', {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: parcelShape, properties: { ZONING_ZTYPE: 'SF-3' } }],
  });
  assert.equal(match.status, 'unverified-envelope-candidates');
  assert.equal(match.exactOverlapCalculated, false);
  assert.throws(() => validateAustinCandidateCollection('zoning', {
    type: 'FeatureCollection', features: [], exceededTransferLimit: true,
  }), /truncated/);
  assert.throws(() => validateAustinCandidateCollection('zoning', {
    type: 'FeatureCollection', features: [{ geometry: null, properties: {} }],
  }), /geometry/);
  assert.throws(() => validateAustinCandidateCollection('zoning', {
    type: 'FeatureCollection', features: Array.from({length:100}, ()=>({ type:'Feature', geometry: parcelShape, properties: {} })),
  }), /truncated/);
});


test('citywide jurisdiction polygon is requested as attributes-only, never giant geometry', () => {
  const url = buildAustinJurisdictionAttributeQueryUrl(parcelShape);
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(url.searchParams.get('f'), 'json');
  assert.equal(url.searchParams.get('returnGeometry'), 'false');
  assert.equal(url.searchParams.get('geometry'), '-97.759,30.246,-97.757,30.248');
  assert.equal(url.searchParams.get('outSR'), null);
  assert.equal(url.searchParams.get('outFields'),
    'CITY_NAME,JURISDICTION_TYPE,JURISDICTION_TYPE_SPECIFICS');
});

test('jurisdiction envelope attributes never claim parcel intersection or legal jurisdiction', () => {
  const source = { features: [{ attributes: {
    CITY_NAME: 'CITY OF AUSTIN',
    JURISDICTION_TYPE: 'FULL',
    JURISDICTION_TYPE_SPECIFICS: 'FULL PURPOSE',
  } }] };
  const answer = summarizeAustinJurisdictionCandidates(source);
  assert.equal(answer.candidateCount, 1);
  assert.equal(answer.status, 'unverified-envelope-attribute-candidates');
  assert.equal(answer.geometryReturned, false);
  assert.equal(answer.exactOverlapCalculated, false);
  assert.deepEqual(answer.features.map((f) => f.properties.CITY_NAME), ['CITY OF AUSTIN']);
  assert.equal(summarizeAustinJurisdictionCandidates({features: []}).status,
    'unknown-no-envelope-candidates');
  assert.throws(() => summarizeAustinJurisdictionCandidates({
    features: source.features, exceededTransferLimit: true,
  }), /capped/);
  assert.throws(() => summarizeAustinJurisdictionCandidates({
    features: [{ geometry: parcelShape }],
  }), /lacks attributes/);
  assert.throws(() => summarizeAustinJurisdictionCandidates({
    features: Array.from({length: 100}, ()=>source.features[0]),
  }), /capped/);
});
