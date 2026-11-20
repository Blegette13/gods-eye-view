import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL,
  createPrivatePolicyEpochReader,
  samePrivatePolicyEpochSnapshot,isCanonicalPrivatePolicyEpochSnapshot,
} from '../../../server/providers/bdp-parcel-policy-epoch-reader.js';
import {
  createPinnedPrivatePolicyEpochRpcExecutor,
  PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL,
  PRIVATE_POLICY_EPOCH_TIMEOUT_MS,PRIVATE_POLICY_EPOCH_MAX_BYTES,
} from '../../../server/providers/bdp-parcel-policy-epoch-db.js';

const SQL=readFileSync(new URL(
  './sql/parcelPolicyEpochSnapshotRpcFoundation.sql',import.meta.url),'utf8');
const LOGIN='ldos_parcel_epoch_test';
const KEYS=['exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_index_table_access','no_index_sequence_access',
  'fixed_rpc_execute','no_other_index_rpc'];
const proof=()=>Object.fromEntries(KEYS.map(k=>[k,true]));
const row=(extra={})=>({
  source_id:'step40c13-synthetic',county_fips:'48453',
  source_cache_epoch:'3',publication_epoch:'5',...extra,
});
const input=(extra={})=>({
  countyFips:'48453',sourceId:'step40c13-synthetic',
  signal:new AbortController().signal,...extra,
});
const statement=(signal=new AbortController().signal)=>Object.freeze({
  text:PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL,
  values:Object.freeze(['48453','step40c13-synthetic']),signal,
});
function setup({rows=[row()],role=proof(),duringRpc=null,connectError=null}={}){
  const calls=[],releases=[];
  const db=createPinnedPrivatePolicyEpochRpcExecutor({
    expectedLogin:LOGIN,async connect(){
      calls.push('connect');
      if(connectError)throw Error('PRIVATE HOST SECRET');
      return {
        async query(s){
          if(typeof s==='string'){calls.push(s);return {rows:[]};}
          if(s.text===PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL){
            calls.push('attest');assert.deepEqual(s.values,[LOGIN]);
            return {rows:[role]};
          }
          if(s.text===PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL){
            calls.push('epoch-rpc');
            assert.deepEqual(s.values,['48453','step40c13-synthetic']);
            if(duringRpc)await duringRpc();
            return {rows};
          }
          throw Error('Arbitrary query');
        },
        release(e){calls.push(e?'discard':'release');releases.push(Boolean(e));},
      };
    },
  });
  const reader=createPrivatePolicyEpochReader({queryFixedEpochRpc:db.queryFixedEpochRpc});
  return {db,reader,calls,releases};
}

test('40C41 epoch RPC has no GRANT and is defined transactionally',()=>{
  assert.match(SQL,/^BEGIN;/m);assert.match(SQL,/^COMMIT;/m);
  assert.match(SQL,/SECURITY DEFINER/);
  assert.match(SQL,/SET search_path = pg_catalog, pg_temp/);
  assert.match(SQL,/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC/);
  assert.match(SQL,/REVOKE ALL ON FUNCTION[\s\S]*?FROM ldos_parcel_rpc_client/);
  assert.doesNotMatch(SQL,/^\s*GRANT\s/mi);
});

test('RPC exposes precisely four epoch/identity columns and no geometry',()=>{
  const col=SQL.match(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE sql/)?.[1];
  assert.ok(col);
  assert.deepEqual(col.trim().split(',').map(v=>v.trim()),[
    'source_id text','county_fips text','source_cache_epoch text','publication_epoch text',
  ]);
  assert.doesNotMatch(col,/coordinates|owner|sale|geometry|price/i);
});

test('RPC matches canonical county/source and both distinct scope rows',()=>{
  for(const key of [
    'FROM bdp_parcel_index.source_registry AS source',
    'JOIN bdp_parcel_index.geometry_publication_reviews AS rights',
    'JOIN bdp_parcel_index.parcel_policy_epochs AS cache',
    'JOIN bdp_parcel_index.parcel_policy_epochs AS publication',
    "cache.policy_scope = 'source_cache'",
    "publication.policy_scope = 'geometry_publication'",
    'source.county_fips = p_county_fips::char(5)',
    'source.source_id = p_source_id','LIMIT 1',
  ])assert.ok(SQL.includes(key),key);
});

