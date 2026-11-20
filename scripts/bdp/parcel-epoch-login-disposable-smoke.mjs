import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {
  DRIVER_SMOKE_IMAGE,SYNTHETIC_DRIVER_FIXTURE_SQL,
} from './parcel-pg-driver-disposable-smoke.mjs';
import {PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL} from
  '../../server/providers/bdp-parcel-policy-epoch-db.js';

/**
 * Step 40C-41 — real isolated PostGIS fixed epoch-only LOGIN smoke.
 * SYNTHETIC DATA ONLY. Never touches a local database, published polygons,
 * production roles, actual county licenses, cookies or client transport.
 * This validates serialized sequential changes, NOT concurrent read release.
 */
export const PRIVATE_EPOCH_LOGIN_SMOKE_PASS =
  'PASS: disposable PostGIS epoch-only LOGIN, exact privileges, ABA epochs and independent rights.';
const READY='PostgreSQL init process complete; ready for start up.';
const LOGIN='ldos_parcel_epoch_test';
const SOURCE='step40c13-synthetic';
const COUNTY='48453';
const FN='bdp_parcel_index.parcel_policy_epoch_snapshot_rpc(text,text)';
const OTHER='bdp_parcel_index.approved_sources_rpc(text)';
const PROOF=['exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_index_table_access','no_index_sequence_access',
  'fixed_rpc_execute','no_other_index_rpc'];
