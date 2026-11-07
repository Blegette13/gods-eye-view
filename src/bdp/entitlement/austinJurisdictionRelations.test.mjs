import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUSTIN_JURISDICTION_RELATIONS,
  buildAustinJurisdictionRelationUrl,
  validateAustinJurisdictionRelationResponse,
  summarizeAustinJurisdictionRelations,
} from './austinJurisdictionRelations.js';

const geometry = { type: 'Polygon', coordinates: [[
  [-97.758,30.246],[-97.756,30.246],[-97.756,30.248],
  [-97.758,30.248],[-97.758,30.246],
]] };
const feature = (id=101, name='CITY OF AUSTIN', type='FULL') => ({
  attributes: { OBJECTID:id, CITY_NAME:name, JURISDICTION_TYPE:type,
    JURISDICTION_TYPE_SPECIFICS: type==='FULL'?'FULL PURPOSE':'ETJ' },
});
const answer = (...features) => ({ features });

test('full-extent jurisdiction relations run on ArcGIS without downloading city polygons', () => {
  for (const relation of Object.keys(AUSTIN_JURISDICTION_RELATIONS)) {
    const url = buildAustinJurisdictionRelationUrl(geometry, relation);
    assert.match(url.hostname,/austintexas\.gov/);
    assert.equal(url.searchParams.get('geometry'),'-97.758,30.246,-97.756,30.248');
    assert.equal(url.searchParams.get('geometryType'),'esriGeometryEnvelope');
    assert.equal(url.searchParams.get('spatialRel'),AUSTIN_JURISDICTION_RELATIONS[relation]);
    assert.equal(url.searchParams.get('returnGeometry'),'false');
    assert.equal(url.searchParams.get('inSR'),'4326');
    assert.equal(url.searchParams.get('resultRecordCount'),'100');
    assert.equal(url.searchParams.get('outFields'),
      'OBJECTID,CITY_NAME,JURISDICTION_TYPE,JURISDICTION_TYPE_SPECIFICS');
  }
  assert.throws(() => buildAustinJurisdictionRelationUrl(geometry,'bad'),/Unsupported/);
  assert.throws(() => buildAustinJurisdictionRelationUrl(null,'touchesEnvelope'),/Full Polygon/);
});

test('single GIS feature containing entire envelope remains preliminary jurisdiction evidence', () => {
  const result = summarizeAustinJurisdictionRelations(answer(feature()),answer(feature()));
  assert.equal(result.status,'single-gis-feature-contains-parcel-envelope');
  assert.equal(result.intersectsCandidateCount,1);
  assert.equal(result.envelopeContainingCandidateCount,1);
  assert.equal(result.candidateJurisdictions[0].type,'FULL');
  assert.equal(result.sourceGeometryDownloaded,false);
  assert.equal(result.parcelIntersectionAreaCalculated,false);
  assert.equal(result.exactParcelJurisdictionVerified,false);
  assert.equal(result.legalJurisdictionVerified,false);
  assert.equal(result.sourceCurrencyVerified,false);
  assert.equal(result.regulatoryEntitlementVerified,false);
  assert.equal(result.acquisitionRecommendation,null);
});

test('overlapping jurisdictions, boundary-straddling envelopes and missing records never infer a controlling city', () => {
  assert.equal(summarizeAustinJurisdictionRelations(
    answer(feature(),feature(102,'OTHER CITY','ETJ')),answer(feature())
  ).status, 'multiple-jurisdiction-features-boundary-review');
  assert.equal(summarizeAustinJurisdictionRelations(
    answer(feature()),answer()
  ).status, 'unknown-envelope-not-contained');
  assert.equal(summarizeAustinJurisdictionRelations(
    answer(),answer()
  ).status, 'unknown-no-candidates');
});

test('missing IDs, duplicates, invalid values, capped responses and inconsistent relations fail closed', () => {
  assert.throws(() => validateAustinJurisdictionRelationResponse({
    features:[feature()],exceededTransferLimit:true
  }),/capped/);
  assert.throws(() => validateAustinJurisdictionRelationResponse(answer(feature(), feature())),/Duplicate/);
  assert.throws(() => validateAustinJurisdictionRelationResponse(answer({
    attributes: { CITY_NAME:'AUSTIN', JURISDICTION_TYPE:'FULL', JURISDICTION_TYPE_SPECIFICS:'FULL PURPOSE' }
  })),/missing required/);
  assert.throws(() => validateAustinJurisdictionRelationResponse(answer({
    attributes: { ...feature().attributes, JURISDICTION_TYPE:null }
  })),/missing required/);
  assert.throws(() => summarizeAustinJurisdictionRelations(
    answer(feature(201)),answer(feature(202))
  ),/inconsistent/);
  assert.throws(() => summarizeAustinJurisdictionRelations(
    answer(feature()),{ error:{ message:'unavailable' } }
  ),/invalid/);
  assert.throws(() => summarizeAustinJurisdictionRelations(
    answer(feature()),{ features: Array.from({length:100}, (_,n)=>feature(n)) }
  ),/capped/);
});
