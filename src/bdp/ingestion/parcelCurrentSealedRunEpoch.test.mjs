import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 PRIVATE_CURRENT_SEALED_RUN_EPOCH_SQL,
 createPrivateCurrentSealedRunEpochReader,
 isCanonicalPrivateCurrentRunEpoch,samePrivateCurrentRunEpoch,
} from '../../../server/providers/bdp-parcel-current-sealed-run-epoch.js';
import {
 PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL,
 PRIVATE_CURRENT_RUN_EPOCH_MAX_BYTES,
 createPinnedPrivateCurrentRunEpochRpcExecutor,
} from '../../../server/providers/bdp-parcel-current-sealed-run-epoch-db.js';

const sql=readFileSync(new URL(
 './sql/parcelCurrentSealedRunEpochRpcFoundation.sql',import.meta.url),'utf8');
const LOGIN='ldos_parcel_run_epoch_test';
const KEY=['exact_login','safe_login','no_role_memberships','schema_usage',
 'no_schema_create','no_index_table_access','no_index_sequence_access',
 'fixed_rpc_execute','no_other_index_rpc'];
const proof=()=>Object.fromEntries(KEY.map(k=>[k,true]));
const row=(extra={})=>({
 source_id:'step40c13-synthetic',county_fips:'48453',run_id:'42',epoch:'5',...extra,
});
const input=(extra={})=>({
 countyFips:'48453',sourceId:'step40c13-synthetic',runId:42,
 signal:new AbortController().signal,...extra,
});
function setup({rows=[row()],attest=proof(),onSql=null,error=null}={}){
 const calls=[],releases=[];
 const db=createPinnedPrivateCurrentRunEpochRpcExecutor({
   expectedLogin:LOGIN,
   async connect(){
     calls.push('connect');
     if(error)throw Error('DB_HOST_NAME_SECRET');
     return {
       async query(query){
         if(typeof query==='string'){calls.push(query);return {rows:[]};}
         if(query.text===PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL){
           calls.push('attest');
           assert.deepEqual(query.values,[LOGIN]);
           return {rows:[attest]};
         }
         if(query.text===PRIVATE_CURRENT_SEALED_RUN_EPOCH_SQL){
           calls.push('run-epoch-rpc');
           assert.deepEqual(query.values,['48453','step40c13-synthetic','42']);
           await onSql?.();
           return {rows};
         }
         throw Error('unapproved SQL');
       },
       release(e){releases.push(Boolean(e));calls.push(e?'discard':'release');},
     };
   },
 });
 const reader=createPrivateCurrentSealedRunEpochReader({
   queryFixedCurrentRunEpochRpc:db.queryFixedCurrentRunEpochRpc,
 });
 return {db,reader,calls,releases};
}
const statement=(signal=new AbortController().signal)=>Object.freeze({
 text:PRIVATE_CURRENT_SEALED_RUN_EPOCH_SQL,
 values:Object.freeze(['48453','step40c13-synthetic','42']),signal,
});

