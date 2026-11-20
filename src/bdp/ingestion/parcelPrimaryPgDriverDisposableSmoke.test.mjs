import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createUnroutedPrimaryAccountReader,PRIMARY_ACCOUNT_SQL}
  from '../../../server/providers/bdp-primary-account-reader.js';
import {
  PRIMARY_PG_SMOKE_PASS,PRIMARY_PG_ATTESTATION_SQL,
  requirePrimaryPgDisposableOnly,parsePrimaryPgLoopbackPort,
  createRestrictedPrimaryPgQuery,runPrimaryPgDriverDisposableSmoke,
} from '../../../scripts/bdp/app-primary-pg-driver-disposable-smoke.mjs';

const USER='ldos_auth_account_reader';
const SUBJECT='11111111-1111-4111-8111-111111111111';
const PASS='a'.repeat(64);
const settings=()=>({host:'127.0.0.1',port:54339,database:'postgres',
  user:USER,password:PASS});
const proof=()=>Object.fromEntries([
  'correct_user','correct_session','current_primary','least_privilege',
  'schema_usage','no_schema_create','account_select',
  'no_account_mutations','no_sessions','no_county_grants',
].map(x=>[x,true]));
const row=()=>({command:'SELECT',rowCount:1,
  fields:['subject','account_state','revision'].map(name=>({name})),
  rows:[[SUBJECT,'active','2']]});
function mock({authorization=proof(),response=row(),onQuery,error}={}){
  const seen={configs:[],queries:[],acquired:0,released:0,closed:0,listeners:[]};
  class Pool {
    constructor(config){seen.configs.push(config)}
    on(name){seen.listeners.push(name)}
    async connect(){
      seen.acquired++;
      if(error==='connect')throw Error('sensitive connection info');
      return {
        async query(command){
          seen.queries.push(command);
          if(onQuery)return onQuery(command);
          if(error==='query')throw Error('sensitive SQL info');
          return typeof command==='string'?{rows:[authorization]}:response;
        },
        release(){seen.released++},
      };
    }
    async end(){seen.closed++}
  }
  return {Pool,seen};
}
const input=()=>({subject:SUBJECT,signal:new AbortController().signal});

