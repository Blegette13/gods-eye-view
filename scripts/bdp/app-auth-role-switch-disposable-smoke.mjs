import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {makeRoleMigration} from './app-auth-local-reader-role-migration.mjs';
import {AUTH_DEV_ROLE_SWITCH_ATTEST_SQL} from '../../server/providers/bdp-auth-dev-role-switch-pg.js';
import {PRIMARY_ACCOUNT_SQL} from '../../server/providers/bdp-primary-account-reader.js';

/**
 * Step 40C-62D-C7 — REAL PG17, NEW DISPOSABLE database only.
 * Verifies password-authenticated NOINHERIT LOGIN -> NOLOGIN reader SET LOCAL
 * ROLE in a READ ONLY transaction. It never touches the existing persistent
 * auth-dev database, Supabase, PostGIS, the public API, or real user records.
 */
export const PASS='PASS: disposable PG17 restricted gateway LOGIN -> NOLOGIN account reader; read-only role switch, privilege attestation, deny-first states, ABA epochs and forbidden SQL verified; persistent auth-dev untouched.';
export const IMAGE='postgres:17';
export const GATEWAY='ldos_auth_gateway_login';
export const SUBJECT='11111111-1111-4111-8111-111111111111';
export const ATTEST_EXPECTED=Array(19).fill('t').join('|');

