import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {createUnroutedPrimaryAccountReader} from '../../server/providers/bdp-primary-account-reader.js';

/**
 * Step 40C-62C — ACTUAL pg driver + RESTRICTED LOGIN + CURRENT PRIMARY
 * integration against a NEW disposable synthetic PostgreSQL container only.
 * No Supabase, application API, parcel PostGIS, app session or geometry.
 * Localhost port binding only, no mounts/persistence, no real user account.
 */
export const PRIMARY_PG_SMOKE_PASS =
  'PASS: disposable real pg driver and restricted primary account reader; deny-first, exact UUID/revision, revocation, no sessions, no counties, no GIS.';
const IMAGE='postgis/postgis:17-3.5';
const PG_USER='ldos_auth_account_reader';
const TEST_SUBJECT='11111111-1111-4111-8111-111111111111';
const OTHER_SUBJECT='22222222-2222-4222-8222-222222222222';
const INIT='PostgreSQL init process complete; ready for start up.';
export const PRIMARY_PG_ATTESTATION_SQL = [
  'SELECT',
  "  current_user = 'ldos_auth_account_reader' AS correct_user,",
  "  session_user = 'ldos_auth_account_reader' AS correct_session,",
  '  NOT pg_catalog.pg_is_in_recovery() AS current_primary,',
  '  COALESCE((SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole',
  '    OR rolbypassrls OR rolreplication) FROM pg_catalog.pg_roles',
  "    WHERE rolname = session_user), FALSE) AS least_privilege,",
  "  pg_catalog.has_schema_privilege(current_user,'ldos_app_auth','USAGE') AS schema_usage,",
  "  NOT pg_catalog.has_schema_privilege(current_user,'ldos_app_auth','CREATE') AS no_schema_create,",
  "  pg_catalog.has_table_privilege(current_user,'ldos_app_auth.accounts','SELECT') AS account_select,",
  "  NOT pg_catalog.has_table_privilege(current_user,'ldos_app_auth.accounts',",
  "    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_account_mutations,",
  "  NOT pg_catalog.has_table_privilege(current_user,'ldos_app_auth.sessions',",
  "    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_sessions,",
  "  NOT pg_catalog.has_table_privilege(current_user,'ldos_app_auth.county_grants',",
  "    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_county_grants",
].join('\n');
const PROOF_KEYS=['correct_user','correct_session','current_primary',
  'least_privilege','schema_usage','no_schema_create','account_select',
  'no_account_mutations','no_sessions','no_county_grants'];