export function requirePrivateEpochLoginDisposableOptIn(args) {
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only'){
    throw new Error('Refusing epoch-only SQL login smoke without exact --disposable-only');
  }
  return true;
}
function docker(args,{input,timeout=120_000}={}){
  const p=spawnSync('docker',args,{
    input,encoding:'utf8',timeout,maxBuffer:3*1024*1024,
  });
  if(p.error||p.status!==0)throw new Error('Disposable Docker failed: '+
    String(p.error?.message||p.stderr||p.stdout||'').slice(-1400));
  return p.stdout||'';
}
async function ready(name){
  for(let i=0;i<60;i++){
    const state=docker(['inspect','--format','{{.State.Status}}',name]).trim();
    if(state!=='running')throw Error('Disposable PostGIS exited');
    const logs=spawnSync('docker',['logs',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
    });
    if(logs.status===0&&String(logs.stdout+logs.stderr).includes(READY)){
      const health=spawnSync('docker',[
        'exec',name,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10_000});
      if(health.status===0)return;
    }
    await sleep(1000);
  }
  throw Error('Disposable PostGIS not ready');
}
export async function runPrivateEpochLoginDisposableSmoke(
  args=process.argv.slice(2),
){
  requirePrivateEpochLoginDisposableOptIn(args);
  const name='ldos-epoch-login-test-'+randomBytes(6).toString('hex');
  const postgresPassword=randomBytes(32).toString('hex');
  const loginPassword=randomBytes(32).toString('hex');
  let created=false;
  try{
    docker(['run','-d','--name',name,'--network','none',
      '-e','POSTGRES_PASSWORD='+postgresPassword,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      DRIVER_SMOKE_IMAGE],{timeout:240_000});
    created=true;
    await ready(name);
    const execSql=(statement,asLogin=false)=>spawnSync('docker',[
      'exec','-i',...(asLogin?['-e','PGPASSWORD='+loginPassword]:[]),
      name,'psql','-X','-t','-A','-v','ON_ERROR_STOP=1',
      ...(asLogin?['-h','127.0.0.1','-U',LOGIN]:['-U','postgres']),
      '-d','postgres',
    ],{input:statement,encoding:'utf8',timeout:120_000,maxBuffer:3*1024*1024});
    const sql=(statement,asLogin=false)=>{
      const p=execSql(statement,asLogin);
      if(p.error||p.status!==0)throw Error('Disposable SQL failed: '+
        String(p.error?.message||p.stderr||p.stdout||'').slice(-1700));
      return String(p.stdout||'').trim();
    };
    const denied=(statement)=>{
      const p=execSql(statement,true);
      assert.notEqual(p.status,0,'Epoch-only LOGIN gained unintended privilege');
      assert.match(String(p.stderr),/permission denied/i);
    };
    const file=filename=>readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+filename,import.meta.url),'utf8');
    const query=(county=COUNTY,source=SOURCE)=>{
      assert.match(county,/^48[0-9]{3}$/);
      assert.match(source,/^[a-z][a-z0-9_-]{2,79}$/);
      return "SELECT source_cache_epoch||'|'||publication_epoch FROM "+
        "bdp_parcel_index.parcel_policy_epoch_snapshot_rpc('"+county+"','"+source+"');";
    };
    const read=()=>sql(query(),true);

    sql('SELECT PostGIS_Version();');
    sql(file('parcelIndexFoundation.sql'));
    sql(file('parcelRestrictedRpcFoundation.sql'));
    sql(file('parcelGeometryPublicationRightsFoundation.sql'));
    sql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    sql("INSERT INTO bdp_parcel_index.geometry_publication_reviews "+
      "(source_id,county_fips) VALUES ('"+SOURCE+"','"+COUNTY+"');");
    sql(file('parcelPolicyEpochFoundation.sql'));
    sql(file('parcelPolicyEpochSnapshotRpcFoundation.sql'));

    // Real password LOGIN, NOT a superuser SET ROLE impersonation.
    sql('CREATE ROLE '+LOGIN+' LOGIN NOINHERIT NOSUPERUSER NOCREATEDB '+
      "NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+loginPassword+"';");
    sql('GRANT USAGE ON SCHEMA bdp_parcel_index TO '+LOGIN+';');
    denied(query());
    denied('SELECT epoch FROM bdp_parcel_index.parcel_policy_epochs;');
    denied('SELECT rights_state FROM bdp_parcel_index.source_registry;');
    sql('GRANT EXECUTE ON FUNCTION '+FN+' TO '+LOGIN+';');

    const roleProof=(expected=LOGIN)=>{
      assert.match(expected,/^ldos_parcel_epoch_[a-z][a-z0-9_]{2,31}$/);
      const out=sql('PREPARE ldos_epoch_attest(text) AS '+
        PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL+";\n"+
        "EXECUTE ldos_epoch_attest('"+expected+"');",true);
      const line=out.split(/\r?\n/).find(x=>/^([tf]\|){8}[tf]$/.test(x.trim()));
      assert.ok(line,'Expected nine strict attestation booleans');
      return Object.fromEntries(PROOF.map((k,i)=>[k,line.trim().split('|')[i]==='t']));
    };
    const allTrue=()=>assert.ok(Object.values(roleProof()).every(Boolean),
      'Epoch-only LOGIN must have no extra parcel-index access');
    allTrue();
    assert.equal(roleProof('ldos_parcel_epoch_wrong').exact_login,false);
    assert.equal(read(),'1|1');
    assert.equal(sql(query('48029'),true),'');
    assert.equal(sql(query(COUNTY,'other-source'),true),'');

    // Source cache revoke/reapprove is an ABA transition; the source rights
    // fields return to their original values, but the epoch differs.
    const original=sql("SELECT rights_state,rights_review_reference FROM "+
      "bdp_parcel_index.source_registry WHERE source_id='"+SOURCE+"';");
    sql("UPDATE bdp_parcel_index.source_registry SET rights_state='revoked' "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(read(),'2|1');
    sql("UPDATE bdp_parcel_index.source_registry SET rights_state='approved' "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(sql("SELECT rights_state,rights_review_reference FROM "+
      "bdp_parcel_index.source_registry WHERE source_id='"+SOURCE+"';"),original);
    assert.equal(read(),'3|1');

    // The epoch RPC does NOT assert that currently revoked policy is approved.
    // Publication is separately unreviewed and must not be inferred from 1.
    assert.equal(sql("SELECT review_state FROM "+
      "bdp_parcel_index.geometry_publication_reviews WHERE source_id='"+SOURCE+"';"),
      'unreviewed');
    sql("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='approved',allow_geometry_redistribution=TRUE,"+
      "review_reference='synthetic/epoch-41',"+
      "reviewed_at=clock_timestamp()-interval '2 hours',"+
      "expires_at=clock_timestamp()+interval '2 hours' "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(read(),'3|2');
    sql("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='revoked',allow_geometry_redistribution=FALSE "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(read(),'3|3');
    sql("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='approved',allow_geometry_redistribution=TRUE "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(read(),'3|4');

    // Privilege drift on epoch table or unrelated RPC fails catalog proof.
    sql('GRANT SELECT ON bdp_parcel_index.parcel_policy_epochs TO '+LOGIN+';');
    assert.equal(roleProof().no_index_table_access,false);
    sql('REVOKE SELECT ON bdp_parcel_index.parcel_policy_epochs FROM '+LOGIN+';');
    allTrue();
    sql('GRANT EXECUTE ON FUNCTION '+OTHER+' TO '+LOGIN+';');
    assert.equal(roleProof().no_other_index_rpc,false);
    sql('REVOKE EXECUTE ON FUNCTION '+OTHER+' FROM '+LOGIN+';');
    allTrue();
    denied("SELECT * FROM bdp_parcel_index.approved_sources_rpc('"+COUNTY+"');");

    process.stdout.write(PRIVATE_EPOCH_LOGIN_SMOKE_PASS+'\n');
  }catch(error){
    const logs=created?spawnSync('docker',['logs','--tail','25',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:128*1024,
    }):null;
    const details=String((logs?.stderr||'')+(logs?.stdout||'')).slice(-1200);
    throw new Error(('Disposable epoch-only LOGIN smoke failed: '+
      error.message+'\n'+details)
      .replaceAll(postgresPassword,'[redacted]')
      .replaceAll(loginPassword,'[redacted]').slice(0,3000));
  }finally{
    if(created){
      try{docker(['rm','--force','--volumes',name],{timeout:30_000});}
      catch{process.stderr.write('WARNING: disposable epoch-only cleanup failed\n');}
    }
  }
}
if(process.argv[1]&&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runPrivateEpochLoginDisposableSmoke().catch(e=>{
    process.stderr.write(e.message+'\n');
    process.exitCode=1;
  });
}