export function requireDisposableFlag(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw new Error('Refusing authentication PG role-switch smoke without exactly --disposable-only');
  return true;
}
export function gatewayRoleSql(password){
  if(typeof password!=='string'||!/^[a-f0-9]{64}$/.test(password))
    throw new Error('Randomized synthetic gateway credential required');
  return [
    'BEGIN;',
    'SET LOCAL lock_timeout = \'5s\';',
    'SET LOCAL statement_timeout = \'30s\';',
    'DO $guard$ BEGIN',
    "IF current_database() <> 'ldos_auth_dev' OR pg_is_in_recovery()",
    " OR current_user <> 'postgres'",
    " OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ldos_auth_account_reader')",
    " OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ldos_auth_gateway_login')",
    ' THEN RAISE EXCEPTION \'Unexpected disposable gateway setup\'; END IF;',
    'END $guard$;',
    'CREATE ROLE ldos_auth_gateway_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    "PASSWORD '"+password+"';",
    'GRANT ldos_auth_account_reader TO ldos_auth_gateway_login',
    'WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;',
    'COMMIT;',
  ].join('\n');
}
// Safe, immutable request template; SQL placeholders are bound at the
// protocol/SQL PREPARE boundary. This only exercises the existing fixed SELECT.
export function roleReadOnlySql(subject=SUBJECT){
  if(subject!==SUBJECT)throw new Error('Only the synthetic fixed subject is allowed');
  return [
    'BEGIN READ ONLY;',
    'SET LOCAL ROLE ldos_auth_account_reader;',
    AUTH_DEV_ROLE_SWITCH_ATTEST_SQL+';',
    'PREPARE ldos_read_account(uuid) AS '+PRIMARY_ACCOUNT_SQL+';',
    "EXECUTE ldos_read_account('"+SUBJECT+"');",
    'ROLLBACK;',
  ].join('\n');
}
function docker(args,{input,timeout=30000}={}){
  const p=spawnSync('docker',args,{
    input,encoding:'utf8',windowsHide:true,timeout,maxBuffer:1024*1024,
  });
  if(p.error||p.status!==0)
    throw new Error('Disposable Docker operation unavailable');
  return String(p.stdout||'').trim();
}
async function ready(name){
  for(let i=0;i<60;i++){
    const p=spawnSync('docker',['logs',name],{
      encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024,
    });
    if(p.status===0&&String(p.stdout+p.stderr).includes('PostgreSQL init process complete; ready for start up.')){
      const probe=spawnSync('docker',[
        'exec',name,'pg_isready','-U','postgres','-d','ldos_auth_dev',
      ],{encoding:'utf8',windowsHide:true,timeout:10000});
      if(probe.status===0)return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable auth Postgres did not become ready');
}
export async function runDisposableAuthRoleSwitch(args=process.argv.slice(2)){
  requireDisposableFlag(args);
  const name='ldos-auth-role-switch-'+randomBytes(6).toString('hex');
  const ownerPassword=randomBytes(32).toString('hex');
  const gatewayPassword=randomBytes(32).toString('hex');
  let created=false,stage='Docker and local image preflight';
  const psql=(sql,{gateway=false,raw=false}={})=>{
    const result=spawnSync('docker',[
      'exec','-i',...(gateway?['-e','PGPASSWORD='+gatewayPassword]:[]),
      name,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1',
      ...(gateway?['-h','127.0.0.1','-U',GATEWAY]:['-U','postgres']),
      '-d','ldos_auth_dev',
    ],{input:sql,encoding:'utf8',windowsHide:true,timeout:35000,maxBuffer:1024*1024});
    if(result.error)throw new Error('Disposable SQL command unavailable');
    if(raw)return result;
    if(result.status!==0)throw new Error('Disposable SQL failed');
    return String(result.stdout||'').trim();
  };
  const denied=(sql,{gateway=true}={})=>{
    const r=psql(sql,{gateway,raw:true});
    assert.notEqual(r.status,0,'Unapproved SQL command succeeded');
    assert.match(String(r.stderr||''),/permission denied|not permitted|must be owner|cannot set role/i);
  };
  try{
    docker(['info','--format','{{.ServerVersion}}']);
    docker(['image','inspect',IMAGE]);
    stage='new isolated disposable PostgreSQL startup';
    docker(['run','-d','--rm','--name',name,'--network','none','--pull','never',
      '-e','POSTGRES_PASSWORD='+ownerPassword,
      '-e','POSTGRES_DB=ldos_auth_dev',
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      IMAGE],{timeout:90000});
    created=true;
    await ready(name);
    stage='install exact existing ledger and C5 NOLOGIN role in disposable PG';
    psql(readFileSync(new URL(
      '../../server/standalone/sql/landOsAccountAuthorityFoundation.sql',
      import.meta.url,
    ),'utf8'));
    psql(makeRoleMigration());
    assert.equal(psql("SELECT rolcanlogin FROM pg_roles WHERE rolname='ldos_auth_account_reader';"),'f');
    stage='create synthetic restricted SQL LOGIN and role membership';
    psql(gatewayRoleSql(gatewayPassword));
    assert.equal(psql("SELECT m.admin_option::text||'|'||m.inherit_option::text||'|'||m.set_option::text FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles g ON g.oid=m.member WHERE r.rolname='ldos_auth_account_reader' AND g.rolname='ldos_auth_gateway_login';"),'false|false|true');
    stage='verify login has no direct account or session rights';
    assert.equal(psql("SELECT current_user,session_user;",{gateway:true}),GATEWAY+'|'+GATEWAY);
    denied('SELECT subject FROM ldos_app_auth.accounts;');
    denied('SELECT * FROM ldos_app_auth.sessions;');
    denied('SELECT * FROM ldos_app_auth.county_grants;');
    denied('SET ROLE postgres;');
    stage='verify fixed primary reader under local role switch';
    const run=()=>psql(roleReadOnlySql(),{gateway:true}).split('\n').filter(Boolean);
    let result=run();
    assert.equal(result.length,1);
    assert.equal(result[0],ATTEST_EXPECTED);
    stage='synthetic deny-first, active, suspended ABA revisions';
    assert.equal(psql("INSERT INTO ldos_app_auth.accounts(subject) VALUES ('"+SUBJECT+"') RETURNING account_state||'|'||revision;"),'suspended|1');
    result=run();
    assert.deepEqual(result,[ATTEST_EXPECTED,SUBJECT+'|suspended|1']);
    assert.equal(psql("UPDATE ldos_app_auth.accounts SET account_state='active' WHERE subject='"+SUBJECT+"' RETURNING account_state||'|'||revision;"),'active|2');
    assert.deepEqual(run(),[ATTEST_EXPECTED,SUBJECT+'|active|2']);
    assert.equal(psql("UPDATE ldos_app_auth.accounts SET account_state='suspended' WHERE subject='"+SUBJECT+"' RETURNING account_state||'|'||revision;"),'suspended|3');
    assert.deepEqual(run(),[ATTEST_EXPECTED,SUBJECT+'|suspended|3']);
    assert.equal(psql("UPDATE ldos_app_auth.accounts SET account_state='active' WHERE subject='"+SUBJECT+"' RETURNING account_state||'|'||revision;"),'active|4');
    assert.deepEqual(run(),[ATTEST_EXPECTED,SUBJECT+'|active|4']);
    stage='reject account creation, mutation, hidden columns and restricted tables';
    for(const statement of [
      'BEGIN READ ONLY; SET LOCAL ROLE ldos_auth_account_reader; SELECT created_at FROM ldos_app_auth.accounts;',
      'BEGIN READ ONLY; SET LOCAL ROLE ldos_auth_account_reader; SELECT * FROM ldos_app_auth.sessions;',
      'BEGIN READ ONLY; SET LOCAL ROLE ldos_auth_account_reader; SELECT * FROM ldos_app_auth.county_grants;',
      'BEGIN READ ONLY; SET LOCAL ROLE ldos_auth_account_reader; UPDATE ldos_app_auth.accounts SET account_state=\'closed\';',
      'BEGIN READ ONLY; SET LOCAL ROLE ldos_auth_account_reader; CREATE TABLE ldos_app_auth.escape(x int);',
    ])denied(statement);
    assert.equal(psql('SELECT (SELECT count(*) FROM ldos_app_auth.accounts),(SELECT count(*) FROM ldos_app_auth.sessions),(SELECT count(*) FROM ldos_app_auth.county_grants);'),'1|0|0');
    process.stdout.write(PASS+'\n');
    return true;
  }catch{
    // No credentials, raw SQL, user identifiers or token information on errors.
    throw new Error('Disposable authentication role-switch SQL proof failed at '+stage+'; persistent databases not targeted');
  }finally{
    if(created){
      try{docker(['rm','--force','--volumes',name],{timeout:30000});}
      catch{process.stderr.write('WARNING: disposable role-switch container cleanup unconfirmed\n');}
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runDisposableAuthRoleSwitch().catch(e=>{
    process.stderr.write(e.message+'\n');process.exitCode=1;
  });
}
