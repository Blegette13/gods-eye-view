import test from 'node:test';
import assert from 'node:assert/strict';
import { geographicLabelUrls, fetchGeographicLabels } from './geographicLabels.js';

const polygon = { type:'Feature',
  geometry:{ type:'Polygon', coordinates:[[
    [-97.9,30.2],[-97.7,30.2],[-97.7,30.4],[-97.9,30.2],
  ]] },
};
test('navigation label endpoints use bounded Census / TxDOT geometry and credited data sources', () => {
  const urls = geographicLabelUrls({ countyFeature: polygon, point: {lon:-97.8,lat:30.3}, radiusMiles:25 });
  const city = new URL(urls.cities);
  const road = new URL(urls.highways);
  assert.match(city.hostname,/census\.gov$/);
  assert.match(road.hostname,/arcgis\.com$/);
  assert.equal(city.searchParams.get('returnGeometry'),'false');
  assert.equal(road.searchParams.get('f'),'geojson');
  assert.equal(road.searchParams.get('resultRecordCount'),'121');
  assert.match(road.searchParams.get('where'),/RTE_PRFX/);
  const unbounded = geographicLabelUrls({ countyFeature:polygon, point:null, radiusMiles:0 });
  assert.equal(new URL(unbounded.highways).searchParams.get('geometryType'),'esriGeometryEnvelope');
});

test('only real Census place points and named TxDOT road routes produce navigation labels', async () => {
  const records = await fetchGeographicLabels({
    countyFeature:polygon,point:{lon:-97.8,lat:30.3},radiusMiles:10,
    fetcher:async(url)=>({
      ok:true,
      async json(){
        if(url.includes('tigerweb'))return {
          features:[{ attributes:{BASENAME:'Austin',INTPTLAT:'+30.26',INTPTLON:'-97.74'} },
            { attributes:{BASENAME:'Unlocated',INTPTLAT:null,INTPTLON:null} }],
        };
        return {type:'FeatureCollection',features:[{
          properties:{RTE_NM:'IH 35',MAP_LBL:'IH 35'},
          geometry:{type:'LineString',coordinates:[[-97.75,30.3],[-97.74,30.31]]},
        }]};
      },
    }),
  });
  assert.equal(records.cityLabels.length,1);
  assert.equal(records.highwayLabels.length,1);
  assert.equal(records.cityLabels[0].name,'Austin');
  assert.equal(records.highwayLabels[0].name,'IH 35');
  assert.deepEqual(records.errors,[]);
});

test('one label provider can fail without fabricating names for the missing source',async()=>{
  const records=await fetchGeographicLabels({
    countyFeature:polygon,point:{lon:-97.8,lat:30.3},
    fetcher:async (url)=>url.includes('tigerweb')
      ? {ok:false,status:503}
      : {ok:true,json:async()=>({type:'FeatureCollection',features:[]})},
  });
  assert.equal(records.cityLabels.length,0);
  assert.equal(records.highwayLabels.length,0);
  assert.deepEqual(records.errors,['Census places']);
});
