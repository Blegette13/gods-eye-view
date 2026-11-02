import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createPrivateSealedGeometryRuntime,
} from '../../../server/providers/bdp-parcel-sealed-geometry-runtime.js';
import {
  createFixedSealedGeometryRpcReader,
  SEALED_GEOMETRY_ROLE_ATTESTATION_SQL,
} from '../../../server/providers/bdp-parcel-sealed-geometry-rpc.js';
import { PRIVATE_SEALED_INITIAL_RPC_SQL } from './parcelSealedInitialPagePlan.js';
import { PRIVATE_PARCEL_KEYSET_RPC_SQL } from './parcelKeysetPagination.js';

const NOW = 1_000_000;
const SESSION_KEY = Buffer.alloc(32, 0x11);
const CURSOR_KEY = Buffer.alloc(32, 0x22);
const HANDLE = Buffer.alloc(32, 0x33).toString('base64url');
const HASH = 'c'.repeat(64);
const DENIED = {
  status:'unavailable', publishAuthorized:false,
  viewportCoverage:'unknown', geometryDelivered:false,
};
const proofKeys = [
  'same_principal','safe_principal','no_schema_create',
  'no_source_table','no_run_table','no_seal_table',
  'no_parcel_table','no_coverage_table','no_rights_table',
  'sealed_initial_allowed','sealed_keyset_allowed',
  'unsealed_snapshot_denied','metadata_source_denied',
  'metadata_viewport_denied',
];
const proof = () => Object.fromEntries(proofKeys.map(key => [key,true]));
const polygon = () => ({
  type:'MultiPolygon',
  coordinates:[[[[-97.75,30.25],[-97.74,30.25],[-97.74,30.26],
    [-97.75,30.26],[-97.75,30.25]]]],
});
const row = (id,version,geometry=polygon()) => ({
  parcel_version_id:version,source_parcel_id:id,
  source_version:'synthetic-v1',source_geometry_sha256:HASH,
  ingest_run_id:'42',source_id:'travis-cad',county_fips:'48453',
  geometry_vertices:5,geometry_memory_bytes:240,geometry,
});
const page = () => [row('P-001','1'),row('P-002','2'),row('P-003','3',null)];
const record = () => ({
  sessionDigest:createHmac('sha256',SESSION_KEY).update(HANDLE,'utf8').digest('hex'),
  subject:'test-operator',accountStatus:'active',mfaVerified:true,revokedAtMs:null,
  issuedAtMs:NOW-100_000,lastSeenAtMs:NOW-1_000,expiresAtMs:NOW+300_000,
  countyGrants:[{countyFips:'48453',allowParcelDiscovery:true}],
});
const source = () => ({
  sourceId:'travis-cad',countyFips:'48453',rightsState:'approved',
  approvedCachingUntilMs:NOW+300_000,runId:42,sourceVersion:'synthetic-v1',
  sealedAtMs:NOW-5_000,indexedRecords:4,sealedRun:true,
});
const review = () => ({
  sourceId:'travis-cad',countyFips:'48453',reviewState:'approved',
  allowGeometryRedistribution:true,reviewReference:'synthetic/review',
  reviewedAtMs:NOW-10_000,expiresAtMs:NOW+200_000,
});
const request = () => ({
  countyFips:'48453',
  bounds:{west:-97.76,south:30.24,east:-97.73,north:30.27},
  limit:2,
});
const call = (overrides={}) => ({
  sessionHandle:HANDLE,request:request(),cursorToken:null,
  signal:new AbortController().signal,...overrides,
});

function setup({
  session=async()=>record(),sealed=async()=>source(),
  rights=async()=>review(),quota=async()=>true,
  dbProof=proof(),dbRows=async()=>page(),
}={}) {
  const calls = [];
  let checkouts=0;
  const runtime=createPrivateSealedGeometryRuntime({
    sessionHmacKey:SESSION_KEY,cursorHmacKey:CURSOR_KEY,now:()=>NOW,
    findSessionByDigest:async(digest)=>{
      calls.push('session');
      assert.match(digest,/^[0-9a-f]{64}$/);
      return session(digest);
    },
    readSealedSource:async(args)=>{
      calls.push('source');return sealed(args);
    },
    readPublicationReview:async(args)=>{
      calls.push('rights');return rights(args);
    },
    consumeQuota:async(args)=>{
      calls.push('quota');return quota(args);
    },
    connect:async()=>{
      checkouts++;
      calls.push('connect');
      return {
        async query(statement) {
          if(statement==='BEGIN TRANSACTION READ ONLY') {
            calls.push('begin');return {rows:[]};
          }
          if(statement===SEALED_GEOMETRY_ROLE_ATTESTATION_SQL) {
            calls.push('role');return {rows:[dbProof]};
          }
          if(typeof statement==='object') {
            calls.push('rpc');
            assert.ok([PRIVATE_SEALED_INITIAL_RPC_SQL,
              PRIVATE_PARCEL_KEYSET_RPC_SQL].includes(statement.text));
            return {rows:await dbRows(statement)};
          }
          if(statement==='COMMIT') calls.push('commit');
          if(statement==='ROLLBACK') calls.push('rollback');
          return {rows:[]};
        },
        release(error) {calls.push(error ? 'discard':'release');},
      };
    },
  });
  return {runtime,calls,get checkouts(){return checkouts;}};
}

