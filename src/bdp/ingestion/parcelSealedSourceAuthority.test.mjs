import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRIVATE_SEALED_SOURCE_AUTHORITY_SQL,
  createPrivateSealedSourceAuthorityReader,
} from '../../../server/providers/bdp-parcel-sealed-source-authority.js';

const sql = readFileSync(new URL('./sql/parcelSealedSourceAuthorityRpcFoundation.sql',
  import.meta.url), 'utf8');
const now = 1_000_000;
const row = (overrides={}) => ({
  source_id:'travis-cad',county_fips:'48453',rights_state:'approved',
  approved_caching_until_ms:now+300_000,run_id:'42',
  source_version:'synthetic-v1',sealed_at_ms:now-5_000,
  indexed_records:'3',sealed_run:true,...overrides,
});
const scope = (overrides={}) => ({
  countyFips:'48453',signal:new AbortController().signal,...overrides,
});
function setup({response={rows:[row()]},clock=()=>now,query=null}={}) {
  const calls=[];
  const reader=createPrivateSealedSourceAuthorityReader({
    now:clock,
    queryFixedAuthorityRpc:async(statement)=>{
      calls.push(statement);
      return query ? query(statement) : response;
    },
  });
  return {reader,calls};
}

test('40C34 draft has transactional CREATE, default revocation and zero grants',()=>{
  assert.match(sql,/^BEGIN;/m);
  assert.match(sql,/^COMMIT;/m);
  assert.match(sql,/DBA-REVIEW-ONLY/);
  assert.match(sql,/CREATE FUNCTION bdp_parcel_index\.parcel_sealed_source_authority_rpc\(/);
  assert.match(sql,/LANGUAGE sql VOLATILE SECURITY DEFINER/);
  assert.match(sql,/SET search_path = pg_catalog, pg_temp/);
  assert.match(sql,/REVOKE ALL ON FUNCTION bdp_parcel_index\.parcel_sealed_source_authority_rpc\(\s*text\s*\) FROM PUBLIC;/);
  assert.match(sql,/REVOKE ALL ON FUNCTION bdp_parcel_index\.parcel_sealed_source_authority_rpc\(\s*text\s*\) FROM ldos_parcel_rpc_client;/);
  assert.doesNotMatch(sql,/^\s*GRANT\s/mi);
  assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION|CREATE ROLE|CREATE USER|COPY |CREATE SERVER/i);
});

test('authority comes from the latest finished run, never silent older-run fallback',()=>{
  assert.match(sql,/JOIN LATERAL/);
  assert.match(sql,/finished\.finished_at IS NOT NULL/);
  assert.match(sql,/ORDER BY finished\.finished_at DESC, finished\.id DESC/);
  assert.match(sql,/LIMIT 1/);
  assert.match(sql,/ir\.outcome = 'complete'/);
  assert.doesNotMatch(sql,/ir\.outcome IN \('complete', 'partial'\)/);
});

test('SQL enforces immutable source/county/version/count and complete-run seal',()=>{
  for(const text of [
    'seal.ingest_run_id = ir.id',
    'seal.source_id = sr.source_id',
    'seal.county_fips = sr.county_fips',
    'seal.source_version = ir.source_version',
    'seal.indexed_records = ir.received_records',
    'seal.sealed_at >= ir.finished_at',
    "ir.outcome = 'complete'",
    'ir.received_records IS NOT NULL',
    'ir.omitted_unidentified = 0',
    'ir.source_reported_truncated = FALSE',
  ]) assert.ok(sql.includes(text),text);
});

test('SQL checks current CACHING rights, not presumed publication approval',()=>{
  for(const text of [
    "sr.rights_state = 'approved'",
    'sr.rights_review_reference IS NOT NULL',
    'sr.rights_reviewed_at IS NOT NULL',
    'sr.approved_caching_until > pg_catalog.clock_timestamp()',
    "p_county_fips ~ '^48[0-9]{3}$'",
    'sr.county_fips = p_county_fips::char(5)',
    'ORDER BY sr.source_id COLLATE "C" ASC',
    'LIMIT 2',
  ]) assert.ok(sql.includes(text),text);
  assert.doesNotMatch(sql,/JOIN bdp_parcel_index\.geometry_publication_reviews/);
  assert.match(sql,/independently read publication approval/);
});

test('SQL returns only nine source/immutable-run fields, no geometry/owner/policy mutation',()=>{
  const fields=sql.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE sql/)?.[1];
  assert.ok(fields);
  for(const expected of [
    'source_id text','county_fips text','rights_state text',
    'approved_caching_until_ms double precision','run_id bigint',
    'source_version text','sealed_at_ms double precision',
    'indexed_records bigint','sealed_run boolean',
  ]) assert.ok(fields.includes(expected),expected);
  assert.doesNotMatch(fields,/geometry|owner|appraisal|price|sale|title|user/i);
  assert.doesNotMatch(sql,/^\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP|GRANT)\s/mi);
});