export function requirePrimaryPgDisposableOnly(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw Error('Refusing primary PostgreSQL driver smoke without exactly --disposable-only');
  return true;
}
export function parsePrimaryPgLoopbackPort(output){
  const match=typeof output==='string'
    ?output.trim().match(/^127\.0\.0\.1:(\d{1,5})$/):null;
  const n=match?Number(match[1]):0;
  return Number.isSafeInteger(n)&&n>0&&n<65536?n:null;
}
export function createRestrictedPrimaryPgQuery({Pool,settings}={}){
  if(typeof Pool!=='function'||!settings||typeof settings!=='object'
    || Object.keys(settings).sort().join('|')!=='database|host|password|port|user'
    || settings.host!=='127.0.0.1' || settings.user!==PG_USER
    || settings.database!=='postgres'
    || !Number.isSafeInteger(settings.port)||settings.port<1||settings.port>65535
    || typeof settings.password!=='string'||!/^[a-f0-9]{64}$/.test(settings.password))
    throw new TypeError('A restricted loopback-only fixture pg Pool is required');
  const pool=new Pool({
    host:'127.0.0.1',port:settings.port,database:'postgres',user:PG_USER,
    password:settings.password,ssl:false,max:2,min:0,
    connectionTimeoutMillis:2000,idleTimeoutMillis:3000,
    statement_timeout:2000,idle_in_transaction_session_timeout:4000,
    allowExitOnIdle:true,application_name:'ldos-app-auth-disposable-only',
  });
  if(typeof pool.connect!=='function'||typeof pool.end!=='function'
    || typeof pool.on!=='function')throw new TypeError('Invalid pg Pool interface');
  pool.on('error',()=>{/* No raw pg errors, server URLs or credentials printed */});
  let closed=false;
  return Object.freeze({
    async query({text,values,rowMode,signal}={}){
      if(closed||typeof text!=='string'
        || typeof rowMode!=='string'||rowMode!=='array'
        || !Array.isArray(values)||values.length!==1
        || !(signal instanceof AbortSignal)||signal.aborted)
        throw Error('Primary PostgreSQL account read unavailable');
      let client;
      try {
        client=await pool.connect();
        const proof=await client.query(PRIMARY_PG_ATTESTATION_SQL);
        if(signal.aborted||!proof||!Array.isArray(proof.rows)
          || proof.rows.length!==1||!proof.rows[0]
          || !PROOF_KEYS.every(key=>proof.rows[0][key]===true))
          throw Error('Restricted PostgreSQL role proof rejected');
        if(signal.aborted)throw Error('Request cancelled');
        return await client.query({text,values,rowMode});
      }catch{
        throw Error('Primary PostgreSQL account read unavailable');
      }finally{
        if(client){
          try{client.release();}catch{/* Generic fail-closed outside */ }
        }
      }
    },
    async close(){
      if(closed)return;
      closed=true;
      await pool.end();
    },
  });
}
function docker(args,options={}){
  const p=spawnSync('docker',args,{
    encoding:'utf8',input:options.input,timeout:options.timeout??30000,
    windowsHide:true,maxBuffer:1024*1024,
  });
  if(p.status!==0||p.error)throw Error('Disposable Docker step unavailable');
  return String(p.stdout||'').trim();
}
async function ready(name){
  for(let i=0;i<60;i++){
    const state=docker(['inspect','--format','{{.State.Status}}',name]);
    if(state!=='running')throw Error('Disposable PostgreSQL exited');
    const p=spawnSync('docker',['logs',name],{
      encoding:'utf8',timeout:10000,maxBuffer:1024*1024,windowsHide:true,
    });
    if(p.status===0&&String(p.stdout+p.stderr).includes(INIT)){
      const pg=spawnSync('docker',[
        'exec',name,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10000,windowsHide:true});
      if(pg.status===0)return;
    }
    await sleep(1000);
  }
  throw Error('Disposable PostgreSQL startup unavailable');
}
export async function runPrimaryPgDriverDisposableSmoke(
  args=process.argv.slice(2),{loadPg=()=>import('pg')}={}
){
  requirePrimaryPgDisposableOnly(args);
  // Verify presence of real driver BEFORE Docker runs or database is created.
  let Pool;
  try{
    const module=await loadPg();
    Pool=module?.Pool??module?.default?.Pool;
    if(typeof Pool!=='function')throw Error('bad pg');
  }catch{
    throw Error('Local pg driver is not installed (install pg locally first)');
  }
  const name='ldos-auth-primary-driver-'+randomBytes(6).toString('hex');
  const rootPassword=randomBytes(32).toString('hex');
  const readerPassword=randomBytes(32).toString('hex');
  let created=false,db;
  let stage='Docker/image preflight';
  const psql=sql=>docker([
    'exec','-i',name,'psql','-X','-v','ON_ERROR_STOP=1',
    '-U','postgres','-d','postgres',
  ],{input:sql,timeout:30000});
  try{
    docker(['info','--format','{{.ServerVersion}}']);
    docker(['image','inspect',IMAGE]);
    stage='create isolated loopback container';
    docker(['run','-d','--name',name,'--network','bridge','--pull=never',
      '-p','127.0.0.1::5432',
      '-e','POSTGRES_PASSWORD='+rootPassword,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      IMAGE],{timeout:240000});
    created=true;
    await ready(name);
    const port=parsePrimaryPgLoopbackPort(docker(['port',name,'5432/tcp']));
    assert.ok(port,'Refusing non-loopback Docker port');
    stage='install untouched synthetic authorization ledger';
    psql(readFileSync(new URL(
      '../../server/standalone/sql/landOsAccountAuthorityFoundation.sql',
      import.meta.url,
    ),'utf8'));
    psql('CREATE ROLE '+PG_USER+' LOGIN NOINHERIT NOSUPERUSER '+
      'NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS '+
      "PASSWORD '"+readerPassword+"';\n"+
      'GRANT USAGE ON SCHEMA ldos_app_auth TO '+PG_USER+';\n'+
      'GRANT SELECT ON ldos_app_auth.accounts TO '+PG_USER+';\n');
    db=createRestrictedPrimaryPgQuery({Pool,settings:{
      host:'127.0.0.1',port,database:'postgres',user:PG_USER,
      password:readerPassword,
    }});
    const reader=createUnroutedPrimaryAccountReader({query:db.query});
    const signal=new AbortController().signal;
    const get=(subject=TEST_SUBJECT)=>reader({subject,signal});

    stage='real restricted LOGIN and deny-first account';
    psql("INSERT INTO ldos_app_auth.accounts(subject) VALUES ('"+
      TEST_SUBJECT+"');");
    assert.equal(await get(),null);
    assert.equal(await get(OTHER_SUBJECT),null);
    psql("UPDATE ldos_app_auth.accounts SET account_state='active' WHERE subject='"+
      TEST_SUBJECT+"';");
    assert.deepEqual(await get(),{
      subject:TEST_SUBJECT,account_state:'active',revision:'2',
      source:'app-owned-primary',current:true,
    });
    stage='restrict mutation and unrelated raw table reads';
    const restricted=new Pool({
      host:'127.0.0.1',port,database:'postgres',user:PG_USER,
      password:readerPassword,ssl:false,max:1,
      connectionTimeoutMillis:2000,statement_timeout:2000,
    });
    try{
      for(const blocked of [
        "SELECT * FROM ldos_app_auth.sessions;",
        "SELECT * FROM ldos_app_auth.county_grants;",
        "UPDATE ldos_app_auth.accounts SET account_state='closed';",
        "INSERT INTO ldos_app_auth.accounts(subject) VALUES ('"+
          OTHER_SUBJECT+"');",
        "CREATE TABLE ldos_app_auth.escape(i integer);",
        'SET ROLE postgres;',
      ])await assert.rejects(restricted.query(blocked),/permission denied|not permitted/i);
    }finally{await restricted.end();}
    stage='revocation state reversal and exact epoch check';
    psql("UPDATE ldos_app_auth.accounts SET account_state='suspended' WHERE subject='"+
      TEST_SUBJECT+"';");
    assert.equal(await get(),null);
    psql("UPDATE ldos_app_auth.accounts SET account_state='active' WHERE subject='"+
      TEST_SUBJECT+"';");
    assert.equal((await get())?.revision,'4');
    assert.equal(await get(OTHER_SUBJECT),null);
    const aborted=new AbortController();aborted.abort();
    assert.equal(await reader({subject:TEST_SUBJECT,signal:aborted.signal}),null);
    assert.equal(psql('SELECT count(*) FROM ldos_app_auth.sessions;').split(/\s+/).pop(),'0');
    assert.equal(psql('SELECT count(*) FROM ldos_app_auth.county_grants;').split(/\s+/).pop(),'0');
    process.stdout.write(PRIMARY_PG_SMOKE_PASS+'\n');
  }catch{
    // Never disclose Docker arguments, roles' passwords, SQL or fixture data.
    throw Error('Disposable primary pg driver smoke failed at '+stage+
      '; no live Supabase or parcel DB changed');
  }finally{
    if(db)await db.close().catch(()=>{});
    if(created){
      try{docker(['rm','--force','--volumes',name],{timeout:30000});}
      catch{process.stderr.write('WARNING: isolated primary container cleanup unconfirmed\n');}
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runPrimaryPgDriverDisposableSmoke().catch(e=>{
    process.stderr.write(e.message+'\n');process.exitCode=1;
  });
}
