import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createPrivateVerifiedGeometryDependencies,
} from '../../../server/providers/bdp-parcel-verified-geometry-dependencies.js';
import { SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL } from
  '../../../server/providers/bdp-parcel-sealed-source-authority-db.js';
import { PRIVATE_SEALED_SOURCE_AUTHORITY_SQL } from
  '../../../server/providers/bdp-parcel-sealed-source-authority.js';
import { GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL } from
  '../../../server/providers/bdp-parcel-geometry-publication-review-db.js';
import { PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL } from
  '../../../server/providers/bdp-parcel-geometry-publication-review.js';
import { SEALED_GEOMETRY_ROLE_ATTESTATION_SQL } from
  '../../../server/providers/bdp-parcel-sealed-geometry-rpc.js';
import { PRIVATE_SEALED_INITIAL_RPC_SQL } from './parcelSealedInitialPagePlan.js';
import { PRIVATE_PARCEL_KEYSET_RPC_SQL } from './parcelKeysetPagination.js';

const NOW=1_000_000;
const LOGIN_A='ldos_parcel_authority_test';
const LOGIN_P='ldos_parcel_publication_test';
const LOGIN_G='ldos_parcel_geometry_test';
const KEY_SESSION=Buffer.alloc(32,0x31);
const KEY_CURSOR=Buffer.alloc(32,0x32);
const HANDLE=Buffer.alloc(32,0x33).toString('base64url');
const HASH='b'.repeat(64);
const denied={status:'unavailable',publishAuthorized:false,
  viewportCoverage:'unknown',geometryDelivered:false};
const authorityKeys=[
  'exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_index_table_access','no_index_sequence_access',
  'fixed_rpc_execute','no_other_index_rpc',
];
const geometryKeys=[
  'same_principal','safe_principal','no_schema_create','no_source_table',
  'no_run_table','no_seal_table','no_parcel_table','no_coverage_table',
  'no_rights_table','sealed_initial_allowed','sealed_keyset_allowed',
  'unsealed_snapshot_denied','metadata_source_denied',
  'metadata_viewport_denied','sealed_authority_denied',
  'publication_review_denied',
  'exact_login','safe_login','no_role_memberships','schema_usage',
  'no_index_table_access','no_index_sequence_access','no_other_index_rpc',
];
const proof=keys=>Object.fromEntries(keys.map(key=>[key,true]));
const source=()=>({
  source_id:'travis-cad',county_fips:'48453',rights_state:'approved',
  approved_caching_until_ms:NOW+300_000,run_id:'42',
  source_version:'synthetic-v1',sealed_at_ms:NOW-5_000,
  indexed_records:'4',sealed_run:true,
});
const review=()=>({
  source_id:'travis-cad',county_fips:'48453',review_state:'approved',
  allow_geometry_redistribution:true,review_reference:'synthetic/review-36',
  reviewed_at_ms:NOW-10_000,expires_at_ms:NOW+200_000,
});
const session=()=>({
  sessionDigest:createHmac('sha256',KEY_SESSION).update(HANDLE,'utf8').digest('hex'),
  subject:'test-operator',accountStatus:'active',mfaVerified:true,revokedAtMs:null,
  issuedAtMs:NOW-100_000,lastSeenAtMs:NOW-1_000,expiresAtMs:NOW+300_000,
  countyGrants:[{countyFips:'48453',allowParcelDiscovery:true}],
});
const polygon=()=>({
  type:'MultiPolygon',
  coordinates:[[[[-97.75,30.25],[-97.74,30.25],[-97.74,30.26],
    [-97.75,30.26],[-97.75,30.25]]]],
});
const row=(parcelId,version,geometry=polygon())=>({
  parcel_version_id:version,source_parcel_id:parcelId,
  source_version:'synthetic-v1',source_geometry_sha256:HASH,
  ingest_run_id:'42',source_id:'travis-cad',county_fips:'48453',
  geometry_vertices:5,geometry_memory_bytes:240,geometry,
});
const page=()=>[row('P-001','1'),row('P-002','2'),row('P-003','3',null)];
const req=()=>({
  countyFips:'48453',
  bounds:{west:-97.76,south:30.24,east:-97.73,north:30.27},
  limit:2,
});
const call=(extra={})=>({
  sessionHandle:HANDLE,request:req(),cursorToken:null,
  signal:new AbortController().signal,...extra,
});

