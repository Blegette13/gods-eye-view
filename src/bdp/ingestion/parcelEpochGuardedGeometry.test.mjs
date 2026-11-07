import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createPrivateEpochGuardedGeometryDependencies} from
  '../../../server/providers/bdp-parcel-epoch-guarded-geometry-dependencies.js';
import {createPrivateVerifiedGeometryDependencies} from
  '../../../server/providers/bdp-parcel-verified-geometry-dependencies.js';
import {SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL} from
  '../../../server/providers/bdp-parcel-sealed-source-authority-db.js';
import {PRIVATE_SEALED_SOURCE_AUTHORITY_SQL} from
  '../../../server/providers/bdp-parcel-sealed-source-authority.js';
import {GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL} from
  '../../../server/providers/bdp-parcel-geometry-publication-review-db.js';
import {PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL} from
  '../../../server/providers/bdp-parcel-geometry-publication-review.js';
import {SEALED_GEOMETRY_ROLE_ATTESTATION_SQL} from
  '../../../server/providers/bdp-parcel-sealed-geometry-rpc.js';
import {PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL} from
  '../../../server/providers/bdp-parcel-policy-epoch-db.js';
import {PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL} from
  '../../../server/providers/bdp-parcel-policy-epoch-reader.js';
import {PRIVATE_SEALED_INITIAL_RPC_SQL} from './parcelSealedInitialPagePlan.js';
import {PRIVATE_PARCEL_KEYSET_RPC_SQL} from './parcelKeysetPagination.js';

const NOW=1_000_000;
const LOGIN_A='ldos_parcel_authority_test';
const LOGIN_P='ldos_parcel_publication_test';
const LOGIN_G='ldos_parcel_geometry_test';
const LOGIN_E='ldos_parcel_epoch_test';
const KEY_SESSION=Buffer.alloc(32,0x31);
const KEY_CURSOR=Buffer.alloc(32,0x32);
const HANDLE=Buffer.alloc(32,0x33).toString('base64url');
const DIGEST=createHmac('sha256',KEY_SESSION).update(HANDLE,'utf8').digest('hex');
const denied={status:'unavailable',publishAuthorized:false,
  viewportCoverage:'unknown',geometryDelivered:false};
const authorityKeys=['exact_login','safe_login','no_role_memberships',
  'schema_usage','no_schema_create','no_index_table_access',
  'no_index_sequence_access','fixed_rpc_execute','no_other_index_rpc'];
const geometryKeys=['same_principal','safe_principal','no_schema_create',
  'no_source_table','no_run_table','no_seal_table','no_parcel_table',
  'no_coverage_table','no_rights_table','sealed_initial_allowed',
  'sealed_keyset_allowed','unsealed_snapshot_denied',
  'metadata_source_denied','metadata_viewport_denied',
  'sealed_authority_denied','publication_review_denied',
  'exact_login','safe_login','no_role_memberships','schema_usage',
  'no_index_table_access','no_index_sequence_access','no_other_index_rpc'];
