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
import {EXTRA_SYNTHETIC_PARCELS_SQL} from
  './parcel-geometry-disposable-smoke.mjs';

/**
 * Step 40C-43 — one fresh disposable PostGIS for two independent, synthetic,
 * unmounted epoch authorities. This is NOT a real application account store,
 * GIS license, run-epoch RPC, concurrent race/driver test or deployment.
 */
export const SESSION_RUN_EPOCH_SMOKE_PASS =
  'PASS: disposable PostGIS session/county and sealed-run epochs reject ABA, rollback and TRUNCATE.';
const DIGEST='a'.repeat(64);
const COUNTY='48453';
const SOURCE='step40c13-synthetic';
const READY='PostgreSQL init process complete; ready for start up.';
export function requireSessionRunEpochDisposableOptIn(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw new Error('Refusing session/run epoch smoke without exact --disposable-only');
  return true;
}
function docker(args,{input,timeout=120_000}={}){
  const p=spawnSync('docker',args,{input,encoding:'utf8',
    timeout,maxBuffer:3*1024*1024});
  if(p.error||p.status!==0)throw Error('Disposable Docker failed: '+
    String(p.error?.message||p.stderr||p.stdout||'').slice(-1300));
  return String(p.stdout||'');
}
async function ready(name){
  for(let i=0;i<60;i++){
    const status=docker(['inspect','--format','{{.State.Status}}',name]).trim();
    if(status!=='running')throw Error('Disposable PostGIS exited');
    const logs=spawnSync('docker',['logs',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:1024*1024});
    if(logs.status===0&&String(logs.stdout+logs.stderr).includes(READY)){
      const health=spawnSync('docker',[
        'exec',name,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10_000});
      if(health.status===0)return;
    }
    await sleep(1000);
  }
  throw Error('Disposable PostGIS did not initialize');
}
export async function runSessionRunEpochDisposableSmoke(
  args=process.argv.slice(2),
){
  requireSessionRunEpochDisposableOptIn(args);
  const name='ldos-session-run-epochs-'+randomBytes(6).toString('hex');
  const password=randomBytes(32).toString('hex');
  let created=false;
  try{
    docker(['run','-d','--name',name,'--network','none',
      '-e','POSTGRES_PASSWORD='+password,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      DRIVER_SMOKE_IMAGE],{timeout:240_000});
    created=true;
    await ready(name);
    const execSql=statement=>spawnSync('docker',[
      'exec','-i',name,'psql','-X','-t','-A','-v','ON_ERROR_STOP=1',
      '-U','postgres','-d','postgres',
    ],{input:statement,encoding:'utf8',timeout:120_000,maxBuffer:3*1024*1024});
    const sql=statement=>{
      const p=execSql(statement);
      if(p.error||p.status!==0)throw Error('Disposable SQL failed: '+
        String(p.error?.message||p.stderr||p.stdout||'').slice(-1600));
      return String(p.stdout||'').trim();
    };
    const denied=(statement,regex)=>{
      const p=execSql(statement);
      assert.notEqual(p.status,0,'Denied session/run epoch change unexpectedly succeeded');
      assert.match(String(p.stderr),regex);
    };
    const file=filename=>readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+filename,import.meta.url),'utf8');
    const sessionEpoch=()=>BigInt(sql("SELECT epoch FROM "+
      "ldos_private_auth.session_county_epochs WHERE session_digest='"+DIGEST+
      "' AND county_fips='"+COUNTY+"';"));
    const runEpoch=()=>BigInt(sql("SELECT epoch FROM "+
      "bdp_parcel_index.parcel_run_selection_epochs WHERE source_id='"+SOURCE+
      "' AND county_fips='"+COUNTY+"';"));
    const grantState=()=>sql("SELECT account_active,mfa_verified,session_active,allow_discovery "+
      "FROM ldos_private_auth.session_county_decisions WHERE session_digest='"+
      DIGEST+"' AND county_fips='"+COUNTY+"';");

    sql('SELECT PostGIS_Version();');
    sql(file('parcelIndexFoundation.sql'));
    sql(file('parcelRestrictedRpcFoundation.sql'));
    sql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    sql(EXTRA_SYNTHETIC_PARCELS_SQL);
    sql(file('parcelRunSealFoundation.sql'));
    sql(file('parcelSessionCountyEpochFoundation.sql'));
    sql(file('parcelRunSelectionEpochFoundation.sql'));

    // Existing ingest run history backfills 1; never fabricate transitions.
    assert.equal(runEpoch(),1n);
    assert.equal(sql("SELECT count(*) FROM ldos_private_auth.session_county_decisions;"),'0');
    sql("INSERT INTO ldos_private_auth.session_county_decisions "+
      "(session_digest,county_fips) VALUES ('"+DIGEST+"','"+COUNTY+"');");
    assert.equal(sessionEpoch(),1n);
    assert.equal(grantState(),'f|f|f|f','Synthetic permissions must default deny');

    sql("UPDATE ldos_private_auth.session_county_decisions SET "+
      "account_active=TRUE,mfa_verified=TRUE,session_active=TRUE,"+
      "allow_discovery=TRUE WHERE session_digest='"+DIGEST+"';");
    assert.equal(sessionEpoch(),2n);
    const approved=grantState();
    sql("UPDATE ldos_private_auth.session_county_decisions SET "+
      "allow_discovery=FALSE WHERE session_digest='"+DIGEST+"';");
    assert.equal(sessionEpoch(),3n);
    sql("UPDATE ldos_private_auth.session_county_decisions SET "+
      "allow_discovery=TRUE WHERE session_digest='"+DIGEST+"';");
    assert.equal(grantState(),approved,'ABA returns identical grant facts');
    assert.equal(sessionEpoch(),4n,'Reapprove cannot reuse session/county revision');

    sql('BEGIN;\n'+"UPDATE ldos_private_auth.session_county_decisions SET "+
      "session_active=FALSE WHERE session_digest='"+DIGEST+"';\nROLLBACK;");
    assert.equal(sessionEpoch(),4n,'Rolled-back revoke does not publish an epoch');
    assert.equal(grantState(),approved);
    denied("UPDATE ldos_private_auth.session_county_decisions SET "+
      "session_digest='"+'b'.repeat(64)+"' WHERE session_digest='"+DIGEST+"';",
      /Session grant identity cannot change/);
    denied('TRUNCATE ldos_private_auth.session_county_decisions;',
      /Session grant TRUNCATE prohibited/);
    assert.equal(sessionEpoch(),4n);
    sql("DELETE FROM ldos_private_auth.session_county_decisions "+
      "WHERE session_digest='"+DIGEST+"';");
    assert.equal(sessionEpoch(),5n);
    sql("INSERT INTO ldos_private_auth.session_county_decisions "+
      "(session_digest,county_fips) VALUES ('"+DIGEST+"','"+COUNTY+"');");
    assert.equal(sessionEpoch(),6n);
    assert.equal(grantState(),'f|f|f|f');

    // Run-selection epoch advances on changes to unsealed ingest runs AND
    // new seals; the immutability guard still controls sealed run mutation.
    const runId=sql('SELECT id FROM bdp_parcel_index.ingest_runs '+
      "WHERE source_id='"+SOURCE+"' AND source_version='v1';");
    assert.match(runId,/^[1-9][0-9]*$/);
    sql('UPDATE bdp_parcel_index.ingest_runs SET source_notes=source_notes '+
      'WHERE id='+runId+';');
    assert.equal(runEpoch(),2n);
    sql("INSERT INTO bdp_parcel_index.parcel_run_seals "+
      "(ingest_run_id,source_id,county_fips,source_version,indexed_records) "+
      "VALUES ("+runId+",'"+SOURCE+"','"+COUNTY+"','v1',3);");
    assert.equal(runEpoch(),3n,'Sealing a run bumps source/run-selection epoch');
    denied('UPDATE bdp_parcel_index.ingest_runs SET source_notes=source_notes '+
      'WHERE id='+runId+';',/Sealed parcel run is immutable/);
    assert.equal(runEpoch(),3n);

    sql("INSERT INTO bdp_parcel_index.ingest_runs (source_id,source_version) "+
      "VALUES ('"+SOURCE+"','synthetic-later');");
    assert.equal(runEpoch(),4n);
    sql("DELETE FROM bdp_parcel_index.ingest_runs "+
      "WHERE source_id='"+SOURCE+"' AND source_version='synthetic-later';");
    assert.equal(runEpoch(),5n,'Delete must retain revision history');
    sql('BEGIN;\n'+"INSERT INTO bdp_parcel_index.ingest_runs "+
      "(source_id,source_version) VALUES ('"+SOURCE+"','rolled-back');\nROLLBACK;");
    assert.equal(runEpoch(),5n);
    denied('TRUNCATE bdp_parcel_index.ingest_runs CASCADE;',
      /Run selection TRUNCATE prohibited/);
    denied('TRUNCATE bdp_parcel_index.parcel_run_seals;',
      /Run selection TRUNCATE prohibited/);
    assert.equal(runEpoch(),5n);

    // Test identity cannot even read the sealed-run/session epoch tables.
    sql('CREATE ROLE ldos_epoch_probe NOLOGIN NOINHERIT;');
    sql('GRANT USAGE ON SCHEMA ldos_private_auth TO ldos_epoch_probe;');
    sql('GRANT USAGE ON SCHEMA bdp_parcel_index TO ldos_epoch_probe;');
    for(const table of [
      'ldos_private_auth.session_county_epochs',
      'ldos_private_auth.session_county_decisions',
      'bdp_parcel_index.parcel_run_selection_epochs',
      'bdp_parcel_index.parcel_run_seals',
    ]){
      assert.equal(sql("SELECT has_table_privilege('ldos_epoch_probe','"+
        table+"','SELECT');"),'f');
      denied('BEGIN READ ONLY;\nSET LOCAL ROLE ldos_epoch_probe;\n'+
        'SELECT * FROM '+table+' LIMIT 1;',/permission denied/i);
    }
    process.stdout.write(SESSION_RUN_EPOCH_SMOKE_PASS+'\n');
  }catch(error){
    const logs=created?spawnSync('docker',['logs','--tail','30',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:128*1024}):null;
    const details=String((logs?.stderr||'')+(logs?.stdout||'')).slice(-1200);
    throw Error(('Disposable session/run epochs smoke failed: '+
      error.message+'\n'+details).replaceAll(password,'[redacted]').slice(0,3000));
  }finally{
    if(created){
      try{docker(['rm','--force','--volumes',name],{timeout:30_000});}
      catch{process.stderr.write('WARNING: disposable session/run cleanup failed\n');}
    }
  }
}
if(process.argv[1]&&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runSessionRunEpochDisposableSmoke().catch(error=>{
    process.stderr.write(error.message+'\n');process.exitCode=1;
  });
}
