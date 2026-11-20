import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createFixedSealedGeometryRpcReader,
  SEALED_GEOMETRY_ROLE_ATTESTATION_SQL,
  PRIVATE_SEALED_GEOMETRY_MAX_BYTES,
} from '../../../server/providers/bdp-parcel-sealed-geometry-rpc.js';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import {
  buildPrivateSealedInitialRpcStatement, PRIVATE_SEALED_INITIAL_RPC_SQL,
} from './parcelSealedInitialPagePlan.js';
import { PRIVATE_PARCEL_KEYSET_RPC_SQL } from './parcelKeysetPagination.js';

const LOGIN='ldos_parcel_geometry_test';
const fields=['same_principal','safe_principal','no_schema_create',
  'no_source_table','no_run_table','no_seal_table','no_parcel_table',
  'no_coverage_table','no_rights_table','sealed_initial_allowed',
  'sealed_keyset_allowed','unsealed_snapshot_denied','metadata_source_denied',
  'metadata_viewport_denied','sealed_authority_denied',
  'publication_review_denied','exact_login','safe_login',
  'no_role_memberships','schema_usage','no_index_table_access',
  'no_index_sequence_access','no_other_index_rpc'];
const proof=()=>Object.fromEntries(fields.map(k=>[k,true]));
const signal=()=>new AbortController().signal;
const plan=()=>parseBoundedParcelPageRequest({
  countyFips:'48453',
  bounds:{west:-97.76,south:30.24,east:-97.73,north:30.27},limit:2,
});
const input=(override={})=>{
  const initial=buildPrivateSealedInitialRpcStatement({
    plan:plan(),trustedSourceId:'travis-cad',trustedRunId:42,
  });
  return {statement:Object.freeze({
    text:initial.text,values:initial.values,
  }),signal:signal(),...override};
};
const row=(extra={})=>({
  parcel_version_id:'1',source_parcel_id:'P-001',
  source_version:'synthetic-v1',source_geometry_sha256:'a'.repeat(64),
  ingest_run_id:'42',source_id:'travis-cad',county_fips:'48453',
  geometry_vertices:5,geometry_memory_bytes:240,geometry:{
    type:'MultiPolygon',
    coordinates:[[[[-97.75,30.25],[-97.74,30.25],[-97.74,30.26],
      [-97.75,30.26],[-97.75,30.25]]]],
  },...extra,
});
function fake({role=proof(),rows=[row()],afterRead=null,fail=null}={}) {
  const calls=[];const released=[];
  const reader=createFixedSealedGeometryRpcReader({
    expectedLogin:LOGIN,
    connect:async()=>{
      calls.push('connect');
      if(fail)throw new Error('SECRET CONNECT');
      return {
        async query(s) {
          if(typeof s==='string') {calls.push(s);return {rows:[]};}
          if(s.text===SEALED_GEOMETRY_ROLE_ATTESTATION_SQL) {
            calls.push('attest');
            assert.deepEqual(s.values,[LOGIN]);
            assert.ok(Object.isFrozen(s.values));
            return {rows:[role]};
          }
          if([PRIVATE_SEALED_INITIAL_RPC_SQL,PRIVATE_PARCEL_KEYSET_RPC_SQL]
            .includes(s.text)) {
            calls.push('rpc');
            if(afterRead)await afterRead();
            return {rows};
          }
          throw Error('Unexpected or arbitrary SQL');
        },
        release(error) {released.push(Boolean(error));calls.push(error?'discard':'release');},
      };
    },
  });
  return {reader,calls,released};
}
test('40C38 requires an exact dedicated geometry LOGIN and no extra config',()=>{
  assert.throws(()=>createFixedSealedGeometryRpcReader(),TypeError);
  for(const expectedLogin of [
    'postgres','ldos_parcel_authority_test','ldos_parcel_publication_test',
    'ldos_parcel_geometry_','ldos_parcel_geometry_A','ldos_parcel_geometry_test;DROP',
  ]) assert.throws(()=>createFixedSealedGeometryRpcReader({
    connect:async()=>null,expectedLogin,
  }),TypeError);
  assert.throws(()=>createFixedSealedGeometryRpcReader({
    connect:async()=>null,expectedLogin:LOGIN,admin:true,
  }),TypeError);
});
test('geometry role attestation pins current_user=session_user to expected LOGIN',()=>{
  const q=SEALED_GEOMETRY_ROLE_ATTESTATION_SQL;
  assert.match(q,/current_user = session_user AND current_user = \$1::text/);
  assert.match(q,/r\.rolcanlogin/);
  assert.match(q,/r\.rolinherit/);
  assert.match(q,/r\.rolreplication/);
  assert.match(q,/r\.rolbypassrls/);
  assert.match(q,/pg_catalog\.pg_auth_members/);
});
test('all raw parcel-index tables and sequences are denied by catalog iteration',()=>{
  const q=SEALED_GEOMETRY_ROLE_ATTESTATION_SQL;
  assert.match(q,/pg_catalog\.pg_class/);
  assert.match(q,/c\.relkind IN \('r','p','v','m','f'\)/);
  assert.match(q,/has_table_privilege/);
  assert.match(q,/c\.relkind = 'S'/);
  assert.match(q,/has_sequence_privilege/);
  assert.match(q,/has_schema_privilege/);
});
test('only TWO sealed geometry RPC signatures may be executable',()=>{
  const q=SEALED_GEOMETRY_ROLE_ATTESTATION_SQL;
  assert.match(q,/no_other_index_rpc/);
  assert.match(q,/pg_catalog\.pg_proc/);
  assert.match(q,/parcel_geometry_sealed_initial_rpc\(text,text,bigint/);
  assert.match(q,/parcel_geometry_keyset_rpc\(text,text,bigint/);
  assert.match(q,/publication_review_denied/);
  assert.match(q,/sealed_authority_denied/);
  assert.doesNotMatch(q,/^\s*(?:GRANT|UPDATE|DELETE|INSERT)\s/mi);
});
test('pinned read-only geometry transaction attests before one allowlisted RPC',async()=>{
  const {reader,calls,released}=fake();
  const answer=await reader.querySealedRpc(input());
  assert.equal(answer.length,1);
  assert.equal(answer[0].source_parcel_id,'P-001');
  assert.ok(Object.isFrozen(answer));
  assert.ok(Object.isFrozen(answer[0]));
  assert.deepEqual(calls,[
    'connect','BEGIN TRANSACTION READ ONLY',
    'SET LOCAL statement_timeout = 1200',
    'SET LOCAL lock_timeout = 800',
    'SET LOCAL idle_in_transaction_session_timeout = 3000',
    'attest','rpc','COMMIT','release',
  ]);
  assert.deepEqual(released,[false]);
});
test('missing, false, extra and nonboolean role proofs reject before RPC',async()=>{
  for(const role of [
    ...['exact_login','safe_login','no_role_memberships',
      'no_index_table_access','no_index_sequence_access',
      'no_other_index_rpc','sealed_initial_allowed','sealed_keyset_allowed']
      .map(k=>({...proof(),[k]:false})),
    {...proof(),exact_login:'true'}, {...proof(),extra:'bad'}, null,
  ]) {
    const ctx=fake({role});
    await assert.rejects(ctx.reader.querySealedRpc(input()),
      /Private sealed geometry SQL unavailable/);
    assert.ok(ctx.calls.includes('ROLLBACK'));
    assert.ok(!ctx.calls.includes('rpc'));
    assert.deepEqual(ctx.released,[true]);
  }
});
test('caller SQL injection and malformed mutable statement cannot reach DB',async()=>{
  const ctx=fake();
  const valid=input();
  for(const statement of [
    {text:'SELECT * FROM bdp_parcel_index.parcel_versions',
      values:Object.freeze([])},
    {text:PRIVATE_SEALED_INITIAL_RPC_SQL,
      values:valid.statement.values},
    Object.freeze({text:PRIVATE_SEALED_INITIAL_RPC_SQL,values:[
      ...valid.statement.values,
    ]}),
    Object.freeze({text:PRIVATE_SEALED_INITIAL_RPC_SQL,values:Object.freeze([
      '48453','travis-cad',42,-97.76,30.24,-97.73,30.27,3,'bad',
    ])}),
  ]) await assert.rejects(ctx.reader.querySealedRpc({
    statement,signal:signal(),
  }));
  assert.deepEqual(ctx.calls,[]);
});
test('geometry SQL row shape, row count and byte caps reject and discard',async()=>{
  for(const rows of [
    [{...row(),owner_name:'PRIVATE'}],
    [row({source_version:'x'.repeat(PRIVATE_SEALED_GEOMETRY_MAX_BYTES)})],
    Array.from({length:205},(_,i)=>row({
      parcel_version_id:String(i+1),source_parcel_id:'P-'+i,
    })),
  ]) {
    const ctx=fake({rows});
    await assert.rejects(ctx.reader.querySealedRpc(input()));
    assert.deepEqual(ctx.released,[true]);
  }
});
test('aborted before connection cannot run SQL',async()=>{
  const stopped=new AbortController();stopped.abort();
  const ctx=fake();
  await assert.rejects(ctx.reader.querySealedRpc(input({
    signal:stopped.signal,
  })));
  assert.deepEqual(ctx.calls,[]);
});
test('aborted during RPC never exposes even valid SQL rows',async()=>{
  const stopped=new AbortController();
  const ctx=fake({afterRead:async()=>stopped.abort()});
  await assert.rejects(ctx.reader.querySealedRpc(input({
    signal:stopped.signal,
  })));
  assert.ok(ctx.calls.includes('ROLLBACK'));
  assert.deepEqual(ctx.released,[true]);
});
test('connection failure is generic and independent of private host name',async()=>{
  const ctx=fake({fail:true});
  const err=await ctx.reader.querySealedRpc(input()).then(()=>null,e=>e);
  assert.ok(err instanceof Error);
  assert.doesNotMatch(err.message,/SECRET/);
});
test('no pool, login issuance, HTTP endpoint or browser geometry is created',()=>{
  const src=readFileSync(new URL(
    '../../../server/providers/bdp-parcel-sealed-geometry-rpc.js',
    import.meta.url),'utf8');
  assert.doesNotMatch(src,/createServer\(|\.listen\(|new Pool\(|app\.get\(/);
  assert.doesNotMatch(src,/document\.cookie|localStorage/);
  assert.match(src,/AbortSignal checks do not actively cancel/);
});