test('reader creates one immutable fixed SQL statement and normalized proof',async()=>{
  const {reader,calls}=setup();
  const result=await reader.readSealedSource(scope());
  assert.equal(calls.length,1);
  assert.equal(calls[0].text,PRIVATE_SEALED_SOURCE_AUTHORITY_SQL);
  assert.deepEqual(calls[0].values,['48453']);
  assert.ok(Object.isFrozen(calls[0]));
  assert.ok(Object.isFrozen(calls[0].values));
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.deepEqual(result,{
    sourceId:'travis-cad',countyFips:'48453',rightsState:'approved',
    approvedCachingUntilMs:now+300_000,runId:42,
    sourceVersion:'synthetic-v1',sealedAtMs:now-5_000,
    indexedRecords:3,sealedRun:true,
  });
  assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify(result).includes('coordinates'),false);
});

test('no source or two approved sources are denied, never first-source wins',async()=>{
  for(const rows of [[],[row(),row({source_id:'second-cad'})]]) {
    const {reader}=setup({response:{rows}});
    assert.equal(await reader.readSealedSource(scope()),null);
  }
});

test('malformed query output and additional fields cannot promote authority',async()=>{
  for(const response of [
    null, {}, {rows:null}, {rows:'row'}, {rows:[null]},
    {rows:[{...row(),owner_name:'private'}]},
    {rows:[{...row(),sealed_run:'true'}]},
    {rows:[{...row(),unapproved:true}]},
  ]) {
    const {reader}=setup({response});
    assert.equal(await reader.readSealedSource(scope()),null);
  }
});

test('rejects stale cache, unsealed/future run, wrong source/county, bad version',async()=>{
  for(const invalid of [
    {rights_state:'revoked'},{county_fips:'48029'},
    {source_id:'BAD ID'},{approved_caching_until_ms:now},
    {sealed_run:false},{sealed_at_ms:now+1},
    {source_version:'   '},{source_version:'x'.repeat(151)},
    {indexed_records:'-1'},
  ]) {
    const {reader}=setup({response:{rows:[row(invalid)]}});
    assert.equal(await reader.readSealedSource(scope()),null);
  }
});

test('PostgreSQL bigint is parsed precisely: unsafe or malformed integers DENY',async()=>{
  for(const invalid of [
    {run_id:'0001'},{run_id:'0'}, {run_id:42},
    {run_id:'9223372036854775807'},
    {run_id:'9223372036854775808'}, {run_id:'1e3'},
    {indexed_records:'9223372036854775807'},
    {indexed_records:3}, {indexed_records:'01'},
  ]) {
    const {reader}=setup({response:{rows:[row(invalid)]}});
    assert.equal(await reader.readSealedSource(scope()),null);
  }
  const {reader}=setup({response:{rows:[row({indexed_records:'0'})]}});
  assert.equal((await reader.readSealedSource(scope()))?.indexedRecords,0);
});

test('only an exact Texas county and AbortSignal may query authority',async()=>{
  const {reader,calls}=setup();
  for(const input of [
    null,{},scope({countyFips:'06037'}),scope({countyFips:'48abc'}),
    scope({countyFips:'48453; SELECT 1'}),scope({signal:'not signal'}),
    scope({role:'admin'}),scope({sourceId:'travis-cad'}),
  ]) assert.equal(await reader.readSealedSource(input),null);
  assert.equal(calls.length,0);
});

test('cancellation before/after SQL lookup never becomes source authority',async()=>{
  const controller=new AbortController();controller.abort();
  const {reader,calls}=setup();
  assert.equal(await reader.readSealedSource(scope({signal:controller.signal})),null);
  assert.equal(calls.length,0);
  const later=new AbortController();
  const after=setup({query:async()=>{later.abort();return {rows:[row()]};}});
  assert.equal(await after.reader.readSealedSource(scope({signal:later.signal})),null);
  assert.equal(after.calls.length,1);
});

test('query exceptions, bad clock and missing collaborator fail CLOSED',async()=>{
  assert.throws(()=>createPrivateSealedSourceAuthorityReader(),TypeError);
  const {reader}=setup({query:async()=>{throw new Error('PRIVATE DB');}});
  assert.equal(await reader.readSealedSource(scope()),null);
  const invalidClock=setup({clock:()=>Number.NaN});
  assert.equal(await invalidClock.reader.readSealedSource(scope()),null);
});

test('source adapter is private and cannot create a pool, route, or GIS clearance',()=>{
  const code=readFileSync(new URL('../../../server/providers/bdp-parcel-sealed-source-authority.js',
    import.meta.url),'utf8');
  assert.doesNotMatch(code,/createServer\(|\.listen\(|new Pool\(|fetch\(|document\.cookie/);
  assert.match(code,/NOT geometry-redistribution rights/);
  assert.doesNotMatch(PRIVATE_SEALED_SOURCE_AUTHORITY_SQL,/\b(?:GRANT|INSERT|UPDATE|DELETE|EXECUTE)\b/i);
});