test('rejects missing collaborators, unknown config, and reused HMAC keys',()=>{
  assert.throws(()=>createPrivateSealedGeometryRuntime(),TypeError);
  const cfg={
    sessionHmacKey:SESSION_KEY,cursorHmacKey:CURSOR_KEY,
    findSessionByDigest:async()=>record(),readSealedSource:async()=>source(),
    readPublicationReview:async()=>review(),consumeQuota:async()=>true,
    connect:async()=>null,
  };
  assert.throws(()=>createPrivateSealedGeometryRuntime({...cfg,cursorHmacKey:SESSION_KEY}),TypeError);
  assert.throws(()=>createPrivateSealedGeometryRuntime({...cfg,unsafeBrowserFlag:true}),TypeError);
  assert.throws(()=>createPrivateSealedGeometryRuntime({...cfg,connect:null}),TypeError);
});

test('trusted first page uses reverified session/rights and fixed attested transaction',async()=>{
  const ctx=setup();
  const result=await ctx.runtime.readPrivatePage(call());
  assert.equal(result.status,'validated-private');
  assert.equal(result.featureCount,2);
  assert.equal(result.overflow,true);
  assert.equal(typeof result.nextPrivateCursor,'string');
  assert.equal(result.publishAuthorized,false);
  assert.equal(result.geometryDelivered,false);
  assert.equal(result.viewportCoverage,'unknown');
  assert.equal(JSON.stringify(result).includes('coordinates'),false);
  assert.equal(JSON.stringify(result).includes('travis-cad'),false);
  assert.equal(JSON.stringify(result).includes(HANDLE),false);
  assert.deepEqual(ctx.calls,[
    'session','source','rights','quota','connect','begin','role','rpc',
    'commit','release','session','source','rights',
  ]);
});

test('continuation is bound to current session, source, rights and sealed run',async()=>{
  let n=0;
  const ctx=setup({dbRows:async(statement)=>{
    n++;
    if(n===1) return page();
    assert.equal(statement.text,PRIVATE_PARCEL_KEYSET_RPC_SQL);
    assert.deepEqual(statement.values.slice(-2),['P-002','2']);
    return [row('P-003','3'),row('P-004','4')];
  }});
  const first=await ctx.runtime.readPrivatePage(call());
  const next=await ctx.runtime.readPrivatePage(call({
    cursorToken:first.nextPrivateCursor,
  }));
  assert.equal(next.status,'validated-private');
  assert.equal(next.featureCount,2);
  assert.equal(next.overflow,false);
  assert.equal(next.nextPrivateCursor,null);
  assert.equal(n,2);
});

test('missing, revoked or wrong-county session cannot query database',async()=>{
  for(const session of [
    async()=>null,
    async()=>({...record(),mfaVerified:false}),
    async()=>({...record(),revokedAtMs:NOW-1}),
    async()=>({...record(),countyGrants:[{countyFips:'48029',allowParcelDiscovery:true}]}),
  ]) {
    const ctx=setup({session});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
    assert.equal(ctx.checkouts,0);
    assert.deepEqual(ctx.calls,['session']);
  }
});

test('unsealed, stale, multiple-source, extra-field or wrong-run proof is denied',async()=>{
  for(const value of [
    {...source(),sealedRun:false},
    {...source(),rightsState:'revoked'},
    {...source(),approvedCachingUntilMs:NOW},
    {...source(),runId:0},
    {...source(),countyFips:'48029'},
    {...source(),unexpected:'injected'},
    [source(),source()],
    null,
  ]) {
    const ctx=setup({sealed:async()=>value});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
    assert.deepEqual(ctx.calls,['session','source']);
    assert.equal(ctx.checkouts,0);
  }
});

