import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL,
  createPrivateGeometryPublicationReviewReader,
} from '../../../server/providers/bdp-parcel-geometry-publication-review.js';
import {
  createPinnedGeometryPublicationReviewRpcExecutor,
  GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL,
  PUBLICATION_REVIEW_MAX_BYTES,
  PUBLICATION_REVIEW_TIMEOUT_MS,
} from '../../../server/providers/bdp-parcel-geometry-publication-review-db.js';

const SQL=readFileSync(new URL(
  './sql/parcelGeometryPublicationReviewRpcFoundation.sql',import.meta.url),'utf8');
const LOGIN='ldos_parcel_publication_test';
const NOW=1_000_000;
const row=(extra={})=>({
  source_id:'travis-cad',county_fips:'48453',review_state:'approved',
  allow_geometry_redistribution:true,review_reference:'synthetic/review-36',
  reviewed_at_ms:NOW-5_000,expires_at_ms:NOW+200_000,...extra,
});
const proofFields=['exact_login','safe_login','no_role_memberships',
  'schema_usage','no_schema_create','no_index_table_access',
  'no_index_sequence_access','fixed_rpc_execute','no_other_index_rpc'];
const proof=()=>Object.fromEntries(proofFields.map(k=>[k,true]));
const scope=(extra={})=>({
  countyFips:'48453',sourceId:'travis-cad',
  signal:new AbortController().signal,...extra,
});
function setup({rows=[row()],role=proof(),dbError=null,onRead=null}={}) {
  const calls=[];
  const released=[];
  const db=createPinnedGeometryPublicationReviewRpcExecutor({
    expectedLogin:LOGIN,
    async connect() {
      calls.push('connect');
      if(dbError)throw dbError;
      return {
        async query(statement) {
          if(typeof statement==='string'){
            calls.push(statement);
            return {rows:[]};
          }
          if(statement.text===GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL){
            calls.push('attest');
            assert.deepEqual(statement.values,[LOGIN]);
            return {rows:[role]};
          }
          if(statement.text===PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL){
            calls.push('review-rpc');
            assert.deepEqual(statement.values,['48453','travis-cad']);
            if(onRead)await onRead();
            return {rows};
          }
          throw Error('Unexpected SQL');
        },
        release(err) {calls.push(err?'discard':'release');released.push(Boolean(err));},
      };
    },
  });
  const reader=createPrivateGeometryPublicationReviewReader({
    queryFixedPublicationRpc:db.queryFixedPublicationRpc,now:()=>NOW,
  });
  return {reader,db,calls,released};
}

test('publication SQL is separately staged, transactional and NO-GRANT',()=>{
  assert.match(SQL,/DBA REVIEW ONLY/);
  assert.match(SQL,/^BEGIN;/m);
  assert.match(SQL,/^COMMIT;/m);
  assert.match(SQL,/CREATE FUNCTION bdp_parcel_index\.parcel_geometry_publication_review_rpc/);
  assert.match(SQL,/LANGUAGE sql VOLATILE SECURITY DEFINER/);
  assert.match(SQL,/SET search_path = pg_catalog, pg_temp/);
  assert.match(SQL,/REVOKE ALL ON FUNCTION bdp_parcel_index\.parcel_geometry_publication_review_rpc\(\s*text,text\s*\) FROM PUBLIC;/);
  assert.match(SQL,/REVOKE ALL ON FUNCTION bdp_parcel_index\.parcel_geometry_publication_review_rpc\(\s*text,text\s*\) FROM ldos_parcel_rpc_client;/);
  assert.doesNotMatch(SQL,/^\s*GRANT\s/mi);
  assert.doesNotMatch(SQL,/CREATE ROLE|CREATE USER|CREATE OR REPLACE FUNCTION/);
});

test('publication SQL references ONLY independent geometry rights registry',()=>{
  assert.match(SQL,/FROM bdp_parcel_index\.geometry_publication_reviews AS rights/);
  assert.doesNotMatch(SQL,/JOIN bdp_parcel_index\.source_registry/);
  assert.doesNotMatch(SQL,/JOIN bdp_parcel_index\.ingest_runs/);
  assert.match(SQL,/rights\.review_state = 'approved'/);
  assert.match(SQL,/rights\.allow_geometry_redistribution = TRUE/);
  assert.match(SQL,/rights\.source_id = p_source_id/);
  assert.match(SQL,/rights\.county_fips = p_county_fips::char\(5\)/);
  assert.match(SQL,/LIMIT 1/);
});

