import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {
  C12_PREFLIGHT_PASS,C12_POSTFLIGHT_EXPECTED,
  requireC12CheckOnly,extractC11Postflight,verifyC12Postflight,
} from '../../../scripts/bdp/app-auth-gateway-installed-preflight.mjs';
import {
  C12_DRIVER_PASS,C12_SYNTHETIC_SUBJECT,C12_DENIED_SQL,
  requireC12DriverFlag,validC12Secret,readSecretStdin,
  exactEmptyAccountQuery,validC12LoginProof,verifyC12LiveGateway,
} from '../../../scripts/bdp/app-auth-dev-pg-driver-live-check.mjs';
import {
  PRIMARY_ACCOUNT_SQL,
} from '../../../server/providers/bdp-primary-account-reader.js';
import {
  AUTH_DEV_ROLE_SWITCH_ATTEST_SQL,
} from '../../../server/providers/bdp-auth-dev-role-switch-pg.js';

const preflightSource=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-gateway-installed-preflight.mjs',import.meta.url,
),'utf8');
const runnerSource=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-dev-pg-driver-live-check.mjs',import.meta.url,
),'utf8');
const wrapperSource=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-dev-pg-driver-live-check.ps1',import.meta.url,
),'utf8');
const migrationSource=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-dev-gateway-provision.ps1',import.meta.url,
),'utf8');
const secret='a'.repeat(64);
const fields=['subject','account_state','revision'].map(name=>({name}));
const empty={command:'SELECT',rowCount:0,rows:[],fields};
const proofNames=['correct_db','primary_db','correct_login','effective_reader',
  'read_only_tx','safe_login','safe_reader','exact_membership',
  'schema_usage','no_schema_create','subject_read','state_read','revision_read',
  'no_created_at','no_account_writes','no_session_rights','no_county_rights',
  'no_guard_execution','no_candidate_rpc'];
