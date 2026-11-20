import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPrivateSealedGeometryReadBoundary } from './parcelPrivateGeometryReadBoundary.js';
import { PRIVATE_SEALED_INITIAL_RPC_SQL } from './parcelSealedInitialPagePlan.js';
import { PRIVATE_PARCEL_KEYSET_RPC_SQL } from './parcelKeysetPagination.js';

const NOW=1_000_000;
const KEY=Buffer.alloc(32,0x3a);
const HANDLE=Buffer.alloc(32,0x19).toString('base64url');
const DIGEST='a'.repeat(64);
const REVISION='b'.repeat(64);
const HASH='c'.repeat(64);
const polygon=()=>({
  type:'MultiPolygon',
  coordinates:[[[[-97.75,30.25],[-97.74,30.25],[-97.74,30.26],
    [-97.75,30.26],[-97.75,30.25]]]],
});
const raw=(id,version,geometry=polygon())=>({
  parcel_version_id:version, source_parcel_id:id,
  source_version:'synthetic-v1',source_geometry_sha256:HASH,
  ingest_run_id:'42',source_id:'travis-cad',county_fips:'48453',
  geometry_vertices:5,geometry_memory_bytes:240,geometry,
});
const page=()=>[
  raw('P-001','1'),raw('P-002','2'),raw('P-003','3',null),
];
const authority=()=>({
  allowed:true,countyFips:'48453',
  trustedSource:{
    sourceId:'travis-cad',countyFips:'48453',rightsState:'approved',
    approvedCachingUntilMs:NOW + 300_000,
  },
  trustedPublicationRights:{
    sourceId:'travis-cad',countyFips:'48453',reviewState:'approved',
    reviewReference:'synthetic/review',allowGeometryRedistribution:true,
    reviewedAtMs:NOW - 1_000,expiresAtMs:NOW + 200_000,
  },
  trustedRunId:42,sessionDigest:DIGEST,publicationRevision:REVISION,
});
const request=()=>({
  countyFips:'48453',
  bounds:{west:-97.76,south:30.24,east:-97.73,north:30.27},
  limit:2,
});
const call=(overrides={})=>({
  sessionHandle:HANDLE, request:request(),cursorToken:null,
  signal:new AbortController().signal,...overrides,
});
const deny={
  status:'unavailable',publishAuthorized:false,
  viewportCoverage:'unknown',geometryDelivered:false,
};
function setup({
  load=async()=>authority(), quota=async()=>true,
  query=async()=>page(), now=()=>NOW,
}={}) {
  const seen=[];
  const boundary=createPrivateSealedGeometryReadBoundary({
    hmacKey:KEY,now,
    loadCurrentAuthority:async (...args)=>{
      seen.push('authority');return load(...args);
    },
    consumeQuota:async (...args)=>{
      seen.push('quota');return quota(...args);
    },
    querySealedRpc:async (...args)=>{
      seen.push('query');return query(...args);
    },
  });
  return {boundary,seen};
}

test('constructor refuses missing collaborators or insufficient HMAC secret', () => {
  const valid={
    hmacKey:KEY,loadCurrentAuthority:async()=>authority(),
    consumeQuota:async()=>true,querySealedRpc:async()=>page(),
  };
  assert.throws(()=>createPrivateSealedGeometryReadBoundary(),TypeError);
  assert.throws(()=>createPrivateSealedGeometryReadBoundary({
    ...valid,hmacKey:Buffer.alloc(8),
  }),TypeError);
  assert.throws(()=>createPrivateSealedGeometryReadBoundary({
    ...valid,consumeQuota:null,
  }),TypeError);
});

