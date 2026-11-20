import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRIMARY_ACCOUNT_SQL} from '../../../server/providers/bdp-primary-account-reader.js';
import {
  AUTH_DEV_GATEWAY_LOGIN,AUTH_DEV_READER_ROLE,AUTH_DEV_ROLE_SWITCH_ATTEST_SQL,
  AUTH_DEV_MAX_POOL,validAuthDevSettings,validAuthDevRoleSwitchProof,
  createUnroutedAuthDevRoleSwitchPg,
} from '../../../server/providers/bdp-auth-dev-role-switch-pg.js';
const ID='11111111-1111-4111-8111-111111111111';
const SETTINGS={host:'127.0.0.1',port:54338,database:'ldos_auth_dev',user:AUTH_DEV_GATEWAY_LOGIN,password:'a'.repeat(64)};
const fields=['subject','account_state','revision'].map(name=>({name}));
const account={command:'SELECT',fields,rowCount:1,rows:[[ID,'active','7']]};
const proofNames=[
 'correct_db','primary_db','correct_login','effective_reader','read_only_tx',
 'safe_login','safe_reader','exact_membership','schema_usage','no_schema_create',
 'subject_read','state_read','revision_read','no_created_at','no_account_writes',
 'no_session_rights','no_county_rights','no_guard_execution','no_candidate_rpc',
];
const proof=()=>({command:'SELECT',rowCount:1,rows:[Object.fromEntries(proofNames.map(x=>[x,true]))]});
function fixture({proofValue=proof(),result=account,failAt=null,act=null}={}){
  const calls=[],releases=[],configs=[],events=[],ends=[];
  let connectCount=0;
  const client={
    async query(x){
      const name=typeof x==='string'?x:x.text;
      calls.push({name,input:x});
      if(failAt===name)throw Error('SECRET_PRIVATE_SQL_ERROR');
      if(name===AUTH_DEV_ROLE_SWITCH_ATTEST_SQL)return proofValue;
      if(name===PRIMARY_ACCOUNT_SQL){if(act)act();return result;}
      return {command:'OK',rows:[]};
    },
    release(e){releases.push(e)},
  };
  class Pool{
    constructor(config){configs.push(config)}
    async connect(){connectCount++;return client}
    on(name,handler){events.push(name);assert.equal(typeof handler,'function')}
    async end(){ends.push(true)}
  }
  const adapter=createUnroutedAuthDevRoleSwitchPg({Pool,settings:SETTINGS});
  const req=(signal=new AbortController().signal)=>({text:PRIMARY_ACCOUNT_SQL,values:[ID],rowMode:'array',signal});
  return {adapter,req,calls,releases,configs,events,ends,get connectCount(){return connectCount}};
}
test('62D-C6 settings are pinned to loopback, exact separate auth db, dedicated gateway LOGIN',()=>{
  assert.equal(validAuthDevSettings(SETTINGS),true);
  assert.equal(AUTH_DEV_GATEWAY_LOGIN,'ldos_auth_gateway_login');
  assert.equal(AUTH_DEV_READER_ROLE,'ldos_auth_account_reader');
  assert.equal(AUTH_DEV_MAX_POOL,2);
  for(const x of [null,undefined,{},[],{...SETTINGS,host:'0.0.0.0'},
    {...SETTINGS,host:'localhost'},{...SETTINGS,port:5432},
    {...SETTINGS,database:'bdp_postgis'},{...SETTINGS,user:'postgres'},
    {...SETTINGS,user:'ldos_auth_account_reader'},{...SETTINGS,password:'short'},
    {...SETTINGS,host:'127.0.0.1',ssl:false}])
    assert.equal(validAuthDevSettings(x),false);
});
test('62D-C6 factory refuses missing Pool and invalid settings',()=>{
  for(const x of [undefined,{},{Pool:null},{Pool:1},{Pool:class {},settings:{}},
    {Pool:()=>{},settings:{...SETTINGS,port:20000}}])
    assert.throws(()=>createUnroutedAuthDevRoleSwitchPg(x),TypeError);
});
test('62D-C6 construction does not connect and forces SSL off on loopback',async()=>{
  const v=fixture();
  assert.equal(v.connectCount,0);
  assert.equal(v.configs.length,1);
  const cfg=v.configs[0];
  assert.equal(cfg.host,'127.0.0.1');
  assert.equal(cfg.port,54338);
  assert.equal(cfg.user,'ldos_auth_gateway_login');
  assert.equal(cfg.ssl,false);
  assert.equal(cfg.max,2);
  assert.ok(v.events.includes('error'));
  await v.adapter.close();
});
test('62D-C6 fixed SQL proof verifies primary, canonical roles, READ ONLY txn and exact memberships',()=>{
  for(const fragment of ["current_database() = 'ldos_auth_dev'",
    'NOT pg_catalog.pg_is_in_recovery()',
    "session_user = 'ldos_auth_gateway_login'",
    "current_user = 'ldos_auth_account_reader'",
    "current_setting('transaction_read_only') = 'on'",
    'NOT m.admin_option AND NOT m.inherit_option AND m.set_option',
    "count(*) = 1","NOT(r.rolcanlogin OR r.rolsuper"])
    assert.ok(AUTH_DEV_ROLE_SWITCH_ATTEST_SQL.includes(fragment),fragment);
});
test('62D-C6 attestation checks all three SELECT columns and forbids created_at',()=>{
  for(const col of ['subject','account_state','revision'])
    assert.ok(AUTH_DEV_ROLE_SWITCH_ATTEST_SQL.includes("'ldos_app_auth.accounts','"+col+"','SELECT'"));
  assert.ok(AUTH_DEV_ROLE_SWITCH_ATTEST_SQL.includes("'ldos_app_auth.accounts','created_at','SELECT'"));
});
test('62D-C6 attestation checks no account writes, sessions, county grants and guard exec',()=>{
  for(const frag of ['no_account_writes','no_session_rights','no_county_rights',
    'no_guard_execution','no_candidate_rpc','no_schema_create'])
    assert.ok(AUTH_DEV_ROLE_SWITCH_ATTEST_SQL.includes(frag));
});
test('62D-C6 strict proof only accepts one complete all-true attestation row',()=>{
  assert.equal(validAuthDevRoleSwitchProof(proof()),true);
  for(const result of [null,{},[],{...proof(),rowCount:0},
    {...proof(),rows:[]},{...proof(),rows:[{...proof().rows[0],extra:true}]},
    {...proof(),command:'UPDATE'},{...proof(),rows:[{...proof().rows[0],safe_login:false}]},
    {...proof(),rows:[{...proof().rows[0],primary_db:null}]},
    {...proof(),rows:[{...proof().rows[0],read_only_tx:1}]}])
    assert.equal(validAuthDevRoleSwitchProof(result),false);
});
test('62D-C6 accepts ONLY fixed canonical account query with one parameter and AbortSignal',async()=>{
  const v=fixture();
  const wrong=[{},undefined,null,[],{...v.req(),text:'SELECT * FROM ldos_app_auth.sessions'},
    {...v.req(),rowMode:'object'}, {...v.req(),values:[]},
    {...v.req(),values:[ID,ID]},{...v.req(),values:[44]},
    {...v.req(),signal:'not AbortSignal'},{...v.req(),admin:true}];
  for(const input of wrong)await assert.rejects(v.adapter.query(input),/denied/);
  assert.equal(v.connectCount,0);
  await v.adapter.close();
});
test('62D-C6 performs BEGIN READ ONLY, SET LOCAL ROLE, attestation, query, ROLLBACK in order',async()=>{
  const v=fixture();
  assert.equal(await v.adapter.query(v.req()),account);
  assert.deepEqual(v.calls.map(x=>x.name),[
    'BEGIN READ ONLY','SET LOCAL ROLE ldos_auth_account_reader',
    AUTH_DEV_ROLE_SWITCH_ATTEST_SQL,PRIMARY_ACCOUNT_SQL,'ROLLBACK',
  ]);
  assert.equal(v.connectCount,1);
  assert.deepEqual(v.calls[3].input.values,[ID]);
  assert.equal(v.releases.length,1);
  assert.equal(v.releases[0],undefined);
  await v.adapter.close();
});
test('62D-C6 rejects privilege attestation and rolls back before releasing',async()=>{
  const bad=proof();bad.rows[0].no_created_at=false;
  const v=fixture({proofValue:bad});
  await assert.rejects(v.adapter.query(v.req()),/denied/);
  assert.deepEqual(v.calls.map(x=>x.name).slice(-1),['ROLLBACK']);
  assert.equal(v.calls.some(x=>x.name===PRIMARY_ACCOUNT_SQL),false);
  assert.equal(v.releases[0],undefined);
  await v.adapter.close();
});
test('62D-C6 cancellation before checkout never opens database',async()=>{
  const v=fixture();const controller=new AbortController();controller.abort();
  await assert.rejects(v.adapter.query(v.req(controller.signal)),/denied/);
  assert.equal(v.connectCount,0);
  await v.adapter.close();
});
test('62D-C6 cancellation during lookup rejects and rolls back',async()=>{
  const controller=new AbortController();
  const v=fixture({act:()=>controller.abort()});
  await assert.rejects(v.adapter.query(v.req(controller.signal)),/denied/);
  assert.equal(v.calls.at(-1).name,'ROLLBACK');
  await v.adapter.close();
});
test('62D-C6 SQL failure is sanitized, rollback is attempted, no SQL leak',async()=>{
  const v=fixture({failAt:PRIMARY_ACCOUNT_SQL});
  await assert.rejects(v.adapter.query(v.req()),e=>{
    assert.equal(e.message,'Auth-dev primary account read denied');return true;
  });
  assert.equal(v.calls.at(-1).name,'ROLLBACK');
  await v.adapter.close();
});
test('62D-C6 failure to rollback evicts client and denies',async()=>{
  const v=fixture({failAt:'ROLLBACK'});
  await assert.rejects(v.adapter.query(v.req()),/denied/);
  assert.equal(v.releases.length,1);
  assert.ok(v.releases[0] instanceof Error);
  await v.adapter.close();
});
test('62D-C6 role switching failure denies before SELECT and rolls back',async()=>{
  const v=fixture({failAt:'SET LOCAL ROLE ldos_auth_account_reader'});
  await assert.rejects(v.adapter.query(v.req()),/denied/);
  assert.equal(v.calls.some(x=>x.name===PRIMARY_ACCOUNT_SQL),false);
  assert.equal(v.calls.at(-1).name,'ROLLBACK');
  await v.adapter.close();
});
test('62D-C6 close destroys pool and subsequent reads fail closed',async()=>{
  const v=fixture();
  await v.adapter.close();await v.adapter.close();
  assert.equal(v.ends.length,1);
  await assert.rejects(v.adapter.query(v.req()),/denied/);
  assert.equal(v.connectCount,0);
});
test('62D-C6 no browser, HTTP, Supabase, GIS, env read, SQL writes or role provisioning',()=>{
  const src=readFileSync(new URL('../../../server/providers/bdp-auth-dev-role-switch-pg.js',import.meta.url),'utf8');
  assert.doesNotMatch(src,/createServer\(|process\.env|SUPABASE|sb_secret_|CREATE ROLE|GRANT SELECT|INSERT INTO|UPDATE ldos_app_auth|ST_AsGeoJSON|fetch\(/);
  assert.match(src,/UNROUTED, SOURCE-ONLY/);
});