test('epoch counts are not conflated with current source or GIS approval',()=>{
  assert.match(SQL,/NEVER proof/);
  assert.doesNotMatch(SQL,/source\.rights_state = 'approved'/);
  assert.doesNotMatch(SQL,/rights\.review_state = 'approved'/);
  assert.doesNotMatch(SQL,/ST_AsGeoJSON|ST_Intersects|ST_Union/);
});

test('strict reader returns frozen exact BIGINT strings without JS rounding',async()=>{
  const ctx=setup({rows:[row({source_cache_epoch:'9007199254740993',
    publication_epoch:'9223372036854775807'})]});
  assert.deepEqual(await ctx.reader.readPolicyEpochSnapshot(input()),{
    sourceId:'step40c13-synthetic',countyFips:'48453',
    sourceCacheEpoch:'9007199254740993',publicationEpoch:'9223372036854775807',
  });
  assert.deepEqual(ctx.calls,[
    'connect','BEGIN TRANSACTION READ ONLY',
    'SET LOCAL statement_timeout = '+PRIVATE_POLICY_EPOCH_TIMEOUT_MS,
    'SET LOCAL lock_timeout = 500',
    'SET LOCAL idle_in_transaction_session_timeout = 2500',
    'attest','epoch-rpc','COMMIT','release',
  ]);
  assert.deepEqual(ctx.releases,[false]);
});

test('zero or ambiguous epoch source records cannot authorize a snapshot',async()=>{
  for(const rows of [[],[row(),row()]])
    assert.equal(await setup({rows}).reader.readPolicyEpochSnapshot(input()),null);
});

test('wrong source/county, extra or absent SQL fields are rejected',async()=>{
  for(const bad of [
    row({county_fips:'48029'}),row({source_id:'wrong-source'}),
    {...row(),private_owner:'no'},{
      source_id:'step40c13-synthetic',county_fips:'48453',
      source_cache_epoch:'3',
    },
  ])assert.equal(await setup({rows:[bad]}).reader.readPolicyEpochSnapshot(input()),null);
});

test('epoch zero, overflow, float, leading zero or nonstring is denied',async()=>{
  for(const x of ['0','-1','01','1.5',' 1','1 ',
    '9223372036854775808','9999999999999999999999999',1,0,null]){
    for(const field of ['source_cache_epoch','publication_epoch']){
      assert.equal(await setup({rows:[row({[field]:x})]})
        .reader.readPolicyEpochSnapshot(input()),null);
    }
  }
});

test('invalid input, caller SQL/rights options cannot reach connections',async()=>{
  const ctx=setup();
  for(const bad of [
    null,{},input({countyFips:'06037'}),input({sourceId:'BAD'}),
    input({signal:'not-signal'}),input({rightsState:'approved'}),
    input({role:'admin'}),input({sourceCacheEpoch:'100'}),
  ])assert.equal(await ctx.reader.readPolicyEpochSnapshot(bad),null);
  assert.deepEqual(ctx.calls,[]);
});

test('epoch equality detects the A→B→A problem with otherwise identical facts',()=>{
  const before={sourceId:'step40c13-synthetic',countyFips:'48453',
    sourceCacheEpoch:'1',publicationEpoch:'2'};
  assert.equal(isCanonicalPrivatePolicyEpochSnapshot(before),true);
  assert.equal(samePrivatePolicyEpochSnapshot(before,{...before}),true);
  assert.equal(samePrivatePolicyEpochSnapshot(before,{
    ...before,sourceCacheEpoch:'3',
  }),false);
  assert.equal(samePrivatePolicyEpochSnapshot(before,{
    ...before,publicationEpoch:'4',
  }),false);
  assert.equal(samePrivatePolicyEpochSnapshot(before,{
    ...before,countyFips:'48029',
  }),false);
});

test('snapshot comparator rejects forged fields and invalid counter encodings',()=>{
  const before={sourceId:'step40c13-synthetic',countyFips:'48453',
    sourceCacheEpoch:'1',publicationEpoch:'2'};
  for(const bad of [
    null,{}, {...before,publicationEpoch:'0'},
    {...before,sourceCacheEpoch:1},
    {...before,geometryAuthorized:true},
    {...before,publicationEpoch:'9223372036854775808'},
  ]){
    assert.equal(isCanonicalPrivatePolicyEpochSnapshot(bad),false);
    assert.equal(samePrivatePolicyEpochSnapshot(before,bad),false);
  }
});