test('45 RPC is transactionally created with no PUBLIC or metadata grants',()=>{
 assert.match(sql,/^BEGIN;/m);assert.match(sql,/^COMMIT;/m);
 assert.match(sql,/SECURITY DEFINER/);
 assert.match(sql,/SET search_path = pg_catalog, pg_temp/);
 assert.match(sql,/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC/);
 assert.match(sql,/REVOKE ALL ON FUNCTION[\s\S]*?FROM ldos_parcel_rpc_client/);
 assert.doesNotMatch(sql,/^\s*GRANT\s/mi);
});
test('RPC returns exactly four current-run/epoch identifiers and no geometry',()=>{
 const table=sql.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE sql/)?.[1];
 assert.deepEqual(table?.trim().split(',').map(x=>x.trim()),[
   'source_id text','county_fips text','run_id text','epoch text',
 ]);
 assert.doesNotMatch(table,/geometry|price|owner|coordinates|session/i);
 assert.doesNotMatch(sql,/ST_AsGeoJSON|ST_Intersects|ST_Union/i);
});
test('latest FINISHED run selected BEFORE checking seal prevents stale fallback',()=>{
 const select=sql.indexOf('JOIN LATERAL (');
 const order=sql.indexOf('ORDER BY ir.finished_at DESC, ir.id DESC');
 const limit=sql.indexOf('LIMIT 1',order);
 const sealJoin=sql.indexOf('JOIN bdp_parcel_index.parcel_run_seals AS seal');
 assert.ok(select>=0&&order>select&&limit>order&&sealJoin>limit);
 assert.match(sql,/ir.finished_at IS NOT NULL/);
 assert.match(sql,/latest.id=p_run_id/);
});
test('RPC requires complete, untruncated, non-omitted and matching immutable seal',()=>{
 for(const clause of [
   'seal.ingest_run_id=latest.id','seal.source_id=sr.source_id',
   'seal.county_fips=sr.county_fips',
   'seal.source_version=latest.source_version',
   'seal.indexed_records=latest.received_records',
   'seal.sealed_at>=latest.finished_at',
   "latest.outcome='complete'",
   'latest.omitted_unidentified=0',
   'latest.source_reported_truncated=FALSE',
 ])assert.ok(sql.includes(clause),clause);
});
test('RPC binds exact county/source/run identity and a positive revision',()=>{
 for(const clause of [
  "p_county_fips ~ '^48[0-9]{3}$'",
  "p_source_id ~ '^[a-z][a-z0-9_-]{2,79}$'",
  'p_run_id>0','sr.county_fips=p_county_fips::char(5)',
  'sr.source_id=p_source_id','e.epoch>0',
  'e.source_id=sr.source_id','e.county_fips=sr.county_fips',
 ])assert.ok(sql.includes(clause),clause);
});
test('SQL epoch is NOT a GIS redistribution or session approval',()=>{
 assert.doesNotMatch(sql,/rights_state='approved'|review_state='approved'/);
 assert.match(sql,/NOT independent legal publishing/);
 assert.doesNotMatch(sql,/allow_geometry_redistribution=TRUE/);
});
test('strict pinned reader safely returns a frozen verified BIGINT epoch',async()=>{
 const ctx=setup({rows:[row({epoch:'9007199254740993'})]});
 assert.deepEqual(await ctx.reader.readSealedRunEpoch(input()),{
   countyFips:'48453',sourceId:'step40c13-synthetic',
   runId:42,epoch:'9007199254740993',
 });
 assert.ok(ctx.calls.includes('COMMIT'));
 assert.ok(ctx.calls.indexOf('attest')<ctx.calls.indexOf('run-epoch-rpc'));
 assert.deepEqual(ctx.releases,[false]);
});
test('unknown or duplicate run evidence must fail closed',async()=>{
 for(const rows of [[],[row(),row()]])
   assert.equal(await setup({rows}).reader.readSealedRunEpoch(input()),null);
});
test('stale run ID, wrong source/county, extra or missing SQL fields deny',async()=>{
 for(const bad of [
   row({run_id:'41'}),row({source_id:'some-other-source'}),
   row({county_fips:'48029'}),{...row(),internal_secret:'x'},
   {source_id:'step40c13-synthetic',county_fips:'48453',run_id:'42'},
 ])assert.equal(await setup({rows:[bad]}).reader.readSealedRunEpoch(input()),null);
});
test('invalid epoch formats and bigint overflow cannot become verified',async()=>{
 for(const epoch of [
   '0','-1','01','3.4',' 4','4 ','9223372036854775808',7,null,
 ])assert.equal(await setup({rows:[row({epoch})]}).reader.readSealedRunEpoch(input()),null);
});
test('invalid requested source, county, run ID, signal or extra fields block SQL',async()=>{
 const ctx=setup();
 for(const bad of [
   null,{},input({countyFips:'06037'}),
   input({sourceId:'OTHER'}),input({runId:0}),
   input({runId:Number.MAX_SAFE_INTEGER+1}),
   input({runId:'42'}),input({signal:'false'}),
   input({rightsState:'approved'}),
 ])assert.equal(await ctx.reader.readSealedRunEpoch(bad),null);
 assert.deepEqual(ctx.calls,[]);
});
test('comparison rejects run ABA, changed IDs, changed county and forged fields',()=>{
 const old={sourceId:'step40c13-synthetic',countyFips:'48453',
   runId:42,epoch:'2'};
 assert.equal(isCanonicalPrivateCurrentRunEpoch(old),true);
 assert.equal(samePrivateCurrentRunEpoch(old,{...old}),true);
 for(const changed of [
   {...old,epoch:'4'}, {...old,runId:43},
   {...old,countyFips:'48029'}, {...old,allowPublic:true},
   {...old,epoch:'9223372036854775808'},
 ])assert.equal(samePrivateCurrentRunEpoch(old,changed),false);
});
test('separate role cannot reuse source, publication, geometry or policy identity',()=>{
 for(const login of [
   'postgres','ldos_parcel_geometry_test','ldos_parcel_epoch_test',
   'ldos_parcel_publication_test','ldos_parcel_authority_test',
   'ldos_parcel_run_epoch_','ldos_parcel_run_epoch_BAD',
 ])assert.throws(()=>createPinnedPrivateCurrentRunEpochRpcExecutor({
   connect:async()=>null,expectedLogin:login,
 }),TypeError);
 assert.throws(()=>createPinnedPrivateCurrentRunEpochRpcExecutor({
   connect:async()=>null,expectedLogin:LOGIN,admin:true,
 }),TypeError);
});
test('role proof insists exact login and no alternative schema RPC access',()=>{
 for(const key of [
   'current_user=session_user AND current_user=$1::text',
   'r.rolcanlogin','r.rolbypassrls','r.rolinherit',
   'pg_catalog.pg_auth_members','has_table_privilege',
   'has_sequence_privilege','no_other_index_rpc',
   'parcel_current_sealed_run_epoch_rpc(text,text,bigint)',
 ])assert.ok(PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL.includes(key),key);
});
test('privilege drift is rejected before any fixed read and discards SQL client',async()=>{
 for(const invalid of [
   ...KEY.map(key=>({...proof(),[key]:false})),
   {...proof(),extra:true},{...proof(),safe_login:'true'},null,
 ]){
   const ctx=setup({attest:invalid});
   assert.equal(await ctx.reader.readSealedRunEpoch(input()),null);
   assert.ok(!ctx.calls.includes('run-epoch-rpc'));
   assert.ok(ctx.calls.includes('ROLLBACK'));
   assert.deepEqual(ctx.releases,[true]);
 }
});
test('arbitrary SQL, mutable values, forged principal and invalid run cannot connect',async()=>{
 const ctx=setup();
 for(const bad of [
   null,{},
   Object.freeze({...statement(),text:'SELECT * FROM bdp_parcel_index.ingest_runs'}),
   Object.freeze({...statement(),values:Object.freeze(['48453','step40c13-synthetic','0'])}),
   Object.freeze({...statement(),values:Object.freeze(['48453','step40c13-synthetic','9007199254740993'])}),
   Object.freeze({...statement(),values:['48453','step40c13-synthetic','42']}),
   {...statement(),rightsApproved:true},
 ])await assert.rejects(ctx.db.queryFixedCurrentRunEpochRpc(bad));
 assert.deepEqual(ctx.calls,[]);
});
test('unexpected oversized SQL responses are discarded and not disclosed',async()=>{
 for(const rows of [
   [row(),row()],
   [{...row(),extra:'unexpected'}],
   [row({epoch:'9'.repeat(PRIVATE_CURRENT_RUN_EPOCH_MAX_BYTES)})],
 ]){
   const ctx=setup({rows});
   await assert.rejects(ctx.db.queryFixedCurrentRunEpochRpc(statement()),
     /unavailable/);
   assert.ok(ctx.calls.includes('ROLLBACK'));
   assert.deepEqual(ctx.releases,[true]);
 }
});
test('abort before or during SQL fails closed without returning run state',async()=>{
 const a=new AbortController();a.abort();
 const first=setup();
 assert.equal(await first.reader.readSealedRunEpoch(input({signal:a.signal})),null);
 assert.deepEqual(first.calls,[]);
 const b=new AbortController();
 const second=setup({onSql:async()=>b.abort()});
 assert.equal(await second.reader.readSealedRunEpoch(input({signal:b.signal})),null);
 assert.deepEqual(second.releases,[true]);
});
test('database errors remain generic and no server or DB pool is created',async()=>{
 const ctx=setup({error:true});
 const thrown=await ctx.db.queryFixedCurrentRunEpochRpc(statement())
   .then(()=>null,e=>e);
 assert.ok(thrown instanceof Error);
 assert.doesNotMatch(thrown.message,/DB_HOST_NAME_SECRET/);
 for(const file of [
   '../../../server/providers/bdp-parcel-current-sealed-run-epoch.js',
   '../../../server/providers/bdp-parcel-current-sealed-run-epoch-db.js',
 ]){
   const src=readFileSync(new URL(file,import.meta.url),'utf8');
   assert.doesNotMatch(src,/new Pool\(|createServer\(|\.listen\(|app\.get\(/);
 }
});
