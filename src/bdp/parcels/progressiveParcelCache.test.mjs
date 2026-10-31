import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressiveParcelCache } from './progressiveParcelCache.js';

const view = {west:-97.8,south:30.2,east:-97.7,north:30.3};
const bounds=(west,south,east,north)=>({west,south,east,north});
const parcel=(id,lon,lat)=>({
  id:'48453:'+id,parcelId:id,county:'Travis',source:{sourceNotice:'County GIS only'},
  property:{geometry:{type:'Polygon',coordinates:[[
    [lon,lat],[lon+0.001,lat],[lon+0.001,lat+0.001],[lon,lat],
  ]]},acres:0.5},
});
function snapshot(records,area,omitted=0) {
  const list=[...records];
  Object.defineProperty(list,'viewportCoverage',{value:{
    focalOnly:true,focalBounds:area,omittedUnidentified:omitted,
    receivedCount:list.length+omitted,
  }});
  return list;
}

test('progressive discovery retains two real source windows while panning and never asserts full viewport',()=>{
  let tick=1000;
  const cache=createProgressiveParcelCache({now:()=>tick,maxWindows:3});
  const first=bounds(-97.78,30.23,-97.75,30.26);
  const second=bounds(-97.75,30.23,-97.72,30.26);
  const a=cache.add({county:'Travis',viewBounds:view,
    records:snapshot([parcel('0001',-97.77,30.24)],first)});
  assert.equal(a.length,1);
  tick+=10;
  const b=cache.add({county:'Travis',viewBounds:view,
    records:snapshot([parcel('0002',-97.735,30.24)],second)});
  assert.equal(cache.size(),2);
  assert.deepEqual(b.map((x)=>x.parcelId),['0002','0001']);
  assert.equal(b.viewportCoverage.focalOnly,true);
  assert.equal(b.viewportCoverage.progressive,true);
  assert.equal(b.viewportCoverage.focalBoundsList.length,2);
  assert.equal(b.viewportCoverage.omittedUnidentified,0);
  assert.equal(b.viewportCoverage.receivedCount,2);
});

test('covered central footprint reuses previously queried parcels, without repeating GIS requests',()=>{
  const cache=createProgressiveParcelCache();
  cache.add({county:'Travis',viewBounds:view,
    records:snapshot([parcel('002',-97.745,30.252)],
      bounds(-97.78,30.22,-97.72,30.28))});
  const reused=cache.reuse({county:'Travis',viewBounds:view});
  assert.ok(reused);
  assert.equal(reused.viewportCoverage.cached,true);
  assert.equal(reused[0].parcelId,'002');
  assert.equal(cache.reuse({county:'Bexar',viewBounds:view}),null,
    'a county source can never leak into a different county');
  assert.equal(cache.reuse({county:'Travis',
    viewBounds:bounds(-97.68,30.3,-97.6,30.4)}),null);
});

test('stale records are never reused, even when their old boundaries overlap new focus',()=>{
  let tick=0;
  const cache=createProgressiveParcelCache({now:()=>tick,ttlMs:1000});
  cache.add({county:'Travis',viewBounds:view,
    records:snapshot([parcel('2',-97.74,30.25)],
      bounds(-97.78,30.22,-97.72,30.28))});
  tick=1001;
  assert.equal(cache.reuse({county:'Travis',viewBounds:view}),null);
  assert.equal(cache.size(),0);
});

test('partial source responses, duplicate IDs and unknown polygons are never cached',()=>{
  const cache=createProgressiveParcelCache();
  const box=bounds(-97.78,30.22,-97.72,30.28);
  assert.equal(cache.add({county:'Travis',viewBounds:view,
    records:snapshot([parcel('3',-97.75,30.24)],box,2)}),null);
  assert.equal(cache.add({county:'Travis',viewBounds:view,
    records:snapshot([parcel('4',-97.75,30.24),parcel('4',-97.75,30.24)],box)}),null);
  assert.equal(cache.add({county:'Travis',viewBounds:view,
    records:snapshot([{id:'48453:5',parcelId:'5',property:{geometry:null}}],box)}),null);
  assert.equal(cache.size(),0);
});

test('maxRecords is a hard budget and never silently truncates a complete older tile',()=>{
  const cache=createProgressiveParcelCache({maxWindows:3,maxRecords:2});
  const a=bounds(-97.78,30.22,-97.75,30.28),b=bounds(-97.75,30.22,-97.72,30.28);
  cache.add({county:'Travis',viewBounds:view,records:snapshot([
    parcel('1',-97.775,30.25),parcel('2',-97.77,30.25),
  ],a)});
  const merged=cache.add({county:'Travis',viewBounds:view,records:snapshot([
    parcel('3',-97.735,30.25),
  ],b)});
  assert.equal(merged.length,1);
  assert.equal(merged.viewportCoverage.focalBoundsList.length,1,
    'only completely represented source query windows can be outlined');
  assert.equal(merged[0].parcelId,'3');
});

test('cache rejects invalid budgets and clears session data',()=>{
  assert.throws(()=>createProgressiveParcelCache({maxRecords:1001}),/Invalid/);
  const cache=createProgressiveParcelCache();
  cache.add({county:'Travis',viewBounds:view,records:snapshot([],bounds(-97.78,30.22,-97.72,30.28))});
  assert.equal(cache.size(),1,'empty but complete source window is safe to cache');
  cache.clear();
  assert.equal(cache.size(),0);
});