test('separate dedicated epoch LOGIN cannot masquerade as other SQL roles',()=>{
  assert.throws(()=>createPinnedPrivatePolicyEpochRpcExecutor(),TypeError);
  for(const login of [
    'postgres','ldos_parcel_rpc_client','ldos_parcel_authority_test',
    'ldos_parcel_geometry_test','ldos_parcel_publication_test',
    'ldos_parcel_epoch_','ldos_parcel_epoch_A',
  ])assert.throws(()=>createPinnedPrivatePolicyEpochRpcExecutor({
    connect:async()=>null,expectedLogin:login,
  }),TypeError);
  assert.throws(()=>createPinnedPrivatePolicyEpochRpcExecutor({
    connect:async()=>null,expectedLogin:LOGIN,admin:true,
  }),TypeError);
});

test('attestation checks exact identity, every table, sequence and other routine',()=>{
  for(const key of [
    'current_user = session_user AND current_user = $1::text',
    'r.rolcanlogin','r.rolinherit','r.rolbypassrls',
    'pg_catalog.pg_auth_members','has_schema_privilege',
    'has_table_privilege','has_sequence_privilege',
    'pg_catalog.pg_proc','no_other_index_rpc',
    'parcel_policy_epoch_snapshot_rpc(text,text)',
  ])assert.ok(PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL.includes(key),key);
});

test('role privilege drift fails before any private epoch SQL',async()=>{
  for(const bad of [
    ...KEYS.map(k=>({...proof(),[k]:false})),
    {...proof(),safe_login:'true'},{...proof(),unexpected:true},null,
  ]){
    const ctx=setup({role:bad});
    assert.equal(await ctx.reader.readPolicyEpochSnapshot(input()),null);
    assert.deepEqual(ctx.releases,[true]);
    assert.ok(!ctx.calls.includes('epoch-rpc'));
    assert.ok(ctx.calls.includes('ROLLBACK'));
  }
});

test('arbitrary SQL and mutable input cannot connect',async()=>{
  const ctx=setup();
  const sig=new AbortController().signal;
  for(const bad of [
    null,{}, Object.freeze({text:'SELECT * FROM parcel_policy_epochs',
      values:Object.freeze(['48453','step40c13-synthetic']),signal:sig}),
    Object.freeze({text:PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL,
      values:Object.freeze(['06037','step40c13-synthetic']),signal:sig}),
    {text:PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL,
      values:Object.freeze(['48453','step40c13-synthetic']),signal:sig},
    Object.freeze({text:PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL,
      values:['48453','step40c13-synthetic'],signal:sig}),
  ])await assert.rejects(ctx.db.queryFixedEpochRpc(bad));
  assert.deepEqual(ctx.calls,[]);
});

test('SQL result oversize and unexpected columns discard pinned SQL client',async()=>{
  for(const rows of [
    [row(),row()],
    [{...row(),secret:'x'}],
    [row({source_cache_epoch:'9'.repeat(PRIVATE_POLICY_EPOCH_MAX_BYTES)})],
  ]){
    const ctx=setup({rows});
    await assert.rejects(ctx.db.queryFixedEpochRpc(statement()));
    assert.ok(ctx.calls.includes('ROLLBACK'));
    assert.deepEqual(ctx.releases,[true]);
  }
});

test('cancellation before or during SQL returns no epoch and discards client',async()=>{
  const abort=new AbortController();abort.abort();
  const before=setup();
  assert.equal(await before.reader.readPolicyEpochSnapshot(input({signal:abort.signal})),null);
  assert.deepEqual(before.calls,[]);
  const later=new AbortController();
  const during=setup({duringRpc:async()=>later.abort()});
  assert.equal(await during.reader.readPolicyEpochSnapshot(input({
    signal:later.signal,
  })),null);
  assert.ok(during.calls.includes('ROLLBACK'));
  assert.deepEqual(during.releases,[true]);
});

test('DB failures are generic and no pool, server or frontend permission is created',async()=>{
  const ctx=setup({connectError:true});
  const result=await ctx.db.queryFixedEpochRpc(statement()).then(()=>null,e=>e);
  assert.ok(result instanceof Error);
  assert.doesNotMatch(result.message,/PRIVATE HOST|SECRET/);
  for(const path of [
    '../../../server/providers/bdp-parcel-policy-epoch-db.js',
    '../../../server/providers/bdp-parcel-policy-epoch-reader.js',
  ]){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.doesNotMatch(source,/createServer\(|\.listen\(|new Pool\(|app\.get\(/);
    assert.doesNotMatch(source,/CREATE ROLE|GRANT EXECUTE ON FUNCTION/);
  }
});
