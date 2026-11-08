import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {DRIVER_SMOKE_IMAGE,SYNTHETIC_DRIVER_FIXTURE_SQL} from
  './parcel-pg-driver-disposable-smoke.mjs';
import {EXTRA_SYNTHETIC_PARCELS_SQL} from
  './parcel-geometry-disposable-smoke.mjs';
import {PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL} from
  '../../server/providers/bdp-parcel-current-sealed-run-epoch-db.js';

/**
 * Step 40C-45 -- Disposable password-authenticated, fixed current-sealed-run
 * SQL verification. NO production DB, host ports, mounts, GIS licenses,
 * account/county authentication or client delivery.
 */
export const CURRENT_SEALED_RUN_EPOCH_SMOKE_PASS =
  'PASS: disposable PostGIS current sealed-run epoch LOGIN, exact latest run, stale-run denial and privilege isolation.';
const READY='PostgreSQL init process complete; ready for start up.';
const COUNTY='48453';
const SOURCE='step40c13-synthetic';
const LOGIN='ldos_parcel_run_epoch_test';
const FN='bdp_parcel_index.parcel_current_sealed_run_epoch_rpc(text,text,bigint)';
const KEY=['exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_index_table_access','no_index_sequence_access',
  'fixed_rpc_execute','no_other_index_rpc'];