const proof=keys=>Object.fromEntries(keys.map(k=>[k,true]));
const source=()=>({
  source_id:'travis-cad',county_fips:'48453',rights_state:'approved',
  approved_caching_until_ms:NOW+300_000,run_id:'42',
  source_version:'synthetic-v1',sealed_at_ms:NOW-5_000,
  indexed_records:'4',sealed_run:true,
});
const review=()=>({
  source_id:'travis-cad',county_fips:'48453',review_state:'approved',
  allow_geometry_redistribution:true,review_reference:'synthetic/review-42',
  reviewed_at_ms:NOW-10_000,expires_at_ms:NOW+200_000,
});
const policy=()=>({
  source_id:'travis-cad',county_fips:'48453',
  source_cache_epoch:'5',publication_epoch:'7',
});
const session=()=>({
  sessionDigest:DIGEST,subject:'test-operator',accountStatus:'active',
  mfaVerified:true,revokedAtMs:null,issuedAtMs:NOW-100_000,
  lastSeenAtMs:NOW-1_000,expiresAtMs:NOW+300_000,
  countyGrants:[{countyFips:'48453',allowParcelDiscovery:true}],
});
const sessionEpoch=()=>({
  sessionDigest:DIGEST,countyFips:'48453',epoch:'3',
});
const runEpoch=()=>({
  countyFips:'48453',sourceId:'travis-cad',runId:42,epoch:'4',
});
const polygon=()=>({
  type:'MultiPolygon',
  coordinates:[[[[-97.75,30.25],[-97.74,30.25],[-97.74,30.26],
    [-97.75,30.26],[-97.75,30.25]]]],
});
const row=(parcelId,version,geometry=polygon())=>({
  parcel_version_id:version,source_parcel_id:parcelId,
  source_version:'synthetic-v1',source_geometry_sha256:'b'.repeat(64),
  ingest_run_id:'42',source_id:'travis-cad',county_fips:'48453',
  geometry_vertices:5,geometry_memory_bytes:240,geometry,
});
const page=()=>[row('P-001','1'),row('P-002','2'),row('P-003','3',null)];
const req=()=>({
  countyFips:'48453',
  bounds:{west:-97.76,south:30.24,east:-97.73,north:30.27},limit:2,
});
const call=(extra={})=>({
  sessionHandle:HANDLE,request:req(),cursorToken:null,
  signal:new AbortController().signal,...extra,
});
function setup({
  sourceRows=()=>[source()],reviewRows=()=>[review()],
  policyRows=()=>[policy()],geometryRows=()=>page(),
  epochRole=()=>proof(authorityKeys),
  sessionRows=()=>session(),
  sessionEpochRows=()=>sessionEpoch(),runEpochRows=()=>runEpoch(),
  quota=async()=>true,
}={}) {
  const counts={sessions:0,sources:0,reviews:0,epochs:0,
    sessionEpochs:0,runEpochs:0,geometry:0,quota:0};
  const events=[];
  const connector=kind=>async()=>({
    async query(stmt){
      if(typeof stmt==='string'){events.push(kind+':'+stmt);return {rows:[]};}
      if(kind==='source'&&stmt.text===SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL){
        assert.deepEqual(stmt.values,[LOGIN_A]);events.push('source:attest');
        return {rows:[proof(authorityKeys)]};
      }
      if(kind==='source'&&stmt.text===PRIVATE_SEALED_SOURCE_AUTHORITY_SQL){
        assert.deepEqual(stmt.values,['48453']);counts.sources++;events.push('source:rpc');
        return {rows:await sourceRows(counts.sources)};
      }
      if(kind==='review'&&stmt.text===GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL){
        assert.deepEqual(stmt.values,[LOGIN_P]);events.push('review:attest');
        return {rows:[proof(authorityKeys)]};
      }
      if(kind==='review'&&stmt.text===PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL){
        assert.deepEqual(stmt.values,['48453','travis-cad']);
        counts.reviews++;events.push('review:rpc');
        return {rows:await reviewRows(counts.reviews)};
      }
      if(kind==='epoch'&&stmt.text===PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL){
        assert.deepEqual(stmt.values,[LOGIN_E]);events.push('epoch:attest');
        return {rows:[epochRole()]};
      }
      if(kind==='epoch'&&stmt.text===PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL){
        assert.deepEqual(stmt.values,['48453','travis-cad']);
        counts.epochs++;events.push('epoch:rpc');
        return {rows:await policyRows(counts.epochs)};
      }
      if(kind==='geometry'&&stmt.text===SEALED_GEOMETRY_ROLE_ATTESTATION_SQL){
        assert.deepEqual(stmt.values,[LOGIN_G]);events.push('geometry:attest');
        return {rows:[proof(geometryKeys)]};
      }
      if(kind==='geometry'&&[
        PRIVATE_SEALED_INITIAL_RPC_SQL,PRIVATE_PARCEL_KEYSET_RPC_SQL,
      ].includes(stmt.text)){
        counts.geometry++;events.push('geometry:rpc');
        return {rows:await geometryRows(counts.geometry,stmt)};
      }
      throw Error('Unexpected SQL or role: '+kind);
    },
    release(error){events.push(kind+(error?':discard':':release'));},
  });
  const config={
    sessionHmacKey:KEY_SESSION,cursorHmacKey:KEY_CURSOR,
    findSessionByDigest:async()=>{
      counts.sessions++;events.push('session');
      return sessionRows(counts.sessions);
    },
    consumeQuota:async()=>{
      counts.quota++;events.push('quota');return quota(counts.quota);
    },
    connectSourceAuthority:connector('source'),sourceAuthorityLogin:LOGIN_A,
    connectPublicationReview:connector('review'),publicationReviewLogin:LOGIN_P,
    connectSealedGeometry:connector('geometry'),geometryLogin:LOGIN_G,
    connectPolicyEpoch:connector('epoch'),policyEpochLogin:LOGIN_E,
    readSessionCountyEpoch:async(arg)=>{
      assert.deepEqual(Object.keys(arg),['sessionDigest','countyFips','signal']);
      assert.equal(arg.sessionDigest,DIGEST);assert.equal(arg.countyFips,'48453');
      counts.sessionEpochs++;events.push('session-epoch');
      return sessionEpochRows(counts.sessionEpochs);
    },
    readSealedRunEpoch:async(arg)=>{
      assert.deepEqual(Object.keys(arg),['countyFips','sourceId','runId','signal']);
      assert.equal(arg.runId,42);assert.equal(arg.sourceId,'travis-cad');
      counts.runEpochs++;events.push('run-epoch');
      return runEpochRows(counts.runEpochs);
    },
    now:()=>NOW,
  };
  return {runtime:createPrivateEpochGuardedGeometryDependencies(config),
    counts,events,config};
}

