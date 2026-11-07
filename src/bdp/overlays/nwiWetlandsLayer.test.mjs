import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NWI_WETLANDS_LAYER_URL,
  buildNwiWetlandsQueryUrl,
  classifyWetlandFeature,
} from './nwiWetlandsLayer.js';

test('builds bounded official NWI GeoJSON query', () => {
  const url = new URL(buildNwiWetlandsQueryUrl({
    west: -98.7,
    south: 29.2,
    east: -98.4,
    north: 29.5,
  }, { limit: 900 }));

  assert.equal(`${url.origin}${url.pathname}`, NWI_WETLANDS_LAYER_URL);
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.equal(url.searchParams.get('outSR'), '4326');
  assert.equal(url.searchParams.get('resultRecordCount'), '900');
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.match(url.searchParams.get('outFields'), /ATTRIBUTE/);
});

test('classifies common NWI types from type labels or Cowardin codes', () => {
  assert.equal(classifyWetlandFeature({ properties: { WETLAND_TYPE: 'Freshwater Emergent Wetland' } }), 'emergent');
  assert.equal(classifyWetlandFeature({ properties: { WETLAND_TYPE: 'Freshwater Forested/Shrub Wetland' } }), 'forested');
  assert.equal(classifyWetlandFeature({ properties: { WETLAND_TYPE: 'Freshwater Pond' } }), 'pond');
  assert.equal(classifyWetlandFeature({ properties: { ATTRIBUTE: 'R5UBH' } }), 'riverine');
  assert.equal(classifyWetlandFeature({ properties: { ATTRIBUTE: 'E2EM1P' } }), 'coastal');
});
