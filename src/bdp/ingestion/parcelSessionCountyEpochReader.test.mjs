import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PRIVATE_SESSION_COUNTY_EPOCH_SQL,
  createPrivateSessionCountyEpochReader,
  isCanonicalPrivateSessionCountyEpoch,
  samePrivateSessionCountyEpoch,
} from '../../../server/providers/bdp-parcel-session-county-epoch.js';
import {
  PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL,
  PRIVATE_SESSION_COUNTY_EPOCH_MAX_BYTES,
  createPinnedPrivateSessionCountyEpochRpcExecutor,
} from '../../../server/providers/bdp-parcel-session-county-epoch-db.js';

const sql=readFileSync(new URL(
  './sql/parcelSessionCountyEpochRpcFoundation.sql',import.meta.url),'utf8');
const D='a'.repeat(64),COUNTY='48453',LOGIN='ldos_parcel_session_epoch_test';
const KEYS=['exact_login','safe_login','no_role_memberships',
  'schema_usage','no_schema_create','no_private_table_access',
  'no_private_sequence_access','fixed_rpc_execute','no_other_private_rpc'];
const proof=()=>Object.fromEntries(KEYS.map(k=>[k,true]));
const row=(extra={})=>({
  session_digest:D,county_fips:COUNTY,epoch:'4',...extra,
});
const args=(extra={})=>({
  sessionDigest:D,countyFips:COUNTY,signal:new AbortController().signal,...extra,
});
const frozen=signal=>Object.freeze({
  text:PRIVATE_SESSION_COUNTY_EPOCH_SQL,
  values:Object.freeze([D,COUNTY]),
  signal:signal??new AbortController().signal,
});
function setup({
  rows=[row()],role=proof(),abortAfterSql=null,
  dbError=false,failBeforeSql=false,
}={}){
  const events=[],releases=[];
  const db=createPinnedPrivateSessionCountyEpochRpcExecutor({
    expectedLogin:LOGIN,
    connect:async()=>{
      events.push('connect');
      if(dbError)throw Error('DATABASE_SECRET_NOT_FOR_CLIENT');
      return {
        async query(stmt){
          if(typeof stmt==='string'){
            events.push(stmt);
            return {rows:[]};
          }
          if(stmt.text===PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL){
            events.push('attest');
            assert.deepEqual(stmt.values,[LOGIN]);
            return {rows:[role]};
          }
          if(stmt.text===PRIVATE_SESSION_COUNTY_EPOCH_SQL){
            events.push('rpc');
            assert.deepEqual(stmt.values,[D,COUNTY]);
            if(failBeforeSql)throw Error('RAW_DB_DETAILS');
            abortAfterSql?.();
            return {rows};
          }
          throw Error('FORGED_QUERY_UNRECOGNIZED');
        },
        release(error){
          releases.push(Boolean(error));
          events.push(error?'discard':'release');
        },
      };
    },
  });
  const reader=createPrivateSessionCountyEpochReader({
    queryFixedSessionCountyEpochRpc:db.queryFixedSessionCountyEpochRpc,
  });
  return {db,reader,events,releases};
}

test('47 draft SQL is one read-only fixed RPC with transaction, no grants',()=>{
  assert.match(sql,/^BEGIN;/m);
  assert.match(sql,/^COMMIT;/m);
  assert.match(sql,/SECURITY DEFINER/);
  assert.match(sql,/SET search_path = pg_catalog, pg_temp/);
  assert.match(sql,/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC/);
  assert.doesNotMatch(sql,/^\s*GRANT\s/mi);
  assert.doesNotMatch(sql,/CREATE ROLE|CREATE USER|ST_AsGeoJSON/i);
});

test('47 SQL returns three exact columns; never full account, secret or polygon',()=>{
  const columns=sql.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE sql/)?.[1];
  assert.deepEqual(columns?.trim().split(',').map(x=>x.trim()),[
    'session_digest text','county_fips text','epoch text',
  ]);
  assert.doesNotMatch(columns,/account_active|mfa_verified|subject|geometry|coordinates/i);
  assert.doesNotMatch(sql,/SELECT\s+\*/i);
});