test('separate publication review is required even if caching is approved',async()=>{
  for(const value of [
    null,{...review(),allowGeometryRedistribution:false},
    {...review(),reviewState:'unreviewed'},
    {...review(),expiresAtMs:NOW},
    {...review(),sourceId:'another-cad'},
    {...review(),arbitraryPermission:true},
  ]) {
    const ctx=setup({rights:async()=>value});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
    assert.deepEqual(ctx.calls,['session','source','rights']);
    assert.equal(ctx.checkouts,0);
  }
});

test('atomic quota must return exactly true before DB checkout',async()=>{
  for(const value of [false,1,{allowed:true},null]) {
    const ctx=setup({quota:async()=>value});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
    assert.equal(ctx.checkouts,0);
  }
});

test('post-query source change fails even when county and run remain identical',async()=>{
  let calls=0;
  const ctx=setup({sealed:async()=>{
    calls++;
    return calls===1 ? source() : {...source(),indexedRecords:5};
  }});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
  assert.equal(ctx.checkouts,1);
  assert.equal(calls,2);
});

test('post-query publication reference/review changes invalidate private page',async()=>{
  let calls=0;
  const ctx=setup({rights:async()=>{
    calls++;
    return calls===1 ? review() : {...review(),reviewReference:'synthetic/review-new'};
  }});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
  assert.equal(ctx.checkouts,1);
});

test('database role attestation denies missing rights or raw-table privileges',async()=>{
  for(const bad of [
    {...proof(),sealed_keyset_allowed:false},
    {...proof(),no_parcel_table:false},
    {...proof(),unsealed_snapshot_denied:false},
    {...proof(),same_principal:false},
    {...proof(),extra:true},
  ]) {
    const ctx=setup({dbProof:bad});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
    assert.ok(ctx.calls.includes('rollback'));
    assert.ok(ctx.calls.includes('discard'));
    assert.ok(!ctx.calls.includes('rpc'));
  }
});

test('SQL result with private columns, oversized rows or too many rows fails closed',async()=>{
  for(const rows of [
    page().map((r,i)=>i? r : {...r,owner:'PRIVATE'}),
    Array.from({length:202},(_,i)=>row('P-'+String(i).padStart(3,'0'),String(i+1))),
    page().map((r,i)=>i? r : {...r,source_version:'X'.repeat(2_200_001)}),
  ]) {
    const ctx=setup({dbRows:async()=>rows});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
    assert.ok(ctx.calls.includes('discard'));
  }
});

test('fixed RPC adapter rejects arbitrary SQL, mutable values and forged cursor',async()=>{
  let connected=0;
  const executor=createFixedSealedGeometryRpcReader({
    connect:async()=>{connected++;throw new Error('should not connect');},
  });
  const signal=new AbortController().signal;
  for(const statement of [
    {text:'SELECT * FROM bdp_parcel_index.parcel_versions',values:Object.freeze([])},
    {text:PRIVATE_SEALED_INITIAL_RPC_SQL,values:[]},
    Object.freeze({text:PRIVATE_PARCEL_KEYSET_RPC_SQL,values:Object.freeze([
      '48453','travis-cad',42,-97.76,30.24,-97.73,30.27,3,
      'P-002','1; DROP TABLE',
    ])}),
  ]) await assert.rejects(executor.querySealedRpc({statement,signal}));
  assert.equal(connected,0);
});

test('cancellation is generic and cannot produce a successful private result',async()=>{
  const stopped=new AbortController();stopped.abort();
  const early=setup();
  const outcome=await early.runtime.readPrivatePage(call({signal:stopped.signal}));
  assert.equal(outcome.status,'cancelled');
  assert.equal(early.checkouts,0);
  const later=new AbortController();
  const ctx=setup({dbRows:async()=>{later.abort();return page();}});
  const other=await ctx.runtime.readPrivatePage(call({signal:later.signal}));
  assert.equal(other.status,'cancelled');
  assert.ok(ctx.calls.includes('discard'));
});

test('an empty verified PRIVATE page still leaves geographic coverage unknown',async()=>{
  const ctx=setup({dbRows:async()=>[]});
  const result=await ctx.runtime.readPrivatePage(call());
  assert.equal(result.status,'validated-private');
  assert.equal(result.featureCount,0);
  assert.equal(result.viewportCoverage,'unknown');
  assert.equal(result.publishAuthorized,false);
});

test('new runtime remains unmounted and cannot claim delivery or legal clearance',()=>{
  for(const file of [
    '../../../server/providers/bdp-parcel-sealed-geometry-runtime.js',
    '../../../server/providers/bdp-parcel-sealed-geometry-rpc.js',
  ]) {
    const src=readFileSync(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(src,/createServer\(|\.listen\(|express\(|app\.get\(/);
    assert.doesNotMatch(src,/fetch\(|localStorage|document\.cookie/);
  }
});
