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
 * Step 40C-62D-C11D — Exact C11 SQL executed only in a fresh disposable PG17.
 * No external network, host ports, mounts, volumes, real account subjects,
 * DPAPI secrets, persistent DB/Supabase/PostGIS access or browser endpoint.
 */
export const IMAGE='postgres:17';
export const PASS='PASS: C11 exact gateway SQL verified in isolated PG17; synthetic LOGIN, SET-only NOLOGIN reader, full privilege attestation, no direct table rights, duplicate-apply denial; persistent auth-dev untouched.';
export const POSTFLIGHT='ldos_auth_dev|f|t|t|t|t|t|t|t|t';
export const ATTESTATION=Array(19).fill('t').join('|');

export function requireDisposableOnly(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw new Error('Use exactly --disposable-only for C11 SQL smoke');
  return true;
}
export function extractC11Sql(source,password){
  if(typeof source!=='string'
    || typeof password!=='string'||!/^[0-9a-f]{64}$/.test(password))
    throw new Error('Reviewed SQL source and synthetic 32-byte hex fixture required');
  const main=/^[ \t]*\$sql = @'\r?\n([\s\S]*?)\r?\n'@/m.exec(source);
  const post=/^[ \t]*\$postflight = @'\r?\n([\s\S]*?)\r?\n'@/m.exec(source);
  if(!main||!post || main[1].match(/__C11_HEX_CREDENTIAL__/g)?.length!==1
    || !main[1].trim().startsWith('BEGIN;')
    || !main[1].trim().endsWith('COMMIT;')
    || !main[1].includes('END;\n$ldos_c11_guard$;')
    || !post[1].trim().startsWith('SELECT')
    || !post[1].includes("rolname='ldos_auth_gateway_login'"))
    throw new Error('C11 source framing changed; refuse fixture execution');
  return Object.freeze({
    migration:main[1].replace('__C11_HEX_CREDENTIAL__',password)+'\n',
    postflight:post[1]+'\n',
  });
}
function docker(args,{input,timeout=30000,raw=false}={}){
  const p=spawnSync('docker',args,{
    encoding:'utf8',input,windowsHide:true,timeout,maxBuffer:1024*1024,
  });
  if(p.error)throw new Error('Disposable Docker unavailable');
  if(raw)return p;
  if(p.status!==0)throw new Error('Disposable Docker operation failed');
  return String(p.stdout||'').trim();
}
async function ready(container){
  for(let i=0;i<60;i++){
    const x=spawnSync('docker',['logs',container],{
      encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024,
    });
    if(x.status===0 && String(x.stdout+x.stderr).includes(
      'PostgreSQL init process complete; ready for start up.'
    )){
      const y=spawnSync('docker',['exec',container,'pg_isready','-U','postgres',
        '-d','ldos_auth_dev'],{encoding:'utf8',windowsHide:true,timeout:10000});
      if(y.status===0)return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable PG17 startup unavailable');
}
export async function runC11DisposableSmoke(args=process.argv.slice(2)){
  requireDisposableOnly(args);
  const name='ldos-c11-credential-'+randomBytes(6).toString('hex');
  const owner=randomBytes(32).toString('hex');
  const loginPassword=randomBytes(32).toString('hex');
  let created=false,stage='Docker image preflight';
  // psql inside only the new randomly named container. The only password
  // passed in Docker args is the synthetic disposable LOGIN fixture.
  const psql=(sql,{gateway=false,raw=false}={})=>{
    const argv=['exec','-i'];
    if(gateway)argv.push('-e','PGPASSWORD='+loginPassword);
    argv.push(name,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1');
    if(gateway)argv.push('-h','127.0.0.1','-U','ldos_auth_gateway_login');
    else argv.push('-U','postgres');
    argv.push('-d','ldos_auth_dev');
    return docker(argv,{input:sql,timeout:50000,raw});
  };
  try{
    docker(['info','--format','{{.ServerVersion}}']);
    docker(['image','inspect',IMAGE]);
    stage='fresh isolated PG17 container';
    docker(['run','-d','--rm','--network','none','--pull','never',
      '--name',name,'-e','POSTGRES_PASSWORD='+owner,
      '-e','POSTGRES_DB=ldos_auth_dev',
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      IMAGE],{timeout:120000});
    created=true;
    await ready(name);
    const readFile=path=>readFileSync(new URL(path,import.meta.url),'utf8');
    stage='install only the existing app-owned ledger and NOLOGIN reader';
    psql(readFile('../../server/standalone/sql/landOsAccountAuthorityFoundation.sql'));
    psql(makeRoleMigration());
    const source=readFile('app-auth-dev-gateway-provision.ps1');
    const sql=extractC11Sql(source,loginPassword);
    assert.equal(psql("SELECT count(*) FROM pg_roles WHERE rolname='ldos_auth_gateway_login';"),'0');

    stage='execute C11 exact guarded SQL with randomized synthetic credential';
    psql(sql.migration);
    assert.equal(psql(sql.postflight),POSTFLIGHT);

    stage='verify actual restricted password-authenticated LOGIN';
    assert.equal(psql('SELECT current_user,session_user;',{gateway:true}),
      'ldos_auth_gateway_login|ldos_auth_gateway_login');
    const denied=statement=>{
      const x=psql(statement,{gateway:true,raw:true});
      assert.notEqual(x.status,0,'Unexpected disposable SQL permission');
      assert.match(String(x.stderr||''),
        /permission denied|not permitted|cannot set role/i);
    };
    denied('SELECT subject FROM ldos_app_auth.accounts;');
    denied('SELECT * FROM ldos_app_auth.sessions;');
    denied('SELECT * FROM ldos_app_auth.county_grants;');
    denied('SET ROLE postgres;');

    stage='READ ONLY, SET LOCAL ROLE and 19-field current-primary proof';
    const restricted=psql([
      'BEGIN READ ONLY;',
      'SET LOCAL ROLE ldos_auth_account_reader;',
      AUTH_DEV_ROLE_SWITCH_ATTEST_SQL+';',
      'PREPARE ldos_account(uuid) AS '+PRIMARY_ACCOUNT_SQL+';',
      "EXECUTE ldos_account('11111111-1111-4111-8111-111111111111');",
      'ROLLBACK;',
    ].join('\n'),{gateway:true});
    assert.equal(restricted,ATTESTATION);
    stage='deny second role creation and retain only empty ledger';
    const duplicate=psql(sql.migration,{raw:true});
    assert.notEqual(duplicate.status,0);
    assert.equal(psql(sql.postflight),POSTFLIGHT);
    assert.equal(psql('SELECT (SELECT count(*) FROM ldos_app_auth.accounts),'+
      '(SELECT count(*) FROM ldos_app_auth.sessions),'+
      '(SELECT count(*) FROM ldos_app_auth.county_grants);'),'0|0|0');
    process.stdout.write(PASS+'\n');
    return true;
  }catch{
    // No SQL/error text, passwords, role hashes or identifiers to stdout.
    throw new Error('C11 disposable SQL proof failed at '+stage+
      '; persistent databases not targeted');
  }finally{
    if(created){
      try{docker(['rm','--force','--volumes',name],{timeout:30000});}
      catch{process.stderr.write('WARNING: C11 disposable container cleanup unconfirmed\n');}
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runC11DisposableSmoke().catch(e=>{
    process.stderr.write(e.message+'\n');process.exitCode=1;
  });
}
