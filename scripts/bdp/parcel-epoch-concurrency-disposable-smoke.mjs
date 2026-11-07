import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {DRIVER_SMOKE_IMAGE,SYNTHETIC_DRIVER_FIXTURE_SQL} from
  './parcel-pg-driver-disposable-smoke.mjs';

/**
 * Step 40C-44: TRUE overlapping PostgreSQL transactions over synthetic
 * session/county, publication-review and run-selection epoch rows.
 *
 * Explicit opt-in, disposable single PostGIS with --network none;
 * NO ports, mounts, persistent volumes or existing BDP database.
 * Two separate psql BACKENDS are held open while a third independently
 * verifies the row lock and old committed epoch. This is a database
 * concurrency regression, NOT a real identity provider, licensed county
 * geometry, production authentication or atomic HTTP release gate.
 */
export const EPOCH_CONCURRENT_SMOKE_PASS =
  'PASS: disposable PostGIS concurrent epoch writers serialize, ABA increments and rollback preserves committed state.';
const COUNTY='48453';
const SOURCE='step40c13-synthetic';
const DIGEST='d'.repeat(64);
const READY='PostgreSQL init process complete; ready for start up.';
export function requireEpochConcurrentDisposableOptIn(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw new Error('Refusing concurrent epoch SQL smoke without exact --disposable-only');
  return true;
}
function docker(args,{input,timeout=120_000}={}){
  const p=spawnSync('docker',args,{
    input,encoding:'utf8',timeout,maxBuffer:3*1024*1024,
  });
  if(p.error||p.status!==0)throw new Error('Disposable Docker failed: '+
    String(p.error?.message||p.stderr||p.stdout||'').slice(-1300));
  return String(p.stdout||'');
}
async function ready(container){
  for(let i=0;i<60;i++){
    const status=docker(['inspect','--format','{{.State.Status}}',container]).trim();
    if(status!=='running')throw new Error('Disposable PostGIS exited');
    const log=spawnSync('docker',['logs',container],{
      encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
    });
    if(log.status===0&&String(log.stdout+log.stderr).includes(READY)){
      const health=spawnSync('docker',[
        'exec',container,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10_000});
      if(health.status===0)return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable PostGIS did not initialize');
}

/**
 * Stream commands to a LIVE PostgreSQL backend. Do not use one long SQL
 * script or pg_sleep timers: the first transaction must remain open until
 * the second process is confirmed waiting on the *real PostgreSQL lock*.
 */
export function createDisposableEpochSqlWorker(container){
  if(typeof container!=='string'||!/^ldos-epoch-concurrency-[0-9a-f]{12}$/.test(container))
    throw new TypeError('Only a fresh isolated epoch-concurrency container is accepted');
  const child=spawn('docker',[
    'exec','-i',container,'psql','-X','-q','-t','-A',
    '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres',
  ],{stdio:['pipe','pipe','pipe']});
  let output='',errors='',exited=false;
  const watchers=new Set();
  const notify=()=>{for(const callback of [...watchers])callback();};
  child.stdout.on('data',chunk=>{
    output+=String(chunk);
    if(output.length>20_000)output=output.slice(-20_000);
    notify();
  });
  child.stderr.on('data',chunk=>{
    errors+=String(chunk);
    if(errors.length>2000)errors=errors.slice(-2000);
    notify();
  });
  child.on('error',error=>{
    errors+=String(error.message).slice(-500);exited=true;notify();
  });
  child.on('exit',code=>{
    exited=true;
    errors+=' psql-exit='+code;
    notify();
  });
  const send=statement=>{
    if(exited||!child.stdin.writable||typeof statement!=='string'
      ||statement.length>2000)throw new Error('Disposable SQL worker unavailable');
    child.stdin.write(statement+'\n');
  };
  const until=(marker,timeout=15_000)=>new Promise((done,fail)=>{
    if(typeof marker!=='string'||!/^[A-Z_0-9:=]+$/.test(marker))
      return fail(new TypeError('Unsafe marker'));
    let timer;
    const cleanup=()=>{clearTimeout(timer);watchers.delete(check);};
    const check=()=>{
      if(output.includes(marker)){cleanup();done(output);return;}
      if(exited){cleanup();fail(new Error('Disposable SQL backend exited: '+errors));}
    };
    watchers.add(check);
    timer=setTimeout(()=>{
      cleanup();fail(new Error('Timed out waiting for PostgreSQL backend: '+errors));
    },timeout);
    check();
  });
  return Object.freeze({
    send,until,
    get output(){return output;},
    async pid(){
      send("SELECT 'LDO_PID=' || pg_catalog.pg_backend_pid();\n\\echo LDO_PID_READY");
      const result=await until('LDO_PID_READY');
      const m=result.match(/LDO_PID=([1-9][0-9]*)/);
      if(!m)throw Error('Missing real PostgreSQL backend PID');
      return Number(m[1]);
    },
    close(){
      if(!exited){
        try{child.stdin.write('ROLLBACK;\n\\q\n');child.stdin.end();}
        catch{/* discard */}
        // Cleanup is guaranteed again by Docker container removal.
      }
    },
  });
}

export async function runEpochConcurrentDisposableSmoke(
  args=process.argv.slice(2),
){
  requireEpochConcurrentDisposableOptIn(args);
  const container='ldos-epoch-concurrency-'+randomBytes(6).toString('hex');
  const password=randomBytes(32).toString('hex');
  let created=false;
  const workers=[];
  try{
    docker(['run','-d','--name',container,'--network','none',
      '-e','POSTGRES_PASSWORD='+password,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      DRIVER_SMOKE_IMAGE],{timeout:240_000});
    created=true;
    await ready(container);
    const execSql=statement=>spawnSync('docker',[
      'exec','-i',container,'psql','-X','-q','-t','-A',
      '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres',
    ],{input:statement,encoding:'utf8',timeout:120_000,maxBuffer:3*1024*1024});
    const sql=statement=>{
      const p=execSql(statement);
      if(p.error||p.status!==0)throw new Error('Disposable SQL failed: '+
        String(p.error?.message||p.stderr||p.stdout||'').slice(-1200));
      return String(p.stdout||'').trim();
    };
    const file=filename=>readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+filename,import.meta.url),'utf8');
    const epoch=(qualifiedTable,predicate)=>{
      if(![
        'ldos_private_auth.session_county_epochs',
        'bdp_parcel_index.parcel_policy_epochs',
        'bdp_parcel_index.parcel_run_selection_epochs',
      ].includes(qualifiedTable))throw Error('Unrecognized synthetic epoch table');
      const result=sql('SELECT epoch FROM '+qualifiedTable+' WHERE '+predicate+';');
      assert.match(result,/^[1-9][0-9]*$/);
      return BigInt(result);
    };
    const sessionKey="session_digest='"+DIGEST+"' AND county_fips='"+COUNTY+"'";
    const sourceKey="source_id='"+SOURCE+"' AND county_fips='"+COUNTY+"'";
    const publicationKey="policy_scope='geometry_publication' AND source_id='"+SOURCE+"'";
    sql('SELECT PostGIS_Version();');
    for(const foundation of [
      'parcelIndexFoundation.sql','parcelRestrictedRpcFoundation.sql',
      'parcelGeometryPublicationRightsFoundation.sql',
    ])sql(file(foundation));
    sql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    sql("INSERT INTO bdp_parcel_index.geometry_publication_reviews "+
      "(source_id,county_fips) VALUES ('"+SOURCE+"','"+COUNTY+"');");
    for(const foundation of [
      'parcelRunSealFoundation.sql',
      'parcelPolicyEpochFoundation.sql',
      'parcelSessionCountyEpochFoundation.sql',
      'parcelRunSelectionEpochFoundation.sql',
    ])sql(file(foundation));
    sql('INSERT INTO ldos_private_auth.session_county_decisions '+
      "(session_digest,county_fips,account_active,mfa_verified,session_active,allow_discovery) "+
      "VALUES ('"+DIGEST+"','"+COUNTY+"',TRUE,TRUE,TRUE,TRUE);");
    const runId=sql("SELECT id FROM bdp_parcel_index.ingest_runs "+
      "WHERE source_id='"+SOURCE+"' AND source_version='v1';");
    assert.match(runId,/^[1-9][0-9]*$/);
    const cases=[
      {
        id:'SESSION',
        epoch:()=>epoch('ldos_private_auth.session_county_epochs',sessionKey),
        fact:()=>sql("SELECT allow_discovery FROM ldos_private_auth.session_county_decisions WHERE "+
          sessionKey+';'),
        first:"UPDATE ldos_private_auth.session_county_decisions SET allow_discovery=FALSE WHERE "+sessionKey+';',
        second:"UPDATE ldos_private_auth.session_county_decisions SET allow_discovery=TRUE WHERE "+sessionKey+';',
        original:'t',intermediate:'f',
      },
      {
        id:'PUBLICATION',
        epoch:()=>epoch('bdp_parcel_index.parcel_policy_epochs',publicationKey),
        fact:()=>sql("SELECT review_state FROM bdp_parcel_index.geometry_publication_reviews "+
          "WHERE source_id='"+SOURCE+"';"),
        first:"UPDATE bdp_parcel_index.geometry_publication_reviews SET review_state='revoked' "+
          "WHERE source_id='"+SOURCE+"';",
        second:"UPDATE bdp_parcel_index.geometry_publication_reviews SET review_state='unreviewed' "+
          "WHERE source_id='"+SOURCE+"';",
        original:'unreviewed',intermediate:'revoked',
      },
      {
        id:'RUN',
        epoch:()=>epoch('bdp_parcel_index.parcel_run_selection_epochs',sourceKey),
        fact:()=>sql('SELECT COALESCE(source_notes,\'\') FROM bdp_parcel_index.ingest_runs WHERE id='+runId+';'),
        first:"UPDATE bdp_parcel_index.ingest_runs SET source_notes='concurrent-change' WHERE id="+runId+';',
        second:'UPDATE bdp_parcel_index.ingest_runs SET source_notes=NULL WHERE id='+runId+';',
        original:'',intermediate:'concurrent-change',
      },
    ];
    const lockWait=async(pid,worker,caseId)=>{
      // Back-end wait_event_type = 'Lock' is checked independently
      // rather than declaring a race proven from sleeps or timestamps.
      for(let n=0;n<100;n++){
        const waiting=sql("SELECT COALESCE(wait_event_type,'') "+
          "FROM pg_catalog.pg_stat_activity WHERE pid="+pid+";");
        if(waiting==='Lock')return;
        // If second UPDATE finished while the first still holds its
        // uncommitted lock, a serialization invariant has been violated.
        if(worker.output?.includes('SECOND_WRITTEN_'+caseId))
          throw Error('Second writer escaped the first lock');
        await sleep(100);
      }
      throw Error('Second PostgreSQL backend never entered Lock wait: '+caseId);
    };
    async function concurrentChange(item,rollbackFirst=false){
      const label=item.id+(rollbackFirst?'_ROLLBACK':'_COMMIT');
      const initial=item.epoch();
      assert.equal(item.fact(),item.original,'Synthetic initial facts unexpected');
      const first=createDisposableEpochSqlWorker(container);
      const second=createDisposableEpochSqlWorker(container);
      workers.push(first,second);
      const secondPid=await second.pid();
      await first.pid();
      first.send("BEGIN;\nSET LOCAL lock_timeout='25s';\n"+item.first+
        '\n\\echo FIRST_WRITTEN_'+label);
      await first.until('FIRST_WRITTEN_'+label);
      // Both the initial rights facts and their epoch remain committed
      // and visible to third-party READ COMMITTED readers at this point.
      assert.equal(item.epoch(),initial,'Uncommitted epoch leaked');
      assert.equal(item.fact(),item.original,'Uncommitted rights change leaked');

      second.send("BEGIN;\nSET LOCAL lock_timeout='25s';\n"+item.second+
        '\n\\echo SECOND_WRITTEN_'+label);
      await lockWait(secondPid,second,label);
      assert.equal(item.epoch(),initial,'Waiting second writer leaked epoch');
      assert.equal(item.fact(),item.original,'Waiting writer leaked rights change');

      first.send((rollbackFirst?'ROLLBACK;':'COMMIT;')+
        '\n\\echo FIRST_FINISHED_'+label);
      await first.until('FIRST_FINISHED_'+label);
      await second.until('SECOND_WRITTEN_'+label);
      assert.equal(item.epoch(),initial+(rollbackFirst?0n:1n),
        'Uncommitted second bump visible before its COMMIT');
      assert.equal(item.fact(),rollbackFirst?item.original:item.intermediate);
      second.send('COMMIT;\n\\echo SECOND_FINISHED_'+label);
      await second.until('SECOND_FINISHED_'+label);
      const final=item.epoch();
      assert.equal(final,initial+(rollbackFirst?1n:2n),
        'Concurrent updates must serialize the committed epoch');
      assert.equal(item.fact(),item.original,
        'A→B→A returns identical facts but NOT the original version');
      first.close();second.close();
    }

    // Two genuinely overlapping committed writes for each independent
    // rights/grant/run domain. A subsequent revoked→restored policy MUST
    // retain a changed durable epoch.
    for(const item of cases)await concurrentChange(item);
    // A rolled-back first transaction must not leave an epoch increment;
    // the second writer still commits exactly one new revision.
    await concurrentChange(cases[0],true);
    process.stdout.write(EPOCH_CONCURRENT_SMOKE_PASS+'\n');
  }catch(error){
    const logs=created?spawnSync('docker',['logs','--tail','30',container],{
      encoding:'utf8',timeout:10_000,maxBuffer:128*1024,
    }):null;
    const details=String((logs?.stderr||'')+(logs?.stdout||'')).slice(-1200);
    throw new Error(('Disposable concurrent epoch SQL smoke failed: '+
      error.message+'\n'+details).replaceAll(password,'[redacted]').slice(0,3000));
  }finally{
    for(const worker of workers)try{worker.close();}catch{/* discard */}
    if(created){
      try{docker(['rm','--force','--volumes',container],{timeout:30_000});}
      catch{process.stderr.write('WARNING: disposable concurrency container cleanup failed\n');}
    }
  }
}
if(process.argv[1]&&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runEpochConcurrentDisposableSmoke().catch(error=>{
    process.stderr.write(error.message+'\n');process.exitCode=1;
  });
}