test('first page requires pre-access, atomic quota, sealed RPC, validation and post-access', async()=>{
  const {boundary,seen}=setup({query:async({statement,signal})=>{
    assert.equal(statement.text,PRIVATE_SEALED_INITIAL_RPC_SQL);
    assert.deepEqual(statement.values,[
      '48453','travis-cad',42,-97.76,30.24,-97.73,30.27,3,
    ]);
    assert.ok(Object.isFrozen(statement));
    assert.ok(Object.isFrozen(statement.values));
    assert.ok(signal instanceof AbortSignal);
    return page();
  }});
  const result=await boundary.readPrivatePage(call());
  assert.deepEqual(seen,['authority','quota','query','authority']);
  assert.equal(result.status,'validated-private');
  assert.equal(result.featureCount,2);
  assert.equal(result.overflow,true);
  assert.equal(typeof result.nextPrivateCursor,'string');
  assert.equal(result.publishAuthorized,false);
  assert.equal(result.geometryDelivered,false);
  assert.equal(result.viewportCoverage,'unknown');
  assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify(result).includes('coordinates'),false);
  assert.equal(JSON.stringify(result).includes(HANDLE),false);
  assert.equal(JSON.stringify(result).includes('travis-cad'),false);
});

test('signed continuation uses only fixed keyset RPC and remains private',async()=>{
  const queries=[];
  const {boundary}=setup({query:async({statement})=>{
    queries.push(statement);
    return queries.length===1?page():[
      raw('P-003','3'),raw('P-004','4'),
    ];
  }});
  const first=await boundary.readPrivatePage(call());
  assert.equal(first.status,'validated-private');
  const next=await boundary.readPrivatePage(call({cursorToken:first.nextPrivateCursor}));
  assert.equal(next.status,'validated-private');
  assert.equal(next.featureCount,2);
  assert.equal(next.overflow,false);
  assert.equal(next.nextPrivateCursor,null);
  assert.equal(queries[1].text,PRIVATE_PARCEL_KEYSET_RPC_SQL);
  assert.deepEqual(queries[1].values.slice(-2),['P-002','2']);
});

test('invalid request, supplied source, role, forged authority or bad handle stops before lookup',async()=>{
  const {boundary,seen}=setup();
  for (const unsafe of [
    null,{},call({sessionHandle:'admin'}),
    call({sessionHandle:Buffer.alloc(32,1).toString('hex')}),
    call({request:{...request(),sourceId:'other-cad'}}),
    call({request:{...request(),admin:true}}),
    call({request:{...request(),bounds:{...request().bounds,sql:'SELECT 1'}}}),
    call({cursorToken:10}),
    call({request:{...request(),bounds:{...request().bounds,east:-96.5}}}),
    call({metadataOnly:false}),
  ]) assert.deepEqual(await boundary.readPrivatePage(unsafe),deny);
  assert.deepEqual(seen,[]);
});

test('denied preflight, expired rights or wrong county never consumes quota or runs SQL',async()=>{
  for (const auth of [
    null,{...authority(),allowed:false},
    {...authority(),allowed:'true'},
    {...authority(),countyFips:'48029'},
    {...authority(),trustedRunId:0},
    {...authority(),trustedSource:{
      ...authority().trustedSource,rightsState:'revoked',
    }},
    {...authority(),trustedPublicationRights:{
      ...authority().trustedPublicationRights,allowGeometryRedistribution:false,
    }},
    {...authority(),sessionDigest:'not-a-digest'},
    {...authority(),trustedSource:{...authority().trustedSource,
      sourceId:'other-cad'}},
    {...authority(),role:'admin'},
  ]) {
    const {boundary,seen}=setup({load:async()=>auth});
    assert.deepEqual(await boundary.readPrivatePage(call()),deny);
    assert.deepEqual(seen,['authority']);
  }
});

test('quota must return EXACT true, and quota exceptions cannot access SQL',async()=>{
  for(const quota of [async()=>false,async()=>1,async()=>({allowed:true}),
    async()=>{throw Error('PRIVATE QUOTA DB INFO');}]) {
    const {boundary,seen}=setup({quota});
    assert.deepEqual(await boundary.readPrivatePage(call()),deny);
    assert.deepEqual(seen,['authority','quota']);
  }
});

