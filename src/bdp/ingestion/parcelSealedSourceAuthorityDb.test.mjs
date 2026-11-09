import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPrivateSealedSourceAuthorityReader,
  PRIVATE_SEALED_SOURCE_AUTHORITY_SQL,
} from '../../../server/providers/bdp-parcel-sealed-source-authority.js';
import {
  createPinnedSealedSourceAuthorityRpcExecutor,
  SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL,
  SEALED_SOURCE_AUTHORITY_MAX_BYTES,
  SEALED_SOURCE_AUTHORITY_STATEMENT_TIMEOUT_MS,
} from '../../../server/providers/bdp-parcel-sealed-source-authority-db.js';

const LOGIN = 'ldos_parcel_authority_test';
const NOW = 1_000_000;
const ROW = () => ({
  source_id:'travis-cad',county_fips:'48453',rights_state:'approved',
  approved_caching_until_ms:NOW + 200_000,run_id:'42',
  source_version:'synthetic-v1',sealed_at_ms:NOW - 1_000,
  indexed_records:'3',sealed_run:true,
});
const PROOF_KEYS=[
  'exact_login','safe_login','no_role_memberships',
  'schema_usage','no_schema_create','no_index_table_access',
  'no_index_sequence_access','fixed_rpc_execute','no_other_index_rpc',
];
const proof = () => Object.fromEntries(PROOF_KEYS.map(key => [key,true]));
const input = (signal=new AbortController().signal) => Object.freeze({
  text:PRIVATE_SEALED_SOURCE_AUTHORITY_SQL,
  values:Object.freeze(['48453']),signal,
});
function setup({roleProof=proof(),dbRows=[ROW()],connectError=null,afterRpc=null}={}) {
  const calls=[];
  const releases=[];
  const executor=createPinnedSealedSourceAuthorityRpcExecutor({
    expectedLogin:LOGIN,
    async connect() {
      calls.push('connect');
      if(connectError) throw connectError;
      return {
        async query(stmt) {
          if(typeof stmt === 'string') {
            calls.push(stmt);
            return {rows:[]};
          }
          if(stmt.text === SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL) {
            calls.push('attest');
            assert.deepEqual(stmt.values,[LOGIN]);
            assert.ok(Object.isFrozen(stmt.values));
            return {rows:[roleProof]};
          }
          if(stmt.text === PRIVATE_SEALED_SOURCE_AUTHORITY_SQL) {
            calls.push('authority-rpc');
            assert.deepEqual(stmt.values,['48453']);
            if(afterRpc) await afterRpc();
            return {rows:dbRows};
          }
          throw new Error('Unexpected SQL');
        },
        release(e) { releases.push(Boolean(e)); calls.push(e?'discard':'release'); },
      };
    },
  });
  return {executor,calls,releases};
}

test('constructor rejects missing config, non-authority login, and extra privileges',()=>{
  assert.throws(()=>createPinnedSealedSourceAuthorityRpcExecutor(),TypeError);
  for(const expectedLogin of ['postgres','bdp','ldos_parcel_rpc_client',
    'ldos_parcel_geometry_test','ldos_parcel_authority_A','ldos_parcel_authority_']) {
    assert.throws(()=>createPinnedSealedSourceAuthorityRpcExecutor({
      connect:async()=>null, expectedLogin,
    }),TypeError);
  }
  assert.throws(()=>createPinnedSealedSourceAuthorityRpcExecutor({
    connect:async()=>null,expectedLogin:LOGIN,role:'admin',
  }),TypeError);
});

test('strictly pinned READ ONLY query attests role before fixed RPC',async()=>{
  const {executor,calls,releases}=setup();
  const result=await executor.queryFixedAuthorityRpc(input());
  assert.deepEqual(result,{rows:[ROW()]});
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.rows));
  assert.ok(Object.isFrozen(result.rows[0]));
  assert.deepEqual(calls,[
    'connect','BEGIN TRANSACTION READ ONLY',
    'SET LOCAL statement_timeout = '+SEALED_SOURCE_AUTHORITY_STATEMENT_TIMEOUT_MS,
    'SET LOCAL lock_timeout = 500',
    'SET LOCAL idle_in_transaction_session_timeout = 2500',
    'attest','authority-rpc','COMMIT','release',
  ]);
  assert.deepEqual(releases,[false]);
  assert.equal(JSON.stringify(result).includes('coordinates'),false);
});

test('fixed executor and 40C34 adapter compose without public geometry',async()=>{
  const {executor}=setup();
  const reader=createPrivateSealedSourceAuthorityReader({
    queryFixedAuthorityRpc:executor.queryFixedAuthorityRpc,now:()=>NOW,
  });
  const result=await reader.readSealedSource({
    countyFips:'48453',signal:new AbortController().signal,
  });
  assert.equal(result?.sourceId,'travis-cad');
  assert.equal(result?.runId,42);
  assert.equal(result?.sealedRun,true);
  assert.equal(result?.indexedRecords,3);
  assert.equal(JSON.stringify(result).includes('geometry'),false);
});

test('SQL is fixed, principal is checked against server-supplied expected login',()=>{
  const sql=SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL;
  assert.match(sql,/current_user = session_user AND current_user = \$1::text/);
  assert.match(sql,/r\.rolcanlogin/);
  assert.match(sql,/rolsuper OR r\.rolcreatedb OR r\.rolcreaterole/);
  assert.match(sql,/rolreplication OR r\.rolbypassrls OR r\.rolinherit/);
  assert.match(sql,/pg_catalog\.pg_auth_members/);
  assert.match(sql,/NOT EXISTS/);
  assert.match(sql,/pg_catalog\.pg_class/);
  assert.match(sql,/has_table_privilege/);
  assert.match(sql,/has_sequence_privilege/);
  assert.match(sql,/pg_catalog\.pg_proc/);
  assert.match(sql,/has_function_privilege/);
  assert.match(sql,/parcel_sealed_source_authority_rpc\(text\)/);
  assert.doesNotMatch(sql,/^\s*(?:UPDATE|INSERT|DELETE|GRANT|REVOKE)\s/mi);
});