test('40C42 strict v2 factory demands all four roles and two independent epochs',()=>{
  assert.throws(()=>createPrivateEpochGuardedGeometryDependencies(),TypeError);
  const ctx=setup();
  for(const key of [
    'connectPolicyEpoch','policyEpochLogin','readSessionCountyEpoch',
    'readSealedRunEpoch',
  ]){
    const invalid={...ctx.config};delete invalid[key];
    assert.throws(()=>createPrivateEpochGuardedGeometryDependencies(invalid),TypeError);
    assert.throws(()=>createPrivateVerifiedGeometryDependencies({
      ...ctx.config,[key]:undefined,
    }),TypeError);
  }
  assert.throws(()=>createPrivateEpochGuardedGeometryDependencies({
    ...ctx.config,clientClaimsLicensed:true,
  }),TypeError);
});

test('four DB connections must be distinct even before any request',()=>{
  const config=setup().config;
  for(const key of [
    'connectSourceAuthority','connectPublicationReview','connectSealedGeometry',
  ])assert.throws(()=>createPrivateEpochGuardedGeometryDependencies({
    ...config,connectPolicyEpoch:config[key],
  }),TypeError);
  assert.throws(()=>createPrivateEpochGuardedGeometryDependencies({
    ...config,policyEpochLogin:'ldos_parcel_geometry_test',
  }),TypeError);
});

test('valid private page rechecks four SQL roles and three epoch domains twice',async()=>{
  const ctx=setup();
  const result=await ctx.runtime.readPrivatePage(call());
  assert.equal(result.status,'validated-private');
  assert.equal(result.featureCount,2);assert.equal(result.overflow,true);
  assert.equal(typeof result.nextPrivateCursor,'string');
  assert.equal(result.publishAuthorized,false);
  assert.equal(result.geometryDelivered,false);
  assert.equal(result.viewportCoverage,'unknown');
  assert.deepEqual(ctx.counts,{
    sessions:2,sources:2,reviews:2,epochs:2,
    sessionEpochs:2,runEpochs:2,geometry:1,quota:1,
  });
  for(const item of ['source:attest','review:attest','epoch:attest',
    'geometry:attest'])assert.ok(ctx.events.includes(item));
  const serialized=JSON.stringify(result);
  for(const secret of ['coordinates','travis-cad','synthetic/review',HANDLE,
    DIGEST,'sourceCacheEpoch','publicationEpoch','sessionEpoch'])
    assert.ok(!serialized.includes(secret),secret);
  assert.deepEqual(Object.keys(ctx.runtime),['readPrivatePage']);
});

test('source cache revoke→reapprove ABA invalidates private page despite same rights',async()=>{
  const ctx=setup({policyRows:n=>[n===1?policy():{
    ...policy(),source_cache_epoch:'7',
  }]});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
  assert.equal(ctx.counts.geometry,1);
  assert.equal(ctx.counts.epochs,2);
});

test('independent publication revoke→reapprove ABA invalidates private page',async()=>{
  const ctx=setup({policyRows:n=>[n===1?policy():{
    ...policy(),publication_epoch:'8',
  }]});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
  assert.equal(ctx.counts.geometry,1);
});

test('session/county grant ABA epoch change invalidates otherwise identical session',async()=>{
  const ctx=setup({sessionEpochRows:n=>n===1?sessionEpoch():{
    ...sessionEpoch(),epoch:'4',
  }});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
  assert.equal(ctx.counts.geometry,1);
});

test('sealed-run epoch change invalidates even unchanged run ID and source hash',async()=>{
  const ctx=setup({runEpochRows:n=>n===1?runEpoch():{
    ...runEpoch(),epoch:'5',
  }});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
  assert.equal(ctx.counts.geometry,1);
});

test('invalid independent source rights always stops before epoch and geometry',async()=>{
  const ctx=setup({reviewRows:()=>[{...review(),review_state:'revoked'}]});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
  assert.equal(ctx.counts.epochs,0);
  assert.equal(ctx.counts.geometry,0);
});

test('missing, duplicate or mismatched epoch SQL rows deny before geometry',async()=>{
  for(const rows of [[],[policy(),policy()],
    [{...policy(),source_id:'another-source'}],
    [{...policy(),county_fips:'48029'}]]){
    const ctx=setup({policyRows:()=>rows});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.geometry,0);
  }
});