function setup({
  sessionRecord=()=>session(),sourceRows=()=>[source()],
  reviewRows=()=>[review()],geometryRows=()=>page(),
  sourceRole=()=>proof(authorityKeys),
  reviewRole=()=>proof(authorityKeys),
  geometryRole=()=>proof(geometryKeys),
  quota=async()=>true,
}={}) {
  const events=[];
  const counts={sessions:0,sources:0,reviews:0,geometry:0,quota:0};
  const connection=(kind)=>async()=>{
    events.push(kind+':connect');
    return {
      async query(stmt) {
        if(kind==='geometry'&&typeof stmt==='object'
          &&stmt.text===SEALED_GEOMETRY_ROLE_ATTESTATION_SQL) {
          assert.deepEqual(stmt.values,[LOGIN_G]);
          events.push('geometry:attest');
          return {rows:[geometryRole()]};
        }
        if(typeof stmt==='string') {
          events.push(kind+':'+stmt);
          return {rows:[]};
        }
        if(kind==='source'&&stmt.text===SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL){
          events.push('source:attest');
          assert.deepEqual(stmt.values,[LOGIN_A]);
          return {rows:[sourceRole()]};
        }
        if(kind==='source'&&stmt.text===PRIVATE_SEALED_SOURCE_AUTHORITY_SQL){
          events.push('source:rpc');counts.sources++;
          assert.deepEqual(stmt.values,['48453']);
          return {rows:await sourceRows(counts.sources)};
        }
        if(kind==='review'&&stmt.text===GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL){
          events.push('review:attest');
          assert.deepEqual(stmt.values,[LOGIN_P]);
          return {rows:[reviewRole()]};
        }
        if(kind==='review'&&stmt.text===PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL){
          events.push('review:rpc');counts.reviews++;
          assert.deepEqual(stmt.values,['48453','travis-cad']);
          return {rows:await reviewRows(counts.reviews)};
        }
        if(kind==='geometry'&&typeof stmt==='object'
          &&[PRIVATE_SEALED_INITIAL_RPC_SQL,PRIVATE_PARCEL_KEYSET_RPC_SQL]
            .includes(stmt.text)) {
          events.push('geometry:rpc');counts.geometry++;
          return {rows:await geometryRows(counts.geometry,stmt)};
        }
        throw Error('Unexpected SQL or cross-principal access: '+kind);
      },
      release(error){events.push(kind+(error?':discard':':release'));},
    };
  };
  const config={
    sessionHmacKey:KEY_SESSION,cursorHmacKey:KEY_CURSOR,
    findSessionByDigest:async()=>{
      events.push('session');counts.sessions++;
      return sessionRecord(counts.sessions);
    },
    consumeQuota:async()=>{
      events.push('quota');counts.quota++;
      return quota(counts.quota);
    },
    connectSourceAuthority:connection('source'),sourceAuthorityLogin:LOGIN_A,
    connectPublicationReview:connection('review'),publicationReviewLogin:LOGIN_P,
    connectSealedGeometry:connection('geometry'),geometryLogin:LOGIN_G,
    now:()=>NOW,
  };
  const runtime=createPrivateVerifiedGeometryDependencies(config);
  return {runtime,events,counts,config};
}

test('factory strictly rejects missing, arbitrary config and shared SQL factories',()=>{
  assert.throws(()=>createPrivateVerifiedGeometryDependencies(),TypeError);
  const ctx=setup();
  assert.throws(()=>createPrivateVerifiedGeometryDependencies({
    ...ctx.config,authFromBrowser:true,
  }),TypeError);
  assert.throws(()=>createPrivateVerifiedGeometryDependencies({
    ...ctx.config,sourceAuthorityLogin:'postgres',
  }),TypeError);
  assert.throws(()=>createPrivateVerifiedGeometryDependencies({
    ...ctx.config,publicationReviewLogin:'ldos_parcel_authority_test',
  }),TypeError);
  assert.throws(()=>createPrivateVerifiedGeometryDependencies({
    ...ctx.config,connectPublicationReview:ctx.config.connectSourceAuthority,
  }),TypeError);
  assert.throws(()=>createPrivateVerifiedGeometryDependencies({
    ...ctx.config,connectSealedGeometry:ctx.config.connectPublicationReview,
  }),TypeError);
  assert.throws(()=>createPrivateVerifiedGeometryDependencies({
    ...ctx.config,geometryLogin:'ldos_parcel_authority_test',
  }),TypeError);
});