test('any missing, FALSE, extra or truthy nonboolean role proof rejects SQL',async()=>{
  for(const bad of [
    ...PROOF_KEYS.map(k=>({...proof(),[k]:false})),
    {...proof(),safe_login:'true'},
    {...proof(),no_index_table_access:1},
    {...proof(),extra_grant:true},
    Object.fromEntries(PROOF_KEYS.slice(1).map(k=>[k,true])),
    null,
  ]) {
    const {executor,calls,releases}=setup({roleProof:bad});
    await assert.rejects(executor.queryFixedAuthorityRpc(input()),
      /Private sealed-source authority unavailable/);
    assert.ok(calls.includes('ROLLBACK'));
    assert.ok(!calls.includes('authority-rpc'));
    assert.deepEqual(releases,[true]);
  }
});

test('invalid county, arbitrary SQL, injected source and mutable statement cannot connect',async()=>{
  const {executor,calls}=setup();
  for(const data of [
    null,{},input().text,
    Object.freeze({text:'SELECT * FROM parcel_versions',
      values:Object.freeze(['48453']),signal:new AbortController().signal}),
    Object.freeze({text:PRIVATE_SEALED_SOURCE_AUTHORITY_SQL,
      values:Object.freeze(['06037']),signal:new AbortController().signal}),
    Object.freeze({text:PRIVATE_SEALED_SOURCE_AUTHORITY_SQL,
      values:Object.freeze(['48453','travis-cad']),signal:new AbortController().signal}),
    {text:PRIVATE_SEALED_SOURCE_AUTHORITY_SQL,
      values:Object.freeze(['48453']),signal:new AbortController().signal},
    Object.freeze({text:PRIVATE_SEALED_SOURCE_AUTHORITY_SQL,
      values:['48453'],signal:new AbortController().signal}),
    Object.freeze({text:PRIVATE_SEALED_SOURCE_AUTHORITY_SQL,
      values:Object.freeze(['48453']),signal:'not-a-signal'}),
  ]) await assert.rejects(executor.queryFixedAuthorityRpc(data));
  assert.deepEqual(calls,[]);
});

test('missing client, connector exception or malformed results always scrub details',async()=>{
  for(const setupOptions of [
    {connectError:new Error('PRIVATE HOST CREDENTIAL')},
    {dbRows:null},{dbRows:{}},{dbRows:'BAD'},
  ]) {
    const {executor}=setup(setupOptions);
    const error=await executor.queryFixedAuthorityRpc(input())
      .then(()=>null,e=>e);
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes('PRIVATE HOST'));
  }
});

test('more than two rows, unexpected columns and oversize wire results fail closed',async()=>{
  for(const dbRows of [
    [ROW(),ROW(),ROW()],
    [{...ROW(),owner:'private'}],
    [{...ROW(),source_version:'x'.repeat(SEALED_SOURCE_AUTHORITY_MAX_BYTES)}],
  ]) {
    const {executor,calls,releases}=setup({dbRows});
    await assert.rejects(executor.queryFixedAuthorityRpc(input()));
    assert.ok(calls.includes('ROLLBACK'));
    assert.deepEqual(releases,[true]);
  }
});

test('zero rows remain zero, never a source-coverage determination',async()=>{
  const {executor}=setup({dbRows:[]});
  const result=await executor.queryFixedAuthorityRpc(input());
  assert.deepEqual(result.rows,[]);
  const reader=createPrivateSealedSourceAuthorityReader({
    queryFixedAuthorityRpc:async()=>result,now:()=>NOW,
  });
  assert.equal(await reader.readSealedSource({
    countyFips:'48453',signal:new AbortController().signal,
  }),null);
});

test('an aborted request cannot connect or release private rows',async()=>{
  const stop=new AbortController();stop.abort();
  const before=setup();
  await assert.rejects(before.executor.queryFixedAuthorityRpc(input(stop.signal)));
  assert.deepEqual(before.calls,[]);
  const later=new AbortController();
  const pending=setup({afterRpc:async()=>later.abort()});
  await assert.rejects(pending.executor.queryFixedAuthorityRpc(input(later.signal)));
  assert.ok(pending.calls.includes('ROLLBACK'));
  assert.deepEqual(pending.releases,[true]);
});

test('failed role attest always aborts before SQL and discards pinned client',async()=>{
  const {executor,calls}=setup({roleProof:{...proof(),fixed_rpc_execute:false}});
  await assert.rejects(executor.queryFixedAuthorityRpc(input()));
  assert.deepEqual(calls.slice(-2),['ROLLBACK','discard']);
});

test('authority SQL module cannot open a pool, listen, migrate, or publish parcels',()=>{
  const source=readFileSync(new URL(
    '../../../server/providers/bdp-parcel-sealed-source-authority-db.js',
    import.meta.url),'utf8');
  assert.doesNotMatch(source,/createServer\(|\.listen\(|new Pool\(|fetch\(/);
  assert.doesNotMatch(source,/GRANT EXECUTE ON FUNCTION|CREATE ROLE|CREATE USER/);
  assert.match(source,/UNROUTED/);
  assert.match(source,/in-flight pg command/);
});
