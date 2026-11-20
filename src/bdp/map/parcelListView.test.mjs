import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortMappedParcels } from './parcelListView.js';

const rows=[
  {county:'Travis',parcelId:'00042',label:'1303 Ridgehaven Dr',acresReported:0.21},
  {county:'Travis',parcelId:'00001',label:'201 East Main',acresReported:null},
  {county:'Travis',parcelId:'00077',label:'1445 Northridge',acresReported:2.5},
  {county:'Travis',parcelId:'00060',label:'1205 South St',acresReported:0.38},
];
test('search matches only actual address/source ID and never asserts for-sale status',()=>{
  const a=filterAndSortMappedParcels(rows,{search:'00042'});
  assert.deepEqual(a.records.map(x=>x.parcelId),['00042']);
  const b=filterAndSortMappedParcels(rows,{search:'ridge'});
  assert.deepEqual(b.records.map(x=>x.parcelId),['00042','00077']);
  assert.equal(filterAndSortMappedParcels(rows,{search:'for sale'}).records.length,0);
  assert.equal(rows.length,4);
});
test('acreage filter excludes missing acres as unknown, not zero or unsuitable land',()=>{
  const a=filterAndSortMappedParcels(rows,{minAcres:'0.25',maxAcres:'1'});
  assert.deepEqual(a.records.map(x=>x.parcelId),['00060']);
  assert.equal(a.unknownExcluded,1);
  const b=filterAndSortMappedParcels(rows,{maxAcres:'0.1'});
  assert.equal(b.records.length,0);
  assert.equal(b.unknownExcluded,1);
});
test('sort puts missing-acreage source last for both descending and ascending',()=>{
  assert.deepEqual(filterAndSortMappedParcels(rows,{sort:'acres-desc'}).records.map(x=>x.parcelId),
    ['00077','00060','00042','00001']);
  assert.deepEqual(filterAndSortMappedParcels(rows,{sort:'acres-asc'}).records.map(x=>x.parcelId),
    ['00042','00060','00077','00001']);
});
test('inverted acreage range is not treated as approval or emptiness of a county',()=>{
  const a=filterAndSortMappedParcels(rows,{minAcres:'4',maxAcres:'2'});
  assert.equal(a.invalidRange,true);
  assert.equal(a.records.length,0);
});
test('invalid/empty acreage controls do not silently restrict source records',()=>{
  assert.equal(filterAndSortMappedParcels(rows,{minAcres:'nonsense'}).records.length,4);
  assert.equal(filterAndSortMappedParcels(rows).records.length,4);
});