test('62C exact disposable-only flag is required',()=>{
  assert.equal(requirePrimaryPgDisposableOnly(['--disposable-only']),true);
  for(const invalid of [[],null,undefined,['--prod'],['--dev-only'],
    ['--disposable-only','--force'],['--disposable-only','--disposable-only']])
    assert.throws(()=>requirePrimaryPgDisposableOnly(invalid),/Refusing primary/);
});
test('62C invalid opt-in rejects before importing pg or invoking Docker',async()=>{
  let loads=0;
  await assert.rejects(runPrimaryPgDriverDisposableSmoke(['--prod'],{
    loadPg:async()=>{loads++;return {Pool:mock().Pool}},
  }),/Refusing primary/);
  assert.equal(loads,0);
});
test('62C a missing actual pg driver fails before creating Docker container',async()=>{
  await assert.rejects(runPrimaryPgDriverDisposableSmoke(['--disposable-only'],{
    loadPg:async()=>{throw Error('not installed')},
  }),/driver is not installed/);
});
test('62C malformed or non-loopback Docker port never becomes a connection',()=>{
  for(const value of [null,undefined,'0.0.0.0:5432','localhost:5432',
    '127.0.0.1:0','127.0.0.1:65536','127.0.0.1:1234\nother','[::1]:5432'])
    assert.equal(parsePrimaryPgLoopbackPort(value),null);
  assert.equal(parsePrimaryPgLoopbackPort('127.0.0.1:54339'),'54339'*1);
});
test('62C refuses database owner, wrong user, non-local host and extra config',()=>{
  for(const config of [
    {},{...settings(),user:'postgres'},{...settings(),user:'bdp'},
    {...settings(),host:'db.example.com'},
    {...settings(),port:'54339'},{...settings(),password:'weak'},
    {...settings(),database:'bdp'},{...settings(),ssl:false},
    {...settings(),connectionString:'postgresql://bad'},
  ])assert.throws(()=>createRestrictedPrimaryPgQuery({
    Pool:mock().Pool,settings:config,
  }),TypeError);
});
test('62C pooled driver is local, SCRAM-password backed, small and bounded',async()=>{
  const {Pool,seen}=mock();
  const db=createRestrictedPrimaryPgQuery({Pool,settings:settings()});
  assert.equal(seen.configs.length,1);
  assert.equal(seen.acquired,0);
  const c=seen.configs[0];
  assert.equal(c.host,'127.0.0.1');
  assert.equal(c.user,USER);
  assert.equal(c.ssl,false);
  assert.equal(c.max,2);
  assert.equal(c.min,0);
  assert.ok(c.statement_timeout<=2000);
  assert.equal(c.application_name,'ldos-app-auth-disposable-only');
  assert.deepEqual(seen.listeners,['error']);
  await db.close();
});
test('62C exact real-client query is preceded by restricted role attestation',async()=>{
  const {Pool,seen}=mock();
  const db=createRestrictedPrimaryPgQuery({Pool,settings:settings()});
  const reader=createUnroutedPrimaryAccountReader({query:db.query});
  const result=await reader(input());
  assert.equal(result?.subject,SUBJECT);
  assert.equal(result?.revision,'2');
  assert.deepEqual(seen.queries.map(q=>typeof q==='string'?'attestation':'account'),
    ['attestation','account']);
  assert.equal(seen.queries[0],PRIMARY_PG_ATTESTATION_SQL);
  assert.equal(seen.queries[1].text,PRIMARY_ACCOUNT_SQL);
  assert.equal(seen.released,1);
  await db.close();
});
test('62C no arbitrary SQL can run through the restricted query adapter',async()=>{
  const {Pool,seen}=mock();
  const db=createRestrictedPrimaryPgQuery({Pool,settings:settings()});
  await assert.rejects(db.query({
    text:'SELECT * FROM ldos_app_auth.sessions',
    values:[SUBJECT],rowMode:'array',signal:new AbortController().signal,
  }),/unavailable/);
  assert.equal(seen.acquired,0);
  await db.close();
});
test('62C missing SQL principal attestation fails closed and releases client',async()=>{
  const {Pool,seen}=mock({authorization:null});
  const db=createRestrictedPrimaryPgQuery({Pool,settings:settings()});
  assert.equal(await createUnroutedPrimaryAccountReader({query:db.query})(input()),null);
  assert.equal(seen.acquired,1);
  assert.equal(seen.released,1);
  assert.equal(seen.queries.length,1);
  await db.close();
});
test('62C every individual role or DB-primary privilege is required',async()=>{
  for(const key of Object.keys(proof())){
    const {Pool,seen}=mock({authorization:{...proof(),[key]:false}});
    const db=createRestrictedPrimaryPgQuery({Pool,settings:settings()});
    assert.equal(await createUnroutedPrimaryAccountReader({query:db.query})(input()),null,key);
    assert.equal(seen.queries.length,1,key);
    await db.close();
  }
});
test('62C attestation or SQL error never leaks SQL text, passwords or roles',async()=>{
  const {Pool,seen}=mock({error:'query'});
  const db=createRestrictedPrimaryPgQuery({Pool,settings:settings()});
  await assert.rejects(db.query({
    text:PRIMARY_ACCOUNT_SQL,values:[SUBJECT],rowMode:'array',
    signal:new AbortController().signal,
  }),error=>{
    assert.equal(error.message,'Primary PostgreSQL account read unavailable');
    assert.equal(seen.released,1);
    return true;
  });
  await db.close();
});
test('62C malformed input or cancelled signal cannot acquire a SQL client',async()=>{
  const {Pool,seen}=mock();
  const db=createRestrictedPrimaryPgQuery({Pool,settings:settings()});
  const abort=new AbortController();abort.abort();
  await assert.rejects(db.query({text:PRIMARY_ACCOUNT_SQL,values:[SUBJECT],
    rowMode:'array',signal:abort.signal}),/unavailable/);
  await assert.rejects(db.query({text:PRIMARY_ACCOUNT_SQL,values:[],
    rowMode:'array',signal:new AbortController().signal}),/unavailable/);
  assert.equal(seen.acquired,0);
  await db.close();
});
test('62C cancellation during attestation prevents a candidate lookup',async()=>{
  const controller=new AbortController();
  const {Pool,seen}=mock({onQuery:async command=>{
    if(typeof command==='string'){
      controller.abort();
      return {rows:[proof()]};
    }
    return row();
  }});
  const db=createRestrictedPrimaryPgQuery({Pool,settings:settings()});
  const reader=createUnroutedPrimaryAccountReader({query:db.query});
  assert.equal(await reader({subject:SUBJECT,signal:controller.signal}),null);
  assert.equal(seen.queries.length,1);
  await db.close();
});
test('62C double close is idempotent and prevents further pooled SQL',async()=>{
  const {Pool,seen}=mock();
  const db=createRestrictedPrimaryPgQuery({Pool,settings:settings()});
  await db.close();await db.close();
  assert.equal(seen.closed,1);
  await assert.rejects(db.query({text:PRIMARY_ACCOUNT_SQL,values:[SUBJECT],
    rowMode:'array',signal:new AbortController().signal}),/unavailable/);
  assert.equal(seen.acquired,0);
});
test('62C primary role proof never accepts broad DML on sessions or county grants',()=>{
  for(const key of ['correct_user','correct_session','current_primary',
    'least_privilege','no_account_mutations','no_sessions','no_county_grants'])
    assert.ok(PRIMARY_PG_ATTESTATION_SQL.includes(key));
  assert.ok(PRIMARY_PG_ATTESTATION_SQL.includes('pg_catalog.pg_is_in_recovery()'));
  assert.ok(PRIMARY_PG_ATTESTATION_SQL.includes('has_table_privilege'));
});
test('62C synthetic fixture is fresh, separately named, and only locally published',()=>{
  const script=readFileSync(new URL(
    '../../../scripts/bdp/app-primary-pg-driver-disposable-smoke.mjs',
    import.meta.url,
  ),'utf8');
  assert.ok(script.includes("'ldos-auth-primary-driver-'+randomBytes(6)"));
  assert.ok(script.includes("'--pull=never'"));
  assert.ok(script.includes("'127.0.0.1::5432'"));
  assert.ok(script.includes("'--name',name"));
  assert.ok(script.includes("'--volumes',name"));
  assert.ok(!script.includes('bdp-postgis'));
  assert.ok(!script.includes('LDOS_SUPABASE_DEV_'));
});
test('62C installs only the existing draft SQL into the synthetic database',()=>{
  const script=readFileSync(new URL(
    '../../../scripts/bdp/app-primary-pg-driver-disposable-smoke.mjs',
    import.meta.url,
  ),'utf8');
  assert.ok(script.includes('landOsAccountAuthorityFoundation.sql'));
  assert.ok(script.includes('GRANT SELECT ON ldos_app_auth.accounts'));
  assert.ok(!script.includes('GRANT SELECT ON ldos_app_auth.sessions'));
  assert.ok(!script.includes('GRANT SELECT ON ldos_app_auth.county_grants'));
  assert.ok(!script.includes('ALTER DEFAULT PRIVILEGES'));
});
test('62C role denial, suspension, revision ABA and revoked account are tested',()=>{
  const script=readFileSync(new URL(
    '../../../scripts/bdp/app-primary-pg-driver-disposable-smoke.mjs',
    import.meta.url,
  ),'utf8');
  for(const part of [
    "account_state='suspended'", "account_state='active'",
    'SELECT * FROM ldos_app_auth.sessions;',
    'SELECT * FROM ldos_app_auth.county_grants;',
    "SET ROLE postgres;",
    "(await get())?.revision,'4'",
  ])assert.ok(script.includes(part),part);
});
test('62C PASS is scoped to disposable real PostgreSQL, never production permissions',()=>{
  assert.match(PRIMARY_PG_SMOKE_PASS,/^PASS: disposable real pg driver/);
  assert.match(PRIMARY_PG_SMOKE_PASS,/no sessions, no counties, no GIS/);
  const script=readFileSync(new URL(
    '../../../scripts/bdp/app-primary-pg-driver-disposable-smoke.mjs',
    import.meta.url,
  ),'utf8');
  assert.ok(script.includes('no live Supabase or parcel DB changed'));
  assert.doesNotMatch(script,/process\.stdout\.write\(rootPassword|console\.log\(readerPassword|process\.env\.PGPASSWORD/);
});
