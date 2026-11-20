import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {DRIVER_SMOKE_IMAGE} from './parcel-pg-driver-disposable-smoke.mjs';
import {PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL} from
  '../../server/providers/bdp-parcel-session-county-epoch-db.js';

/**
 * Step 40C-47 — STRICT OPT-IN REAL POSTGRES TEST, SYNTHETIC USERS ONLY.
 * Never connect to existing BDP databases, real identities, or source GIS.
 * Fresh networkless disposable container; no ports, mounts or persistence.
 */
export const SESSION_COUNTY_EPOCH_READER_SMOKE_PASS =
  'PASS: disposable PostGIS session/county epoch LOGIN, deny-default grant, ABA revisions and privilege isolation.';
const READY='PostgreSQL init process complete; ready for start up.';
const COUNTY='48453',DIGEST='a'.repeat(64);
const LOGIN='ldos_parcel_session_epoch_test';
const FN='ldos_private_auth.parcel_session_county_epoch_rpc(text,text)';
const KEYS=['exact_login','safe_login','no_role_memberships',
  'schema_usage','no_schema_create','no_private_table_access',
  'no_private_sequence_access','fixed_rpc_execute','no_other_private_rpc'];
export function requireSessionCountyEpochReaderOptIn(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw new Error('Refusing session/county epoch SQL smoke without exact --disposable-only');
  return true;
}
function docker(args,{input,timeout=120_000}={}){
  const p=spawnSync('docker',args,{input,encoding:'utf8',timeout,
    maxBuffer:3*1024*1024});
  if(p.error||p.status!==0){
    const label=['info','image','run','inspect','exec','rm']
      .includes(args[0])?args[0]:'unknown';
    const reason=p.error?.code==='ETIMEDOUT'?'timed out':'failed';
    throw Error('Disposable Docker '+reason+' during '+label+': '+
      String(p.error?.message||p.stderr||p.stdout||'').slice(-1100));
  }
  return String(p.stdout||'');
}
async function ready(container){
  for(let i=0;i<60;i++){
    if(docker(['inspect','--format','{{.State.Status}}',container]).trim()
      !=='running')throw Error('Disposable PostGIS exited');
    const logs=spawnSync('docker',['logs',container],{
      encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
    });
    if(logs.status===0&&String(logs.stdout+logs.stderr).includes(READY)){
      const health=spawnSync('docker',[
        'exec',container,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10_000});
      if(health.status===0)return;
    }
    await sleep(1000);
  }
  throw Error('Disposable PostGIS not ready');
}
export async function runSessionCountyEpochReaderSmoke(args=process.argv.slice(2)){
  requireSessionCountyEpochReaderOptIn(args);
  const container='ldos-session-epoch-rpc-'+randomBytes(6).toString('hex');
  const postgresPassword=randomBytes(32).toString('hex');
  const loginPassword=randomBytes(32).toString('hex');
  let attempted=false;
  try{
    docker(['info','--format','{{.ServerVersion}}'],{timeout:30_000});
    docker(['image','inspect',DRIVER_SMOKE_IMAGE],{timeout:30_000});
    attempted=true;
    docker(['run','-d','--name',container,'--network','none','--pull=never',
      '-e','POSTGRES_PASSWORD='+postgresPassword,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      DRIVER_SMOKE_IMAGE],{timeout:240_000});
    await ready(container);
    const execSql=(statement,asLogin=false)=>spawnSync('docker',[
      'exec','-i',...(asLogin?['-e','PGPASSWORD='+loginPassword]:[]),
      container,'psql','-X','-t','-A','-v','ON_ERROR_STOP=1',
      ...(asLogin?['-h','127.0.0.1','-U',LOGIN]:['-U','postgres']),
      '-d','postgres',
    ],{input:statement,encoding:'utf8',timeout:120_000,maxBuffer:3*1024*1024});
    const sql=(statement,asLogin=false)=>{
      const p=execSql(statement,asLogin);
      if(p.error||p.status!==0)throw Error('Disposable SQL failure: '+
        String(p.error?.message||p.stderr||p.stdout||'').slice(-1000));
      return String(p.stdout||'').trim();
    };
    const denied=(statement,re=/permission denied/i)=>{
      const p=execSql(statement,true);
      assert.notEqual(p.status,0,'Unapproved SQL unexpectedly succeeded');
      assert.match(String(p.stderr),re);
    };
    const file=filename=>readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+filename,import.meta.url),'utf8');
    const lookup="SELECT session_digest||'|'||county_fips||'|'||epoch FROM "+
      "ldos_private_auth.parcel_session_county_epoch_rpc('"+DIGEST+"','"+COUNTY+"');";
    const epoch=()=>BigInt(sql("SELECT epoch FROM "+
      "ldos_private_auth.session_county_epochs WHERE session_digest='"+
      DIGEST+"' AND county_fips='"+COUNTY+"';"));
    const decision="ldos_private_auth.session_county_decisions";
    const predicate="session_digest='"+DIGEST+"' AND county_fips='"+COUNTY+"'";
    const read=()=>sql(lookup,true);
    sql('SELECT PostGIS_Version();');
    sql(file('parcelSessionCountyEpochFoundation.sql'));
    sql(file('parcelSessionCountyEpochRpcFoundation.sql'));
    sql('CREATE ROLE '+LOGIN+' LOGIN NOINHERIT NOSUPERUSER NOCREATEDB '+
      "NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+loginPassword+"';");
    sql('GRANT USAGE ON SCHEMA ldos_private_auth TO '+LOGIN+';');
    denied(lookup);
    denied('SELECT * FROM '+decision+';');
    denied('SELECT * FROM ldos_private_auth.session_county_epochs;');
    sql('GRANT EXECUTE ON FUNCTION '+FN+' TO '+LOGIN+';');
    const attest=()=>{
      const out=sql('PREPARE ldos_session_epoch_attest(text) AS '+
        PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL+";\n"+
        "EXECUTE ldos_session_epoch_attest('"+LOGIN+"');",true);
      const proof=out.split(/\r?\n/)
        .find(line=>/^([tf]\|){8}[tf]$/.test(line.trim()));
      assert.ok(proof,'Exactly nine role attestation booleans required');
      return Object.fromEntries(KEYS.map((k,i)=>
        [k,proof.trim().split('|')[i]==='t']));
    };
    assert.ok(Object.values(attest()).every(Boolean));
    assert.equal(read(),'','Missing grant cannot return a version');

    sql('INSERT INTO '+decision+' (session_digest,county_fips) VALUES ('+
      "'"+DIGEST+"','"+COUNTY+"');");
    assert.equal(epoch(),1n);
    assert.equal(read(),'','Default-false account/session flags must deny');
    sql('UPDATE '+decision+' SET account_active=TRUE,mfa_verified=TRUE,'+
      'session_active=TRUE,allow_discovery=TRUE WHERE '+predicate+';');
    assert.equal(epoch(),2n);
    assert.equal(read(),DIGEST+'|'+COUNTY+'|2');
    sql('UPDATE '+decision+' SET allow_discovery=FALSE WHERE '+predicate+';');
    assert.equal(epoch(),3n);
    assert.equal(read(),'','Revocation must remove current permission');
    sql('UPDATE '+decision+' SET allow_discovery=TRUE WHERE '+predicate+';');
    assert.equal(epoch(),4n);
    assert.equal(read(),DIGEST+'|'+COUNTY+'|4',
      'ABA restored current facts cannot restore the old epoch');
    sql('BEGIN;\nUPDATE '+decision+' SET session_active=FALSE WHERE '+
      predicate+';\nROLLBACK;');
    assert.equal(epoch(),4n);
    assert.equal(read(),DIGEST+'|'+COUNTY+'|4','Rolled-back revoke must be invisible');
    sql('UPDATE '+decision+' SET mfa_verified=FALSE WHERE '+predicate+';');
    assert.equal(epoch(),5n);
    assert.equal(read(),'','MFA revoked must deny synthetic proof');
    sql('DELETE FROM '+decision+' WHERE '+predicate+';');
    assert.equal(epoch(),6n);
    assert.equal(read(),'');
    sql('INSERT INTO '+decision+' (session_digest,county_fips,'+
      'account_active,mfa_verified,session_active,allow_discovery) VALUES ('+
      "'"+DIGEST+"','"+COUNTY+"',TRUE,TRUE,TRUE,TRUE);");
    assert.equal(epoch(),7n,'Delete/recreate must not reset history');
    assert.equal(read(),DIGEST+'|'+COUNTY+'|7');
    assert.equal(sql("SELECT count(*) FROM "+decision+";"),'1');

    // Prove published SQL adapter's catalog attestation detects privilege drift.
    sql('GRANT SELECT ON ldos_private_auth.session_county_epochs TO '+LOGIN+';');
    assert.equal(attest().no_private_table_access,false);
    sql('REVOKE SELECT ON ldos_private_auth.session_county_epochs FROM '+LOGIN+';');
    assert.ok(Object.values(attest()).every(Boolean));
    denied('SELECT * FROM '+decision+';');
    denied('SELECT * FROM ldos_private_auth.session_county_epochs;');
    process.stdout.write(SESSION_COUNTY_EPOCH_READER_SMOKE_PASS+'\n');
  }catch(error){
    const logs=attempted?spawnSync('docker',['logs','--tail','25',container],{
      encoding:'utf8',timeout:10_000,maxBuffer:128*1024,
    }):null;
    const details=String((logs?.stderr||'')+(logs?.stdout||'')).slice(-1000);
    throw Error(('Disposable session/county epoch smoke failed: '+
      error.message+'\n'+details).replaceAll(loginPassword,'[redacted]')
      .replaceAll(postgresPassword,'[redacted]').slice(0,2700));
  }finally{
    if(attempted){
      try{docker(['rm','--force','--volumes',container],{timeout:30_000});}
      catch{process.stderr.write('WARNING: session epoch smoke cleanup not confirmed\n');}
    }
  }
}
if(process.argv[1]&&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runSessionCountyEpochReaderSmoke().catch(error=>{
    process.stderr.write(error.message+'\n');
    process.exitCode=1;
  });
}