function buildFakePg({proofOverride={},account=empty,loginOverride={},
  allowRaw=false,errCode='42501'}={}){
  const logs={configs:[],calls:[],released:0,ended:0};
  class Pool{
    constructor(settings){logs.configs.push(settings);this.kind=logs.configs.length;}
    on(name,handler){assert.equal(name,'error');assert.equal(typeof handler,'function')}
    async connect(){
      assert.equal(this.kind,1);
      const self=this;
      return {
        async query(arg){
          const sql=typeof arg==='string'?arg:arg.text;
          logs.calls.push({pool:self.kind,sql,arg});
          if(sql===AUTH_DEV_ROLE_SWITCH_ATTEST_SQL){
            return {command:'SELECT',rowCount:1,rows:[{
              ...Object.fromEntries(proofNames.map(n=>[n,true])),...proofOverride,
            }]};
          }
          if(sql===PRIMARY_ACCOUNT_SQL)return account;
          return {command:'OK',rowCount:0,rows:[]};
        },
        release(){logs.released++;}
      };
    }
    async query(sql){
      assert.equal(this.kind,2);
      logs.calls.push({pool:this.kind,sql});
      if(sql.startsWith('SELECT current_database() AS db_name')){
        return {command:'SELECT',rowCount:1,rows:[{
          db_name:'ldos_auth_dev',login_name:'ldos_auth_gateway_login',
          session_name:'ldos_auth_gateway_login',is_primary:true,...loginOverride,
        }]};
      }
      if(C12_DENIED_SQL.includes(sql)){
        if(allowRaw)return {command:'SELECT',rowCount:0,rows:[]};
        const e=new Error('FAKE_PRIVATE_SQL_ERROR');e.code=errCode;throw e;
      }
      throw new Error('Unexpected test query');
    }
    async end(){logs.ended++;}
  }
  return {Pool,logs};
}
test('62D-C12 installed-role check is strictly opt-in and read-only',()=>{
  assert.equal(requireC12CheckOnly(['--check-local-auth-only']),true);
  for(const x of [[],null,undefined,['--apply-local-auth-only'],['--force'],
    ['--check-local-auth-only','--force']])assert.throws(()=>requireC12CheckOnly(x));
  assert.match(preflightSource,/verifyTarget\(metadata\(\)\)/);
  assert.match(preflightSource,/docker\(\['exec',CONTAINER,'psql'/);
  assert.doesNotMatch(preflightSource,/CREATE ROLE|INSERT INTO|GRANT SELECT|UPDATE ldos_app_auth|docker compose down/);
});
test('62D-C12 uses the actual C11 source-reviewed SQL postflight',()=>{
  const sql=extractC11Postflight(migrationSource);
  assert.match(sql,/^SELECT\n/);
  assert.match(sql,/rolname='ldos_auth_gateway_login'/);
  assert.match(sql,/NOT has_table_privilege/);
  assert.match(sql,/m.set_option/);
  assert.match(sql,/FROM ldos_app_auth.county_grants/);
  assert.ok(sql.trimEnd().endsWith(';'));
});
test('62D-C12 supports Windows CRLF in C11 SQL source',()=>{
  const win=migrationSource.replace(/\n/g,'\r\n');
  assert.equal(extractC11Postflight(win),extractC11Postflight(migrationSource));
});
test('62D-C12 refuses altered, missing or write-bearing installed role SQL',()=>{
  for(const x of ['',null,undefined,'no SQL',migrationSource.replace('$postflight = @\'','$postflight = @"'),
    migrationSource.replace('SELECT\n  current_database()', 'UPDATE ldos_app_auth.accounts;\nSELECT\n  current_database()')])
    assert.throws(()=>extractC11Postflight(x));
});
test('62D-C12 exact postflight requires installed gateway and empty ledger',()=>{
  assert.equal(verifyC12Postflight(C12_POSTFLIGHT_EXPECTED+'\n'),true);
  for(const x of ['',null,'ldos_auth_dev|t|t|t|t|t|t|t|t|t',
    'ldos_auth_dev|f|f|t|t|t|t|t|t|t',
    'ldos_auth_dev|f|t|t|t|t|t|t|t|f',
    'postgres|f|t|t|t|t|t|t|t|t'])
    assert.throws(()=>verifyC12Postflight(x));
  assert.match(C12_PREFLIGHT_PASS,/no database writes/);
});
test('62D-C12 driver requires exact explicit opt-in',()=>{
  assert.equal(requireC12DriverFlag(['--local-auth-dev-only']),true);
  for(const x of [[],null,undefined,['--prod'],['--disposable-only'],
    ['--local-auth-dev-only','--force']])assert.throws(()=>requireC12DriverFlag(x));
});
test('62D-C12 stdin secret accepts only lowercase random-shaped 32-byte hex',()=>{
  assert.equal(validC12Secret(secret),true);
  for(const s of [null,undefined,123,'',secret.toUpperCase(),
    secret+'x',secret.slice(1),'x'.repeat(64),secret+';'])
    assert.equal(validC12Secret(s),false);
});
test('62D-C12 protected stdin transport reads only 64 hex with optional line ending',async()=>{
  for(const suffix of ['', '\n','\r\n']){
    const buf=Buffer.from(secret+suffix);
    assert.equal(await readSecretStdin(Readable.from([buf])),secret);
    assert.ok(buf.every(b=>b===0));
  }
});
test('62D-C12 protected stdin rejects oversize, invalid and empty transports',async()=>{
  for(const x of [Buffer.alloc(0),Buffer.alloc(67,97),Buffer.from('SHARED_SECRET'),
    Buffer.from(secret+' '+secret)]){
    await assert.rejects(readSecretStdin(Readable.from([x])));
  }
  await assert.rejects(readSecretStdin(null));
});
test('62D-C12 empty account result must have exact SELECT columns and zero rows',()=>{
  assert.equal(exactEmptyAccountQuery(empty),true);
  for(const x of [null,undefined,{...empty,command:'UPDATE'},
    {...empty,rows:[[C12_SYNTHETIC_SUBJECT,'active','2']],rowCount:1},
    {...empty,fields:fields.slice(0,2)},{...empty,rowCount:1},
    {...empty,fields:[...fields,{name:'created_at'}]}])
    assert.equal(exactEmptyAccountQuery(x),false);
});
test('62D-C12 raw LOGIN identity requires exact primary DB and SQL session',()=>{
  const row={db_name:'ldos_auth_dev',login_name:'ldos_auth_gateway_login',
    session_name:'ldos_auth_gateway_login',is_primary:true};
  assert.equal(validC12LoginProof({command:'SELECT',rowCount:1,rows:[row]}),true);
  for(const bad of [{...row,db_name:'postgres'},
    {...row,login_name:'postgres'},{...row,is_primary:false},
    {...row,extra:true}])
    assert.equal(validC12LoginProof({command:'SELECT',rowCount:1,rows:[bad]}),false);
});
test('62D-C12 live proof connects only exact separate loopback auth DB',async()=>{
  const {Pool,logs}=buildFakePg();
  assert.equal(await verifyC12LiveGateway({Pool,password:secret}),true);
  assert.equal(logs.configs.length,2);
  for(const c of logs.configs){
    assert.equal(c.host,'127.0.0.1');assert.equal(c.port,54338);
    assert.equal(c.database,'ldos_auth_dev');
    assert.equal(c.user,'ldos_auth_gateway_login');
    assert.equal(c.ssl,false);
  }
  assert.equal(logs.ended,2);
  assert.equal(logs.released,2);
});
test('62D-C12 live adapter reattests same pinned client for each fixed read',async()=>{
  const {Pool,logs}=buildFakePg();
  await verifyC12LiveGateway({Pool,password:secret});
  const roleCalls=logs.calls.filter(c=>c.sql==='SET LOCAL ROLE ldos_auth_account_reader');
  const attest=logs.calls.filter(c=>c.sql===AUTH_DEV_ROLE_SWITCH_ATTEST_SQL);
  const accounts=logs.calls.filter(c=>c.sql===PRIMARY_ACCOUNT_SQL);
  assert.equal(roleCalls.length,2);
  assert.equal(attest.length,2);
  assert.equal(accounts.length,2);
  assert.deepEqual(accounts[0].arg.values,[C12_SYNTHETIC_SUBJECT]);
  assert.equal(accounts[0].arg.rowMode,'array');
});
test('62D-C12 raw LOGIN cannot access accounts, sessions, counties or postgres',async()=>{
  const {Pool,logs}=buildFakePg();
  await verifyC12LiveGateway({Pool,password:secret});
  for(const sql of C12_DENIED_SQL)
    assert.equal(logs.calls.filter(c=>c.pool===2&&c.sql===sql).length,1);
});
test('62D-C12 forbidden raw SQL success prevents C12 authorization claim',async()=>{
  const {Pool}=buildFakePg({allowRaw:true});
  await assert.rejects(verifyC12LiveGateway({Pool,password:secret}),/verification failed/);
});
test('62D-C12 incorrect PostgreSQL error code never counts as denied ACL',async()=>{
  const {Pool}=buildFakePg({errCode:'ECONNRESET'});
  await assert.rejects(verifyC12LiveGateway({Pool,password:secret}),/verification failed/);
});
test('62D-C12 account unexpectedly exists: deny instead of granting status',async()=>{
  const {Pool}=buildFakePg({account:{
    command:'SELECT',rowCount:1,fields,rows:[[C12_SYNTHETIC_SUBJECT,'active','2']],
  }});
  await assert.rejects(verifyC12LiveGateway({Pool,password:secret}),/verification failed/);
});
test('62D-C12 failed reader attestation denies, never proceeds to raw queries',async()=>{
  const {Pool,logs}=buildFakePg({proofOverride:{safe_reader:false}});
  await assert.rejects(verifyC12LiveGateway({Pool,password:secret}),/verification failed/);
  assert.equal(logs.calls.filter(c=>c.pool===2).length,0);
});
test('62D-C12 rejects wrong login identity even with a valid SQL response',async()=>{
  const {Pool}=buildFakePg({loginOverride:{db_name:'postgres'}});
  await assert.rejects(verifyC12LiveGateway({Pool,password:secret}),/verification failed/);
});
test('62D-C12 never accepts missing Pool or bad credential',async()=>{
  for(const args of [null,{}, {Pool:null,password:secret},
    {Pool:class {},password:'short'}])
    await assert.rejects(verifyC12LiveGateway(args),TypeError);
});
test('62D-C12 source never reads environment secrets or opens a public API',()=>{
  assert.doesNotMatch(runnerSource,/process\.env|createServer\(|sb_secret_|SUPABASE|ST_AsGeoJSON|INSERT INTO|UPDATE ldos_app_auth/);
  assert.match(runnerSource,/readSecretStdin\(input\)/);
  assert.match(runnerSource,/import\('pg'\)/);
  assert.match(runnerSource,/createUnroutedAuthDevRoleSwitchPg/);
});
test('62D-C12 PowerShell only unseals DPAPI locally then writes secret to child stdin',()=>{
  assert.match(wrapperSource,/Add-Type -AssemblyName System.Security/);
  assert.match(wrapperSource,/DataProtectionScope\]::CurrentUser/);
  assert.match(wrapperSource,/StandardInput\.Write\(\$password\)/);
  assert.match(wrapperSource,/RedirectStandardError = \$true/);
  assert.match(wrapperSource,/RedirectStandardOutput = \$true/);
  assert.doesNotMatch(wrapperSource,/PGPASSWORD|POSTGRES_PASSWORD|Write-Output \$password|Set-Content|Out-File/);
});
test('62D-C12 PowerShell verifies installed role before decrypting credentials',()=>{
  const preflight=wrapperSource.indexOf('app-auth-gateway-installed-preflight.mjs');
  const unseal=wrapperSource.indexOf('ProtectedData]::Unprotect(');
  assert.ok(preflight>=0 && unseal>preflight);
  assert.match(wrapperSource,/--check-local-auth-only/);
  assert.match(wrapperSource,/C12 exact persistent gateway preflight rejected/);
});
test('62D-C12 PowerShell accepts PlanOnly and Verify only with no database write',()=>{
  assert.match(wrapperSource,/\[switch\]\$PlanOnly/);
  assert.match(wrapperSource,/\[switch\]\$VerifyLocalAuthOnly/);
  assert.match(wrapperSource,/if \(\$PlanOnly\) \{\s*Write-Output \$PlanMessage\s*return/);
  assert.doesNotMatch(wrapperSource,/CREATE ROLE|ALTER ROLE|GRANT SELECT|pg_restore|docker rm|DROP TABLE/);
  assert.match(C12_DRIVER_PASS,/no database writes/);
});