test('invalid, oversized, unexpected or corrupt SQL records are not returned',async()=>{
  const bad=[
    null,{},'SELECT 1',
    [...page(),raw('P-004','4')],
    page().map((x,i)=>i===0?{...x,ownerName:'PRIVATE'}:x),
    page().map((x,i)=>i===1?{...x,source_geometry_sha256:'bad'}:x),
    page().map((x,i)=>i===2?{...x,geometry:polygon()}:x),
    [...page()].reverse(),
  ];
  for(const rows of bad) {
    const {boundary,seen}=setup({query:async()=>rows});
    assert.deepEqual(await boundary.readPrivatePage(call()),deny);
    assert.deepEqual(seen,['authority','quota','query']);
  }
});

test('revoked publication, source caching, session and changed policy revision after SQL deny',async()=>{
  const changes=[
    {...authority(),allowed:false},
    {...authority(),sessionDigest:'d'.repeat(64)},
    {...authority(),publicationRevision:'e'.repeat(64)},
    {...authority(),trustedRunId:43},
    {...authority(),trustedSource:{...authority().trustedSource,
      rightsState:'revoked'}},
    {...authority(),trustedPublicationRights:{
      ...authority().trustedPublicationRights,
      expiresAtMs:NOW,
    }},
  ];
  for(const last of changes) {
    let called=0;
    const {boundary,seen}=setup({load:async()=>{
      called++;return called===1?authority():last;
    }});
    assert.deepEqual(await boundary.readPrivatePage(call()),deny);
    assert.deepEqual(seen,['authority','quota','query','authority']);
  }
});

test('exceptions from authority or SQL are generic, never leak geometry or reviewer details',async()=>{
  for(const options of [
    {load:async()=>{throw Error('PRIVATE SESSION LOOKUP');}},
    {query:async()=>{throw Error('PRIVATE POSTGIS SQL DETAILS');}},
  ]) {
    const {boundary}=setup(options);
    const result=await boundary.readPrivatePage(call());
    assert.deepEqual(result,deny);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
});

test('malformed/expired or tampered cursor is denied without triggering a SQL query',async()=>{
  const {boundary}=setup();
  const first=await boundary.readPrivatePage(call());
  for (const bad of ['garbage',first.nextPrivateCursor+'evil',
    first.nextPrivateCursor.slice(1),
    first.nextPrivateCursor+'.another']) {
    const {boundary:other,seen}=setup();
    assert.deepEqual(await other.readPrivatePage(call({cursorToken:bad})),deny);
    assert.deepEqual(seen,['authority','quota']);
  }
});

test('cancellation before preflight or after query prevents private result release',async()=>{
  const controller=new AbortController();
  controller.abort();
  const early=setup();
  const earlyResponse=await early.boundary.readPrivatePage(call({
    signal:controller.signal,
  }));
  assert.equal(earlyResponse.status,'cancelled');
  assert.deepEqual(early.seen,[]);
  const later=new AbortController();
  const second=setup({query:async()=>{
    later.abort();return page();
  }});
  const laterResponse=await second.boundary.readPrivatePage(call({
    signal:later.signal,
  }));
  assert.equal(laterResponse.status,'cancelled');
  assert.deepEqual(second.seen,['authority','quota','query']);
});

test('a zero-row page is not evidence that viewport or county was evaluated',async()=>{
  const {boundary}=setup({query:async()=>[]});
  const outcome=await boundary.readPrivatePage(call());
  assert.equal(outcome.status,'validated-private');
  assert.equal(outcome.featureCount,0);
  assert.equal(outcome.nextPrivateCursor,null);
  assert.equal(outcome.viewportCoverage,'unknown');
  assert.equal(outcome.geometryDelivered,false);
});

test('module cannot serve an HTTP response, instantiate database client or mount Cesium',()=>{
  const code=readFileSync(new URL('./parcelPrivateGeometryReadBoundary.js',
    import.meta.url),'utf8');
  assert.doesNotMatch(code,/createServer\(|\.listen\(|new Pool\(|fetch\(/);
  assert.doesNotMatch(code,/GRANT EXECUTE|CREATE ROLE|CREATE TABLE|response\.end\(/);
  assert.match(code,/UNROUTED, PRIVATE-ONLY/);
  assert.match(code,/loadCurrentAuthority/);
  assert.match(code,/validatePrivateSealedGeometryPage/);
});
