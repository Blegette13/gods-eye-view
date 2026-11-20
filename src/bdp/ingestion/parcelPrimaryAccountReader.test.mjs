import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PRIMARY_ACCOUNT_SQL,createUnroutedPrimaryAccountReader,
} from '../../../server/providers/bdp-primary-account-reader.js';
const SUBJECT='123e4567-e89b-42d3-a456-426614174000';
const OTHER='22222222-2222-4222-8222-222222222222';
const fields=['subject','account_state','revision'].map(name=>({name}));
const rows=([subject,state,revision]=[SUBJECT,'active','9'])=>({
  command:'SELECT',fields,rows:[[subject,state,revision]],rowCount:1,
});
function fixture(result) {
  if(arguments.length===0)result=rows();
  const calls=[];
  const query=async args=>{calls.push(args);return result;};
  return {calls,reader:createUnroutedPrimaryAccountReader({query})};
}
const args=()=>({subject:SUBJECT,signal:new AbortController().signal});
test('62B reader factory requires an injected trusted private query adapter',()=>{
  for(const x of [undefined,{}, {query:null},{query:0},{query:[]}])
    assert.throws(()=>createUnroutedPrimaryAccountReader(x),TypeError);
});
test('62B fixed SQL is parameterized and never incorporates caller account text',()=>{
  assert.match(PRIMARY_ACCOUNT_SQL,/a\.subject = \$1::uuid/);
  assert.match(PRIMARY_ACCOUNT_SQL,/FROM ldos_app_auth\.accounts AS a/);
  assert.doesNotMatch(PRIMARY_ACCOUNT_SQL,/\$\{\w+\}|\?\s*\+|\+\s*input/);
});
test('62B SQL requires the exact non-admin account-reader PostgreSQL principal',()=>{
  assert.ok(PRIMARY_ACCOUNT_SQL.includes("current_user = 'ldos_auth_account_reader'"));
  assert.match(PRIMARY_ACCOUNT_SQL,/NOT pg_is_in_recovery\(\)/);
  assert.doesNotMatch(PRIMARY_ACCOUNT_SQL,/SET ROLE|SECURITY DEFINER|service_role/i);
});
test('62B SQL reads ONLY 3 account fields, no session, county or GIS',()=>{
  assert.match(PRIMARY_ACCOUNT_SQL,/a\.subject::text AS subject/);
  assert.match(PRIMARY_ACCOUNT_SQL,/a\.account_state::text AS account_state/);
  assert.match(PRIMARY_ACCOUNT_SQL,/a\.revision::text AS revision/);
  assert.doesNotMatch(PRIMARY_ACCOUNT_SQL,/JOIN|sessions|county_grants|geom|ST_/i);
});
test('62B invalid inputs fail closed without opening any SQL calls',async()=>{
  const {reader,calls}=fixture();
  for(const arg of [null,undefined,{},[],{subject:SUBJECT},
    {subject:SUBJECT,signal:'not signal'},
    {subject:'invalid',signal:new AbortController().signal},
    {subject:SUBJECT,signal:new AbortController().signal,role:'admin'},
    {subject:SUBJECT,signal:new AbortController().signal,county:'48453'},
  ])assert.equal(await reader(arg),null);
  assert.equal(calls.length,0);
});
test('62B cancelled query request fails before running SQL',async()=>{
  const {reader,calls}=fixture();const controller=new AbortController();controller.abort();
  assert.equal(await reader({subject:SUBJECT,signal:controller.signal}),null);
  assert.equal(calls.length,0);
});
test('62B query adapter receives fixed SQL, one UUID parameter and array rows',async()=>{
  const {reader,calls}=fixture();const input=args();
  assert.ok(await reader(input));
  assert.equal(calls.length,1);
  assert.equal(calls[0].text,PRIMARY_ACCOUNT_SQL);
  assert.deepEqual(calls[0].values,[SUBJECT]);
  assert.equal(calls[0].rowMode,'array');
  assert.equal(calls[0].signal,input.signal);
});
test('62B accepted active primary row returns only canonical frozen evidence',async()=>{
  const {reader}=fixture();const value=await reader(args());
  assert.deepEqual(value,{subject:SUBJECT,account_state:'active',revision:'9',
    source:'app-owned-primary',current:true});
  assert.equal(Object.isFrozen(value),true);
  for(const key of ['email','password','mfaConfirmed','accountAuthorized','countyGrants',
    'sessionIssued','releaseAuthorized'])assert.equal(Object.hasOwn(value,key),false);
});
test('62B empty lookup fails closed, never inventing an account',async()=>{
  const {reader}=fixture({command:'SELECT',fields,rows:[],rowCount:0});
  assert.equal(await reader(args()),null);
});
test('62B missing or extra results fail closed even if a row looks active',async()=>{
  const a=rows();
  for(const r of [{...a,rowCount:0},{...a,rowCount:2},{...a,rows:[...a.rows,...a.rows],rowCount:2}]){
    assert.equal(await fixture(r).reader(args()),null);
  }
});
test('62B missing, reordered or extra columns fail closed',async()=>{
  const a=rows();
  for(const f of [[],fields.slice(0,2),[fields[1],fields[0],fields[2]],
    [...fields,{name:'email'}]]){
    assert.equal(await fixture({...a,fields:f}).reader(args()),null);
  }
});
test('62B non-SELECT command or unstructured results fail closed',async()=>{
  const a=rows();
  for(const r of [undefined,null,{},[],{...a,command:'UPDATE'},
    {...a,rows:[{subject:SUBJECT,account_state:'active',revision:'9'}]},
    {...a,rows:[[SUBJECT,'active']]}]){
    assert.equal(await fixture(r).reader(args()),null);
  }
});
test('62B a different account UUID is never linked to provider subject',async()=>{
  assert.equal(await fixture(rows([OTHER,'active','9'])).reader(args()),null);
});
test('62B suspended and closed current accounts are rejected',async()=>{
  for(const state of ['suspended','closed','deleted','ACTIVE','']){
    assert.equal(await fixture(rows([SUBJECT,state,'9'])).reader(args()),null);
  }
});
test('62B unknown revision, zero, numeric, padded and negative fail closed',async()=>{
  for(const version of [null,undefined,0,9,'0','-1','01','9.0',' 9',
    '9223372036854775808','99999999999999999999999999999','']){
    assert.equal(await fixture(rows([SUBJECT,'active',version])).reader(args()),null);
  }
});
test('62B valid PostgreSQL BIGINT revision preserves exact decimal identity',async()=>{
  assert.equal((await fixture(rows([SUBJECT,'active','9223372036854775807']))
    .reader(args())).revision,'9223372036854775807');
});
test('62B errors from database driver never escape or authorize',async()=>{
  const reader=createUnroutedPrimaryAccountReader({
    query:async()=>{throw Error('PRIVATE_CONNECTION_SECRET')},
  });
  assert.equal(await reader(args()),null);
});
test('62B cancelled SQL request cannot generate a successful candidate',async()=>{
  const controller=new AbortController();
  const reader=createUnroutedPrimaryAccountReader({query:async()=>{
    controller.abort();return rows();
  }});
  assert.equal(await reader({subject:SUBJECT,signal:controller.signal}),null);
});
test('62B schema source has no HTTP, writing, user provisioning or private GIS connection',()=>{
  const code=readFileSync(new URL(
    '../../../server/providers/bdp-primary-account-reader.js',import.meta.url,
  ),'utf8');
  assert.match(code,/UNROUTED app-owned PostgreSQL PRIMARY account reader/);
  assert.doesNotMatch(code,/createServer\(|new Pool\(|INSERT INTO|UPDATE ldos_app_auth|DELETE FROM|ST_AsGeoJSON/);
  assert.doesNotMatch(code,/fetch\(|sb_secret_|auth\.users|pgcrypto|CREATE ROLE/i);
});
test('62B no source role, county input, or app approval is accepted from request',async()=>{
  const {reader,calls}=fixture();
  for(const [name,value] of [['role','superuser'],['county','48453'],['releaseAuthorized',true]]){
    assert.equal(await reader({...args(),[name]:value}),null);
  }
  assert.equal(calls.length,0);
});