test('malformed counters, extra keys, unknown session or run epoch deny',async()=>{
  for(const v of [
    {...policy(),source_cache_epoch:'0'},
    {...policy(),publication_epoch:'9223372036854775808'},
    {...policy(),untrusted:true},
  ]){
    const ctx=setup({policyRows:()=>[v]});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.geometry,0);
  }
  for(const value of [
    null,{...sessionEpoch(),epoch:'0'},
    {...sessionEpoch(),sessionDigest:'a'.repeat(64)},
    {...sessionEpoch(),unexpected:true},
  ]){
    const ctx=setup({sessionEpochRows:()=>value});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.geometry,0);
  }
  for(const value of [
    null,{...runEpoch(),epoch:4},
    {...runEpoch(),runId:43},
    {...runEpoch(),unexpected:true},
  ]){
    const ctx=setup({runEpochRows:()=>value});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.geometry,0);
  }
});

test('epoch-only SQL privilege drift denies BEFORE epoch RPC and geometry',async()=>{
  for(const changed of [
    {...proof(authorityKeys),fixed_rpc_execute:false},
    {...proof(authorityKeys),no_other_index_rpc:false},
    {...proof(authorityKeys),no_index_table_access:false},
    {...proof(authorityKeys),extra:true},
  ]){
    const ctx=setup({epochRole:()=>changed});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.epochs,0);assert.equal(ctx.counts.geometry,0);
    assert.ok(ctx.events.includes('epoch:discard'));
  }
});

test('stable epoch snapshot allows signed private keyset continuation',async()=>{
  const ctx=setup({geometryRows:(_,statement)=>{
    if(statement.text===PRIVATE_SEALED_INITIAL_RPC_SQL)return page();
    assert.equal(statement.text,PRIVATE_PARCEL_KEYSET_RPC_SQL);
    assert.deepEqual(statement.values.slice(-2),['P-002','2']);
    return [row('P-003','3'),row('P-004','4')];
  }});
  const first=await ctx.runtime.readPrivatePage(call());
  assert.equal(first.status,'validated-private');
  const second=await ctx.runtime.readPrivatePage(call({
    cursorToken:first.nextPrivateCursor,
  }));
  assert.equal(second.status,'validated-private');
  assert.equal(second.featureCount,2);
  assert.equal(second.nextPrivateCursor,null);
  assert.equal(ctx.counts.geometry,2);
  assert.equal(ctx.counts.epochs,4);
});

test('revoked/restored epochs invalidate an otherwise still-signed old cursor',async()=>{
  const ctx=setup({policyRows:n=>[n<=2?policy():{
    ...policy(),publication_epoch:'10',
  }]});
  const first=await ctx.runtime.readPrivatePage(call());
  assert.equal(first.status,'validated-private');
  const second=await ctx.runtime.readPrivatePage(call({
    cursorToken:first.nextPrivateCursor,
  }));
  assert.deepEqual(second,denied);
  assert.equal(ctx.counts.geometry,1,'Stale cursor never reads next SQL page');
});

test('post-read revoked user still fails independent of epoch counters',async()=>{
  const ctx=setup({sessionRows:n=>n===1?session():{
    ...session(),revokedAtMs:NOW-1,
  }});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
  assert.equal(ctx.counts.geometry,1);
});

test('missing trusted atomic quota denies geometry even with fresh epochs',async()=>{
  const ctx=setup({quota:async()=>({allowed:true})});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
  assert.equal(ctx.counts.geometry,0);
  assert.equal(ctx.counts.epochs,1);
});

test('cancelled geometry request never returns reviewed epochs or SQL records',async()=>{
  const abort=new AbortController();abort.abort();
  const ctx=setup();
  const result=await ctx.runtime.readPrivatePage(call({signal:abort.signal}));
  assert.equal(result.status,'cancelled');
  assert.equal(ctx.counts.epochs,0);
  assert.equal(ctx.counts.geometry,0);
});

test('Step42 is private-only: it has no transport, pool, GIS license or release gate',()=>{
  const files=[
    '../../../server/providers/bdp-parcel-epoch-guarded-geometry-dependencies.js',
    '../../../server/providers/bdp-parcel-sealed-geometry-runtime.js',
  ];
  for(const path of files){
    const code=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.doesNotMatch(code,/createServer\(|\.listen\(|new Pool\(|app\.get\(/);
    assert.doesNotMatch(code,/document\.cookie|localStorage/);
  }
  const factory=readFileSync(new URL(files[0],import.meta.url),'utf8');
  assert.match(factory,/not an atomic delivery gate/i);
  assert.match(factory,/NEVER routes to HTTP\/browser/);
});
