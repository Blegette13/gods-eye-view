import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAustinOverlapSql,
  summarizeAustinOverlapQuery,
} from './austinParcelOverlap.js';

const parcel = {
  type: 'Polygon',
  coordinates: [[
    [-97.758,30.246],[-97.756,30.246],[-97.756,30.248],
    [-97.758,30.248],[-97.758,30.246],
  ]],
};
const polygon = (west, east) => ({
  type: 'Polygon',
  coordinates: [[
    [west,30.245],[east,30.245],[east,30.249],
    [west,30.249],[west,30.245],
  ]],
});
const collection = (features) => ({type:'FeatureCollection', features});
const zoneFeature = (z='SF-3-NP') => ({
  type:'Feature', geometry:polygon(-97.759,-97.757),
  properties:{ZONING_ZTYPE:z,ZONING_BASE:'SF'},
});
const etodFeature = () => ({
  type:'Feature', geometry:polygon(-97.757,-97.755),
  properties:{ZONING_OVERLAY_NAME:'ETOD Overlay Eligibility',
    ZONING_OVERLAY_SUB_NAME:'Subdistrict 2', ZONING_STATUS:'Eligible'},
});

test('SQL uses actual parcel and candidate polygon intersections in equal-area metres', () => {
  const sql=buildAustinOverlapSql(parcel,{
    zoning:collection([zoneFeature()]),
    etodOverlay:collection([etodFeature()]),
  });
  assert.match(sql,/ST_Intersection\(p.geom, c.geom\)/);
  assert.match(sql,/ST_Transform\(ST_Intersection\(p.geom, c.geom\), 5070\)/);
  assert.match(sql,/ST_IsValid\(geom\)/);
  assert.match(sql,/parcel_area_m2/);
  assert.match(sql,/legalZoningVerified', false/);
  assert.match(sql,/legalJurisdictionVerified', false/);
  assert.doesNotMatch(sql,/ST_MakeValid|ST_Simplify/);
  assert.match(sql, /SF-3-NP/);
  assert.match(sql, /ETOD Overlay Eligibility/);
});

test('missing, truncated, malformed, or non-polygon source rejects instead of clearance', () => {
  assert.throws(()=>buildAustinOverlapSql(parcel, {
    zoning:collection([]),
  }),/Both Austin/);
  assert.throws(()=>buildAustinOverlapSql(parcel,{
    zoning:{type:'FeatureCollection', features:[], exceededTransferLimit:true},
    etodOverlay:collection([]),
  }),/truncated/);
  assert.throws(()=>buildAustinOverlapSql(parcel,{
    zoning:collection([{type:'Feature',geometry:{type:'Point',coordinates:[-97.758,30.246]},properties:{}}]),
    etodOverlay:collection([]),
  }),/polygon geometry/);
});

test('raw SQL source attributes escape apostrophes and do not inject SQL', () => {
  const sql=buildAustinOverlapSql(parcel,{
    zoning:collection([zoneFeature("SF'3")]),
    etodOverlay:collection([etodFeature()]),
  });
  assert.match(sql,/SF''3/);
});

test('PostGIS output is preliminary spatial evidence, never legal or buying advice', () => {
  const result=summarizeAustinOverlapQuery({
    status:'preliminary-intersections-only',
    exactGeometryIntersectionsCalculated:true,
    parcelGeometryValid:true,
    allCandidateGeometriesValid:true,
    parcelAreaM2:250,
    overlaps:[{
      sourceName:'zoning', attributes:{ZONING_ZTYPE:'SF-3-NP'},
      intersectsParcel:true, sourceGeometryValid:true,
      areaM2:125, parcelPercent:50,
    },{
      sourceName:'etodOverlay', attributes:{ZONING_STATUS:'Eligible'},
      intersectsParcel:false, sourceGeometryValid:true,
      areaM2:0,parcelPercent:0,
    }],
  });
  assert.equal(result.status,'preliminary-spatial-evidence');
  assert.equal(result.observations[0].parcelPercent,50);
  assert.equal(result.observations[1].intersectsParcel,false);
  assert.equal(result.legalZoningVerified,false);
  assert.equal(result.legalJurisdictionVerified,false);
  assert.equal(result.acquisitionRecommendation,null);
  assert.equal(result.sourceTotalsNotSummed,true);
});

test('invalid/partial/unsafe area output stays unknown, never no-overlay clearance', () => {
  const baseline={
    status:'preliminary-intersections-only',
    exactGeometryIntersectionsCalculated:true,
    parcelGeometryValid:true,
    allCandidateGeometriesValid:true,
    parcelAreaM2:250,
    overlaps:[],
  };
  for (const changed of [
    {status:'invalid-parcel-geometry'},
    {allCandidateGeometriesValid:false},
    {exactGeometryIntersectionsCalculated:false},
    {parcelAreaM2:0},
    {overlaps:[{sourceName:'zoning',sourceGeometryValid:true,intersectsParcel:true,areaM2:2000,parcelPercent:800}]},
    {overlaps:[{sourceName:'zoning',sourceGeometryValid:true,intersectsParcel:true,areaM2:null,parcelPercent:null}]},
  ]) {
    assert.throws(()=>summarizeAustinOverlapQuery({...baseline,...changed}),/invalid|incomplete/i);
  }
});