export function requireCurrentRunEpochDisposableOptIn(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw Error('Refusing current-run epoch SQL smoke without exact --disposable-only');
  return true;
}
function docker(args,{input,timeout=120_000}={}){
  const p=spawnSync('docker',args,{input,encoding:'utf8',
    timeout,maxBuffer:3*1024*1024});
  if(p.error||p.status!==0)throw Error('Disposable Docker failed: '+
    String(p.error?.message||p.stderr||p.stdout||'').slice(-1200));
  return String(p.stdout||'');
}
async function ready(container){
  for(let i=0;i<60;i++){
    if(docker(['inspect','--format','{{.State.Status}}',container]).trim()
      !=='running')throw Error('Isolated PostGIS exited');
    const logs=spawnSync('docker',['logs',container],{
      encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
    });
    if(logs.status===0&&String(logs.stdout+logs.stderr).includes(READY)){
      const ok=spawnSync('docker',[
        'exec',container,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10_000});
      if(ok.status===0)return;
    }
    await sleep(1000);
  }
  throw Error('Isolated PostGIS startup failed');
}
export async function runCurrentRunEpochDisposableSmoke(args=process.argv.slice(2)){
  requireCurrentRunEpochDisposableOptIn(args);
  const container='ldos-current-run-epoch-'+randomBytes(6).toString('hex');
  const postgresPassword=randomBytes(32).toString('hex');
  const loginPassword=randomBytes(32).toString('hex');
  let created=false;
  try{
    docker(['run','-d','--name',container,'--network','none',
      '-e','POSTGRES_PASSWORD='+postgresPassword,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      DRIVER_SMOKE_IMAGE],{timeout:240_000});
    created=true;
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
        String(p.error?.message||p.stderr||p.stdout||'').slice(-1400));
      return String(p.stdout||'').trim();
    };
    const denied=(statement,regex=/permission denied/i)=>{
      const p=execSql(statement,true);
      assert.notEqual(p.status,0,'Unexpected private run SQL access');
      assert.match(String(p.stderr),regex);
    };
    const file=n=>readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+n,import.meta.url),'utf8');
    const lookup=(runId,county=COUNTY,source=SOURCE)=>{
      if(!/^[1-9][0-9]{0,15}$/.test(String(runId))
        ||!/^[0-9]{5}$/.test(county)
        ||!/^[a-z][a-z0-9_-]{2,79}$/.test(source))throw Error('Unsafe test lookup');
      return "SELECT source_id||'|'||county_fips||'|'||run_id||'|'||epoch FROM "+
        "bdp_parcel_index.parcel_current_sealed_run_epoch_rpc('"+
        county+"','"+source+"',"+runId+");";
    };
    sql('SELECT PostGIS_Version();');
    sql(file('parcelIndexFoundation.sql'));
    sql(file('parcelRestrictedRpcFoundation.sql'));
    sql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    sql(EXTRA_SYNTHETIC_PARCELS_SQL);
    sql(file('parcelRunSealFoundation.sql'));
    sql(file('parcelRunSelectionEpochFoundation.sql'));
    sql(file('parcelCurrentSealedRunEpochRpcFoundation.sql'));
    const runId=sql("SELECT id FROM bdp_parcel_index.ingest_runs "+
      "WHERE source_id='"+SOURCE+"' AND source_version='v1';");
    assert.match(runId,/^[1-9][0-9]*$/);
    const read=()=>sql(lookup(runId),true);
    const epoch=()=>BigInt(sql('SELECT epoch FROM '+
      "bdp_parcel_index.parcel_run_selection_epochs WHERE source_id='"+
      SOURCE+"' AND county_fips='"+COUNTY+"';"));
    assert.equal(epoch(),1n);

    sql('CREATE ROLE '+LOGIN+' LOGIN NOINHERIT NOSUPERUSER NOCREATEDB '+
      "NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+loginPassword+"';");
    sql('GRANT USAGE ON SCHEMA bdp_parcel_index TO '+LOGIN+';');
    denied(lookup(runId));
    denied('SELECT epoch FROM bdp_parcel_index.parcel_run_selection_epochs;');
    denied('SELECT * FROM bdp_parcel_index.parcel_run_seals;');
    sql('GRANT EXECUTE ON FUNCTION '+FN+' TO '+LOGIN+';');
    const roleProof=()=>{
      const out=sql('PREPARE ldos_run_epoch_attest(text) AS '+
        PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL+";\n"+
        "EXECUTE ldos_run_epoch_attest('"+LOGIN+"');",true);
      const found=out.split(/\r?\n/).find(x=>/^([tf]\|){8}[tf]$/.test(x.trim()));
      assert.ok(found,'Nine strict database role proof booleans required');
      return Object.fromEntries(KEY.map((k,i)=>[k,found.trim().split('|')[i]==='t']));
    };
    const prove=()=>assert.ok(Object.values(roleProof()).every(Boolean),
      'Current-run epoch identity has excess SQL privilege');
    prove();
    assert.equal(read(),'','Unsealed run cannot be verified');
    sql("INSERT INTO bdp_parcel_index.parcel_run_seals "+
      "(ingest_run_id,source_id,county_fips,source_version,indexed_records) "+
      "VALUES ("+runId+",'"+SOURCE+"','"+COUNTY+"','v1',3);");
    assert.equal(epoch(),2n);
    assert.equal(read(),SOURCE+'|'+COUNTY+'|'+runId+'|2');
    assert.equal(sql(lookup(runId,'48029'),true),'');
    assert.equal(sql(lookup(runId,COUNTY,'other-source'),true),'');
    assert.equal(sql(lookup('999999'),true),'');
    assert.equal(sql("SELECT rights_state FROM bdp_parcel_index.source_registry "+
      "WHERE source_id='"+SOURCE+"';"),'approved');
    // Even an unrelated unfinished running ingest does not replace the
    // latest FINISHED and sealed version, but increments the run epoch.
    sql("INSERT INTO bdp_parcel_index.ingest_runs (source_id,source_version) "+
      "VALUES ('"+SOURCE+"','synthetic-running');");
    assert.equal(epoch(),3n);
    assert.equal(read(),SOURCE+'|'+COUNTY+'|'+runId+'|3');

    // Newer FINISHED but failed run must NEVER expose older sealed run.
    sql("UPDATE bdp_parcel_index.ingest_runs SET outcome='failed',"+
      "finished_at=clock_timestamp()+interval '1 hour' "+
      "WHERE source_id='"+SOURCE+"' AND source_version='synthetic-running';");
    assert.equal(epoch(),4n);
    assert.equal(read(),'','Older sealed source cannot silently win after newer failed run');

    // Extra privilege added by mistake invalidates role attestation.
    sql('GRANT SELECT ON bdp_parcel_index.parcel_run_selection_epochs TO '+LOGIN+';');
    assert.equal(roleProof().no_index_table_access,false);
    sql('REVOKE SELECT ON bdp_parcel_index.parcel_run_selection_epochs FROM '+LOGIN+';');
    prove();
    denied('SELECT * FROM bdp_parcel_index.ingest_runs;');
    process.stdout.write(CURRENT_SEALED_RUN_EPOCH_SMOKE_PASS+'\n');
  }catch(error){
    const log=created?spawnSync('docker',['logs','--tail','25',container],{
      encoding:'utf8',timeout:10_000,maxBuffer:128*1024,
    }):null;
    const details=String((log?.stderr||'')+(log?.stdout||'')).slice(-1100);
    throw Error(('Disposable current-run epoch failure: '+error.message+
      '\n'+details).replaceAll(loginPassword,'[redacted]')
      .replaceAll(postgresPassword,'[redacted]').slice(0,2900));
  }finally{
    if(created){
      try{docker(['rm','--force','--volumes',container],{timeout:30_000});}
      catch{process.stderr.write('WARNING: disposable current-run container cleanup failed\n');}
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runCurrentRunEpochDisposableSmoke().catch(e=>{
    process.stderr.write(e.message+'\n');process.exitCode=1;
  });
}