test('47 synthetic grant is accepted only with all four TRUE in one snapshot',()=>{
  for(const field of [
    'd.account_active IS TRUE','d.mfa_verified IS TRUE',
    'd.session_active IS TRUE','d.allow_discovery IS TRUE',
  ])assert.ok(sql.includes(field),field);
  assert.match(sql,/JOIN ldos_private_auth\.session_county_epochs/);
  assert.match(sql,/e.epoch>0/);
  assert.match(sql,/e.session_digest=d.session_digest/);
  assert.match(sql,/e.county_fips=d.county_fips/);
});

test('47 SQL takes exact digest/county; cannot invent a missing epoch or fall back',()=>{
  for(const text of [
    "p_session_digest ~ '^[0-9a-f]{64}$'",
    "p_county_fips ~ '^48[0-9]{3}$'",
    'd.session_digest=p_session_digest',
    'd.county_fips=p_county_fips::char(5)',
    'LIMIT 1',
  ])assert.ok(sql.includes(text),text);
  assert.doesNotMatch(sql,/COALESCE\s*\(\s*e\.epoch|DEFAULT\s+1/i);
});

test('47 successful fixed SQL read verifies role and returns frozen exact epoch',async()=>{
  const ctx=setup({rows:[row({epoch:'9007199254740993'})]});
  const result=await ctx.reader.readSessionCountyEpoch(args());
  assert.deepEqual(result,{
    sessionDigest:D,countyFips:COUNTY,epoch:'9007199254740993',
  });
  assert.equal(Object.isFrozen(result),true);
  assert.ok(ctx.events.indexOf('attest')<ctx.events.indexOf('rpc'));
  assert.ok(ctx.events.indexOf('rpc')<ctx.events.indexOf('COMMIT'));
  assert.deepEqual(ctx.releases,[false]);
});

test('47 empty, duplicate, wrong digest or county fail closed',async()=>{
  for(const rows of [
    [],[row(),row()],[row({session_digest:'b'.repeat(64)})],
    [row({county_fips:'48029'})],
  ]){
    const ctx=setup({rows});
    assert.equal(await ctx.reader.readSessionCountyEpoch(args()),null);
  }
});

test('47 extra, missing, malformed epoch SQL fields fail closed',async()=>{
  for(const rows of [
    [{...row(),grant:true}],
    [{session_digest:D,county_fips:COUNTY}],
    [row({epoch:null})],
    [row({epoch:4})],
    [row({epoch:'0'})],
    [row({epoch:'01'})],
    [row({epoch:'-4'})],
    [row({epoch:'9223372036854775808'})],
  ]){
    const ctx=setup({rows});
    assert.equal(await ctx.reader.readSessionCountyEpoch(args()),null);
  }
});

test('47 untrusted digest, county, signal or injected fields cannot reach SQL',async()=>{
  const ctx=setup();
  for(const request of [
    null,{},args({sessionDigest:'a'.repeat(63)}),
    args({sessionDigest:'A'.repeat(64)}),
    args({countyFips:'06037'}),args({countyFips:'48abc'}),
    args({signal:null}),args({signal:'not-signal'}),
    args({browserApproved:true}),
  ])assert.equal(await ctx.reader.readSessionCountyEpoch(request),null);
  assert.deepEqual(ctx.events,[]);
});

test('47 epoch comparison detects ABA, mismatched county and malformed fields',()=>{
  const old={sessionDigest:D,countyFips:COUNTY,epoch:'4'};
  assert.equal(isCanonicalPrivateSessionCountyEpoch(old),true);
  assert.equal(samePrivateSessionCountyEpoch(old,{...old}),true);
  for(const changed of [
    {...old,epoch:'6'}, {...old,sessionDigest:'b'.repeat(64)},
    {...old,countyFips:'48029'}, {...old,epoch:4},
    {...old,sourcePublished:true},
  ])assert.equal(samePrivateSessionCountyEpoch(old,changed),false);
});

test('47 role name rejects postgres, user login, authority, run or policy roles',()=>{
  for(const login of [
    'postgres','ldos_parcel_run_epoch_test','ldos_parcel_epoch_test',
    'ldos_parcel_geometry_test','ldos_parcel_session_epoch_BAD',
    'ldos_parcel_session_epoch_',
  ])assert.throws(()=>createPinnedPrivateSessionCountyEpochRpcExecutor({
    connect:async()=>null,expectedLogin:login,
  }),TypeError);
  assert.throws(()=>createPinnedPrivateSessionCountyEpochRpcExecutor({
    connect:async()=>null,expectedLogin:LOGIN,allowAdmin:true,
  }),TypeError);
});

test('47 fixed statement must be frozen, bounded and parameterized',async()=>{
  const ctx=setup();
  for(const statement of [
    null,{},
    {...frozen(),text:'SELECT session_digest FROM ldos_private_auth.session_county_decisions'},
    {...frozen(),values:[D,COUNTY]},
    Object.freeze({...frozen(),values:Object.freeze([D,'06037'])}),
    Object.freeze({...frozen(),values:Object.freeze([D,COUNTY,'extra'])}),
    Object.freeze({...frozen(),allowGrant:true}),
  ])await assert.rejects(ctx.db.queryFixedSessionCountyEpochRpc(statement));
  assert.deepEqual(ctx.events,[]);
});

test('47 SQL role proof denies raw synthetic account and epoch table access',()=>{
  const fragments=[
    'current_user=session_user AND current_user=$1::text',
    'r.rolcanlogin','r.rolbypassrls','r.rolinherit',
    'pg_catalog.pg_auth_members','has_schema_privilege',
    'no_private_table_access','no_private_sequence_access',
    'no_other_private_rpc',
    'ldos_private_auth.parcel_session_county_epoch_rpc(text,text)',
  ];
  for(const fragment of fragments)
    assert.ok(PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL.includes(fragment),fragment);
});

test('47 privilege drift rejects before fixed session RPC and discards client',async()=>{
  for(const role of [
    ...KEYS.map(key=>({...proof(),[key]:false})),
    {...proof(),extra:true},{...proof(),safe_login:'true'},null,
  ]){
    const ctx=setup({role});
    assert.equal(await ctx.reader.readSessionCountyEpoch(args()),null);
    assert.ok(!ctx.events.includes('rpc'));
    assert.ok(ctx.events.includes('ROLLBACK'));
    assert.deepEqual(ctx.releases,[true]);
  }
});

test('47 oversized or duplicate SQL records are discarded, not truncated',async()=>{
  for(const rows of [
    [row(),row()],
    [{...row(),secret:'z'.repeat(PRIVATE_SESSION_COUNTY_EPOCH_MAX_BYTES)}],
  ]){
    const ctx=setup({rows});
    await assert.rejects(ctx.db.queryFixedSessionCountyEpochRpc(frozen()),
      /unavailable/);
    assert.deepEqual(ctx.releases,[true]);
  }
});

test('47 abort before SQL and after SQL does not deliver an epoch',async()=>{
  const controller=new AbortController();controller.abort();
  const ctx=setup();
  assert.equal(await ctx.reader.readSessionCountyEpoch(args({
    signal:controller.signal,
  })),null);
  assert.deepEqual(ctx.events,[]);
  const active=new AbortController();
  const during=setup({abortAfterSql:()=>active.abort()});
  assert.equal(await during.reader.readSessionCountyEpoch(args({
    signal:active.signal,
  })),null);
  assert.deepEqual(during.releases,[true]);
});

test('47 exceptions remain generic and never expose account or SQL connection',async()=>{
  const ctx=setup({dbError:true});
  const err=await ctx.db.queryFixedSessionCountyEpochRpc(frozen())
    .then(()=>null,error=>error);
  assert.ok(err instanceof Error);
  assert.doesNotMatch(err.message,/DATABASE_SECRET_NOT_FOR_CLIENT/);
  const failed=setup({failBeforeSql:true});
  assert.equal(await failed.reader.readSessionCountyEpoch(args()),null);
  assert.deepEqual(failed.releases,[true]);
});

test('47 component cannot serve HTTP, create a DB pool or access cookies',()=>{
  for(const path of [
    '../../../server/providers/bdp-parcel-session-county-epoch.js',
    '../../../server/providers/bdp-parcel-session-county-epoch-db.js',
  ]){
    const content=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.doesNotMatch(content,/new Pool\(|createServer\(|\.listen\(|app\.get\(/);
    assert.doesNotMatch(content,/document\.cookie|localStorage|window\.location/);
  }
});

test('47 session epoch store stays explicitly synthetic, not an auth provider',()=>{
  const authSource=readFileSync(new URL(
    './sql/parcelSessionCountyEpochFoundation.sql',import.meta.url),'utf8');
  assert.match(authSource,/NOT the actual authentication or MFA service/);
  assert.match(sql,/NOT an MFA, login/);
  assert.match(sql,/NOT an MFA, login,/);
  assert.match(sql,/SYNTHETIC unmounted session\/county epoch/);
});