test('a validated PRIVATE page consults all three attested SQL principals',async()=>{
  const ctx=setup();
  const result=await ctx.runtime.readPrivatePage(call());
  assert.equal(result.status,'validated-private');
  assert.equal(result.featureCount,2);
  assert.equal(result.overflow,true);
  assert.equal(typeof result.nextPrivateCursor,'string');
  assert.equal(result.publishAuthorized,false);
  assert.equal(result.geometryDelivered,false);
  assert.equal(result.viewportCoverage,'unknown');
  assert.deepEqual(ctx.counts,{sessions:2,sources:2,reviews:2,geometry:1,quota:1});
  assert.ok(ctx.events.indexOf('session')<ctx.events.indexOf('source:rpc'));
  assert.ok(ctx.events.indexOf('source:rpc')<ctx.events.indexOf('review:rpc'));
  assert.ok(ctx.events.indexOf('review:rpc')<ctx.events.indexOf('geometry:rpc'));
  assert.equal(JSON.stringify(result).includes('coordinates'),false);
  assert.equal(JSON.stringify(result).includes('synthetic/review'),false);
  assert.equal(JSON.stringify(result).includes(HANDLE),false);
  assert.deepEqual(Object.keys(ctx.runtime),['readPrivatePage']);
});

test('continuation rechecks all principals and binds next page to sealed run',async()=>{
  const ctx=setup({geometryRows:(_,stmt)=>{
    if(stmt.text===PRIVATE_SEALED_INITIAL_RPC_SQL) return page();
    assert.equal(stmt.text,PRIVATE_PARCEL_KEYSET_RPC_SQL);
    assert.deepEqual(stmt.values.slice(-2),['P-002','2']);
    return [row('P-003','3'),row('P-004','4')];
  }});
  const first=await ctx.runtime.readPrivatePage(call());
  assert.equal(first.status,'validated-private');
  const later=await ctx.runtime.readPrivatePage(call({
    cursorToken:first.nextPrivateCursor,
  }));
  assert.equal(later.status,'validated-private');
  assert.equal(later.overflow,false);
  assert.equal(later.featureCount,2);
  assert.equal(later.nextPrivateCursor,null);
  assert.deepEqual(ctx.counts,{sessions:4,sources:4,reviews:4,geometry:2,quota:2});
});

test('invalid, revoked, expired or wrong-county session stops before ANY database',async()=>{
  for(const invalid of [
    null,{...session(),mfaVerified:false},
    {...session(),revokedAtMs:NOW-1},
    {...session(),expiresAtMs:NOW},
    {...session(),countyGrants:[{countyFips:'48029',allowParcelDiscovery:true}]},
  ]) {
    const ctx=setup({sessionRecord:()=>invalid});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.sessions,1);
    assert.equal(ctx.counts.sources,0);
    assert.equal(ctx.counts.reviews,0);
    assert.equal(ctx.counts.geometry,0);
  }
});

test('no unique current SEALED source prevents independent review or geometry SQL',async()=>{
  for(const rows of [[],[source(),source()]]) {
    const ctx=setup({sourceRows:()=>rows});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.reviews,0);
    assert.equal(ctx.counts.geometry,0);
  }
});

test('revoked source caching or changed immutable seal AFTER geometry denies page',async()=>{
  for(const update of [
    {...source(),rights_state:'revoked'},
    {...source(),run_id:'43'},
    {...source(),indexed_records:'5'},
    {...source(),sealed_at_ms:NOW-4_000},
  ]) {
    const ctx=setup({sourceRows:n=>[n===1?source():update]});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.geometry,1);
    assert.equal(ctx.counts.sources,2);
  }
});

test('missing or revoked independent publication review blocks sealed geometry',async()=>{
  for(const rows of [
    [],[review(),review()],[{...review(),review_state:'revoked'}],
    [{...review(),expires_at_ms:NOW}],
    [{...review(),allow_geometry_redistribution:false}],
  ]) {
    const ctx=setup({reviewRows:()=>rows});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.geometry,0);
  }
});