test('SQL requires current review and explicit expiry, not public REST access',()=>{
  assert.match(SQL,/rights\.reviewed_at <= pg_catalog\.clock_timestamp\(\)/);
  assert.match(SQL,/rights\.expires_at > pg_catalog\.clock_timestamp\(\)/);
  assert.match(SQL,/rights\.expires_at > rights\.reviewed_at/);
  assert.match(SQL,/rights\.review_reference ~ /);
  assert.match(SQL,/p_county_fips ~ /);
  assert.match(SQL,/p_source_id ~ /);
  assert.doesNotMatch(SQL,/^\s*(?:COPY|UPDATE|DELETE|INSERT)\s/mi);
});

test('only exact seven review columns are returned; no geometry, owners or parcels',()=>{
  const fields=SQL.match(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE sql/)?.[1];
  assert.ok(fields);
  assert.equal((fields.match(/^  [a-z_]+ (?:text|boolean|double precision)/gm)||[]).length,7);
  assert.doesNotMatch(fields,/geometry|owner|sale|parcel|price|title/i);
});

test('private reader binds exact source and county, returns canonical frozen approval',async()=>{
  const {reader,calls}=setup();
  const v=await reader.readPublicationReview(scope());
  assert.deepEqual(v,{
    sourceId:'travis-cad',countyFips:'48453',
    reviewState:'approved',allowGeometryRedistribution:true,
    reviewReference:'synthetic/review-36',
    reviewedAtMs:NOW-5_000,expiresAtMs:NOW+200_000,
  });
  assert.ok(Object.isFrozen(v));
  assert.deepEqual(calls,[
    'connect','BEGIN TRANSACTION READ ONLY',
    'SET LOCAL statement_timeout = '+PUBLICATION_REVIEW_TIMEOUT_MS,
    'SET LOCAL lock_timeout = 500',
    'SET LOCAL idle_in_transaction_session_timeout = 2500',
    'attest','review-rpc','COMMIT','release',
  ]);
});

test('reader rejects zero or multiple review results instead of inventing permission',async()=>{
  for(const rows of [[],[row(),row()]]) {
    const {reader}=setup({rows});
    assert.equal(await reader.readPublicationReview(scope()),null);
  }
});

test('review cannot be inferred from caching approval or unsupported status',async()=>{
  for(const value of [
    {review_state:'unreviewed'},{review_state:'restricted'},
    {review_state:'revoked'},{allow_geometry_redistribution:false},
    {review_reference:'SYNTHETIC TEST ONLY'},
    {review_reference:'x'}, {reviewed_at_ms:NOW+1},
    {reviewed_at_ms:NOW},{expires_at_ms:NOW},
    {expires_at_ms:NOW-1}, {county_fips:'48029'},
    {source_id:'different-cad'}, {bad:'extra'},
  ]) {
    const {reader}=setup({rows:[row(value)]});
    assert.equal(await reader.readPublicationReview(scope()),null);
  }
});

test('reader rejects caller-controlled source, review status and arbitrary query options',async()=>{
  const {reader,calls}=setup();
  for(const bad of [
    null,{},scope({countyFips:'06037'}),scope({sourceId:'TRAVIS CAD'}),
    scope({signal:'not-a-signal'}),scope({rightsState:'approved'}),
    scope({allowGeometryRedistribution:true}),scope({role:'admin'}),
  ]) assert.equal(await reader.readPublicationReview(bad),null);
  assert.deepEqual(calls,[]);
});

test('cancellation before and after DB lookup fails closed',async()=>{
  const controller=new AbortController();controller.abort();
  const before=setup();
  assert.equal(await before.reader.readPublicationReview(scope({
    signal:controller.signal,
  })),null);
  assert.deepEqual(before.calls,[]);
  const after=new AbortController();
  const current=setup({onRead:async()=>after.abort()});
  assert.equal(await current.reader.readPublicationReview(scope({
    signal:after.signal,
  })),null);
  assert.ok(current.calls.includes('ROLLBACK'));
  assert.deepEqual(current.released,[true]);
});

test('read exceptions and invalid clock cannot claim GIS redistribution',async()=>{
  assert.throws(()=>createPrivateGeometryPublicationReviewReader(),TypeError);
  const fail=createPrivateGeometryPublicationReviewReader({
    queryFixedPublicationRpc:async()=>{throw Error('PRIVATE DB');},now:()=>NOW,
  });
  assert.equal(await fail.readPublicationReview(scope()),null);
  const weird=createPrivateGeometryPublicationReviewReader({
    queryFixedPublicationRpc:async()=>({rows:[row()]}),now:()=>NaN,
  });
  assert.equal(await weird.readPublicationReview(scope()),null);
});