test('post-read publication rights expiry or revision invalidates private geometry',async()=>{
  for(const changed of [
    {...review(),review_state:'revoked'},
    {...review(),expires_at_ms:NOW},
    {...review(),review_reference:'synthetic/review-updated'},
  ]) {
    const ctx=setup({reviewRows:n=>[n===1?review():changed]});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.geometry,1);
  }
});

test('authority role privilege drift rejects before any source RPC or geometry',async()=>{
  for(const changed of [
    {...proof(authorityKeys),fixed_rpc_execute:false},
    {...proof(authorityKeys),no_index_table_access:false},
    {...proof(authorityKeys),extra_privilege:true},
  ]) {
    const ctx=setup({sourceRole:()=>changed});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.sources,0);
    assert.equal(ctx.counts.geometry,0);
    assert.ok(ctx.events.includes('source:discard'));
  }
});

test('publication role drift rejects before review RPC and without geometry',async()=>{
  for(const changed of [
    {...proof(authorityKeys),no_other_index_rpc:false},
    {...proof(authorityKeys),no_role_memberships:false},
    {...proof(authorityKeys),extra:true},
  ]) {
    const ctx=setup({reviewRole:()=>changed});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.reviews,0);
    assert.equal(ctx.counts.geometry,0);
    assert.ok(ctx.events.includes('review:discard'));
  }
});

test('geometry role cannot inherit source-authority or publication RPC',async()=>{
  for(const key of ['sealed_authority_denied','publication_review_denied',
    'no_other_index_rpc','exact_login','no_index_table_access']) {
    const ctx=setup({geometryRole:()=>({...proof(geometryKeys),[key]:false})});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.geometry,0);
    assert.ok(ctx.events.includes('geometry:discard'));
    assert.ok(!ctx.events.includes('geometry:rpc'));
  }
});

test('failed distributed quota is exact-true only and denies geometry before checkout',async()=>{
  for(const value of [false,null,1,{allowed:true}]) {
    const ctx=setup({quota:async()=>value});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
    assert.equal(ctx.counts.geometry,0);
    assert.equal(ctx.counts.sources,1);
    assert.equal(ctx.counts.reviews,1);
  }
});

test('invalid county or caller supplied SQL cannot access private providers',async()=>{
  const ctx=setup();
  for(const input of [
    call({request:{...req(),countyFips:'06037'}}),
    call({request:{...req(),sourceId:'travis-cad'}}),
    call({owner:'private'}),
    call({request:{...req(),rightsState:'approved'}}),
  ]) assert.deepEqual(await ctx.runtime.readPrivatePage(input),denied);
  assert.equal(ctx.counts.sources,0);
});

test('revoked session in post-read check invalidates otherwise valid three-principal result',async()=>{
  const ctx=setup({sessionRecord:n=>n===1?session():{
    ...session(),revokedAtMs:NOW-1,
  }});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),denied);
  assert.equal(ctx.counts.geometry,1);
  assert.equal(ctx.counts.sessions,2);
});

test('cancelled request never leaks rows or source and review records',async()=>{
  const aborted=new AbortController();aborted.abort();
  const ctx=setup();
  assert.equal((await ctx.runtime.readPrivatePage(call({
    signal:aborted.signal,
  }))).status,'cancelled');
  assert.equal(ctx.counts.sessions,0);
  const late=new AbortController();
  const after=setup({geometryRows:()=>{late.abort();return page();}});
  const outcome=await after.runtime.readPrivatePage(call({
    signal:late.signal,
  }));
  assert.equal(outcome.status,'cancelled');
  assert.equal(after.counts.geometry,1);
  assert.ok(after.events.includes('geometry:discard'));
});

test('integration is an UNMOUNTED private dependency factory only, never HTTP or Cesium',()=>{
  const code=readFileSync(new URL(
    '../../../server/providers/bdp-parcel-verified-geometry-dependencies.js',
    import.meta.url),'utf8');
  assert.doesNotMatch(code,/createServer\(|\.listen\(|new Pool\(|app\.get\(/);
  assert.doesNotMatch(code,/document\.cookie|window\.location|localStorage/);
  assert.match(code,/snapshot-coherence design/);
  assert.match(code,/NO output contains/);
});