test('pinned DB constructor restricts role namespace and collaborator fields',()=>{
  assert.throws(()=>createPinnedGeometryPublicationReviewRpcExecutor(),TypeError);
  for(const bad of [
    'postgres','ldos_parcel_rpc_client','ldos_parcel_authority_test',
    'ldos_parcel_publication_A','ldos_parcel_publication_',
  ]) assert.throws(()=>createPinnedGeometryPublicationReviewRpcExecutor({
    connect:async()=>null,expectedLogin:bad,
  }),TypeError);
  assert.throws(()=>createPinnedGeometryPublicationReviewRpcExecutor({
    connect:async()=>null,expectedLogin:LOGIN,owner:true,
  }),TypeError);
});

test('role proof checks exact SQL login and ALL parcel-index privileges',()=>{
  const sql=GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL;
  for(const fragment of [
    'current_user = session_user AND current_user = $1::text',
    'r.rolcanlogin','r.rolbypassrls','r.rolinherit',
    'pg_catalog.pg_auth_members','has_schema_privilege',
    'has_table_privilege','has_sequence_privilege','has_function_privilege',
    'pg_catalog.pg_proc','no_other_index_rpc',
    'parcel_geometry_publication_review_rpc(text,text)',
  ])assert.ok(sql.includes(fragment),fragment);
  assert.doesNotMatch(sql,/^\s*(?:GRANT|REVOKE|UPDATE|DELETE|INSERT)\s/mi);
});

test('role proof fails on missing/false/extra/nonboolean attestation BEFORE RPC',async()=>{
  for(const role of [
    ...proofFields.map(key=>({...proof(),[key]:false})),
    {...proof(),fixed_rpc_execute:'true'},
    {...proof(),no_index_table_access:1},
    {...proof(),extra_role:true}, null,
  ]) {
    const {db,calls,released}=setup({role});
    await assert.rejects(db.queryFixedPublicationRpc(Object.freeze({
      text:PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL,
      values:Object.freeze(['48453','travis-cad']),
      signal:new AbortController().signal,
    })));
    assert.ok(calls.includes('ROLLBACK'));
    assert.ok(!calls.includes('review-rpc'));
    assert.deepEqual(released,[true]);
  }
});

test('database forbids arbitrary SQL, malformed binds and mutable statements',async()=>{
  const {db,calls}=setup();
  const signal=new AbortController().signal;
  for(const statement of [
    null,{},Object.freeze({text:'SELECT * FROM bdp_parcel_index.parcel_versions',
      values:Object.freeze(['48453','travis-cad']),signal}),
    Object.freeze({text:PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL,
      values:Object.freeze(['06037','travis-cad']),signal}),
    Object.freeze({text:PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL,
      values:Object.freeze(['48453',"' OR 1=1 --"]),signal}),
    {text:PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL,
      values:Object.freeze(['48453','travis-cad']),signal},
    Object.freeze({text:PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL,
      values:['48453','travis-cad'],signal}),
  ]) await assert.rejects(db.queryFixedPublicationRpc(statement));
  assert.deepEqual(calls,[]);
});

test('unexpected SQL columns, rows, or payload bytes force client discard',async()=>{
  for(const rows of [
    [row(),row()],
    [{...row(),private_owner:'do not leak'}],
    [row({review_reference:'x'.repeat(PUBLICATION_REVIEW_MAX_BYTES)})],
  ]) {
    const {db,calls,released}=setup({rows});
    await assert.rejects(db.queryFixedPublicationRpc(Object.freeze({
      text:PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL,
      values:Object.freeze(['48453','travis-cad']),
      signal:new AbortController().signal,
    })));
    assert.ok(calls.includes('ROLLBACK'));
    assert.deepEqual(released,[true]);
  }
});

test('missing rights always return null; neither adapter issues GIS approval',async()=>{
  const {reader}=setup({rows:[]});
  assert.equal(await reader.readPublicationReview(scope()),null);
  const a=readFileSync(new URL(
    '../../../server/providers/bdp-parcel-geometry-publication-review.js',import.meta.url),'utf8');
  const b=readFileSync(new URL(
    '../../../server/providers/bdp-parcel-geometry-publication-review-db.js',import.meta.url),'utf8');
  for(const text of [a,b]){
    assert.doesNotMatch(text,/createServer\(|\.listen\(|new Pool\(/);
    assert.doesNotMatch(text,/GRANT EXECUTE ON FUNCTION|CREATE ROLE|CREATE USER/);
  }
});

test('review-only SQL does not grant viewport completeness or publication to browsers',()=>{
  assert.doesNotMatch(SQL,/^\s*GRANT\s/mi);
  assert.match(SQL,/not a browser license|Not a browser license|browser permission/i);
  assert.doesNotMatch(SQL,/parcels?_versions|ST_AsGeoJSON|ST_Intersects/);
});
