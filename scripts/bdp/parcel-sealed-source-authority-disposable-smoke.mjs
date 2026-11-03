import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  DRIVER_SMOKE_IMAGE, SYNTHETIC_DRIVER_FIXTURE_SQL,
} from './parcel-pg-driver-disposable-smoke.mjs';
import { EXTRA_SYNTHETIC_PARCELS_SQL } from './parcel-geometry-disposable-smoke.mjs';

/**
 * Step 40C-34: strictly opt-in, wholly disposable synthetic PostGIS test.
 * Never connects to a real/local BDP database; uses NO ports, mounts or
 * Docker networking. All grants are confined to a one-use NOLOGIN role.
 * Even a passing smoke does NOT grant GIS publication, login or HTTP access.
 */
export const SEALED_SOURCE_AUTHORITY_SUCCESS =
  'PASS: disposable PostGIS sealed-source authority, isolated EXECUTE, latest-run gating and revocation.';
export const SEALED_SOURCE_AUTHORITY_PROBE_ROLE = 'ldos_sealed_authority_probe';
export const SEALED_SOURCE_AUTHORITY_SIGNATURE =
  'bdp_parcel_index.parcel_sealed_source_authority_rpc(text)';
const SOURCE='step40c13-synthetic';
const COUNTY='48453';
const READY='PostgreSQL init process complete; ready for start up.';

export function requireSealedSourceAuthorityOptIn(args) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing sealed-source smoke without EXACT --disposable-only');
  }
  return true;
}
function docker(args,{input,timeout=120_000}={}) {
  const p=spawnSync('docker',args,{
    input,encoding:'utf8',timeout,maxBuffer:3*1024*1024,
  });
  if(p.error || p.status!==0) throw new Error('Disposable Docker failed: '+
    String(p.error?.message || p.stderr || p.stdout || '').slice(-1300));
  return p.stdout || '';
}
async function ready(name) {
  for(let i=0;i<60;i++) {
    const status=docker(['inspect','--format','{{.State.Status}}',name]).trim();
    if(status!=='running') throw new Error('Disposable PostGIS exited');
    const p=spawnSync('docker',['logs',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
    });
    if(p.status===0 && String(p.stdout+p.stderr).includes(READY)) {
      const probe=spawnSync('docker',[
        'exec',name,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10_000});
      if(probe.status===0) return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable PostGIS failed readiness');
}

export async function runSealedSourceAuthorityDisposableSmoke(
  args=process.argv.slice(2),
) {
  requireSealedSourceAuthorityOptIn(args);
  const name='ldos-sealed-source-smoke-'+randomBytes(6).toString('hex');
  const password=randomBytes(32).toString('hex');
  let created=false;
  try {
    docker(['run','-d','--name',name,'--network','none',
      '-e','POSTGRES_PASSWORD='+password,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      DRIVER_SMOKE_IMAGE],{timeout:240_000});
    created=true;
    await ready(name);

    const execSql=(sql)=>spawnSync('docker',[
      'exec','-i',name,'psql','-X','-t','-A',
      '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres',
    ],{input:sql,encoding:'utf8',timeout:120_000,maxBuffer:3*1024*1024});
    const runSql=(sql)=>{
      const p=execSql(sql);
      if(p.error || p.status!==0) throw new Error('Disposable SQL failed: '+
        String(p.error?.message || p.stderr || p.stdout || '').slice(-1600));
      return p.stdout.trim();
    };
    const rejectSql=(sql)=>{
      const p=execSql(sql);
      assert.notEqual(p.status,0,'Unauthorized synthetic SQL unexpectedly succeeded');
      assert.match(String(p.stderr),/permission denied/i);
    };
    const file=(basename)=>readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+basename,import.meta.url),'utf8');

    runSql('SELECT PostGIS_Version();');
    runSql(file('parcelIndexFoundation.sql'));
    runSql(file('parcelRestrictedRpcFoundation.sql'));
    runSql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    runSql(EXTRA_SYNTHETIC_PARCELS_SQL);
    runSql(file('parcelRunSealFoundation.sql'));
    runSql(file('parcelSealedSourceAuthorityRpcFoundation.sql'));

    // No PUBLIC, browser, or metadata role may EXECUTE the authority RPC.
    assert.equal(runSql("SELECT has_function_privilege('ldos_parcel_rpc_client',"+
      "'"+SEALED_SOURCE_AUTHORITY_SIGNATURE+"','EXECUTE');"),'f');
    const probe="SELECT count(*) FROM "+
      "bdp_parcel_index.parcel_sealed_source_authority_rpc('"+COUNTY+"');";
    rejectSql('BEGIN READ ONLY;\nSET LOCAL ROLE ldos_parcel_rpc_client;\n'+probe);

    runSql('CREATE ROLE '+SEALED_SOURCE_AUTHORITY_PROBE_ROLE+
      ' NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;\n'+
      'GRANT USAGE ON SCHEMA bdp_parcel_index TO '+
      SEALED_SOURCE_AUTHORITY_PROBE_ROLE+';');
    rejectSql('BEGIN READ ONLY;\nSET LOCAL ROLE '+
      SEALED_SOURCE_AUTHORITY_PROBE_ROLE+';\n'+probe);
    runSql('GRANT EXECUTE ON FUNCTION '+SEALED_SOURCE_AUTHORITY_SIGNATURE+
      ' TO '+SEALED_SOURCE_AUTHORITY_PROBE_ROLE+';');
    assert.equal(runSql("SELECT has_function_privilege('"+
      SEALED_SOURCE_AUTHORITY_PROBE_ROLE+"','"+
      SEALED_SOURCE_AUTHORITY_SIGNATURE+"','EXECUTE'),"+
      "has_table_privilege('"+SEALED_SOURCE_AUTHORITY_PROBE_ROLE+
      "','bdp_parcel_index.source_registry','SELECT'),"+
      "has_table_privilege('"+SEALED_SOURCE_AUTHORITY_PROBE_ROLE+
      "','bdp_parcel_index.parcel_run_seals','SELECT');"),'t|f|f');
    rejectSql('BEGIN READ ONLY;\nSET LOCAL ROLE '+
      SEALED_SOURCE_AUTHORITY_PROBE_ROLE+
      ';\nSELECT source_id FROM bdp_parcel_index.source_registry;');

    const asRole=(sql)=>runSql('BEGIN READ ONLY;\nSET LOCAL ROLE '+
      SEALED_SOURCE_AUTHORITY_PROBE_ROLE+';\n'+sql+'\nROLLBACK;');
    const count=(county=COUNTY)=>{
      assert.match(county,/^48[0-9]{3}$/);
      const statement="SELECT count(*) FROM "+
        "bdp_parcel_index.parcel_sealed_source_authority_rpc('"+county+"');";
      const output=asRole(statement).split(/\r?\n/).map(s=>s.trim());
      const numeric=output.find(s=>/^\d+$/.test(s));
      assert.ok(numeric,'Expected a bounded count');
      return Number(numeric);
    };

    // A completed run with rows is NOT sufficient without the run seal.
    assert.equal(count(),0);
    const runId=runSql('SELECT id FROM bdp_parcel_index.ingest_runs '+
      "WHERE source_id='"+SOURCE+"' AND source_version='v1';");
    assert.match(runId,/^[1-9][0-9]*$/);
    assert.equal(runSql('SELECT count(*) FROM bdp_parcel_index.parcel_versions '+
      'WHERE ingest_run_id='+runId+';'),'3');
    runSql('INSERT INTO bdp_parcel_index.parcel_run_seals '+
      '(ingest_run_id,source_id,county_fips,source_version,indexed_records) '+
      "VALUES ("+runId+",'"+SOURCE+"','"+COUNTY+"','v1',3);");
    assert.equal(count(),1);
    assert.equal(count('48029'),0);

    const proof=asRole("SELECT source_id || '|' || county_fips || '|' || "+
      "run_id::text || '|' || indexed_records::text || '|' || sealed_run::text "+
      "FROM bdp_parcel_index.parcel_sealed_source_authority_rpc('"+COUNTY+"');");
    assert.ok(proof.includes(SOURCE+'|'+COUNTY+'|'+runId+'|3|true'));

    // Caching approval revocation immediately returns zero authority rows.
    runSql("UPDATE bdp_parcel_index.source_registry SET rights_state='revoked' "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(count(),0);
    runSql("UPDATE bdp_parcel_index.source_registry SET rights_state='approved' "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(count(),1);

    // The newest finished run is PARTIAL (no seal). No older-run fallback.
    runSql('INSERT INTO bdp_parcel_index.ingest_runs '+
      '(source_id,source_version,outcome,finished_at,received_records,'+
      'omitted_unidentified,source_reported_truncated) VALUES ('+
      "'"+SOURCE+"','v2-partial','partial',"+
      "clock_timestamp()+interval '30 seconds',0,0,FALSE);");
    assert.equal(count(),0);
    // This unsealed disposable run may be removed; sealed v1 cannot.
    runSql("DELETE FROM bdp_parcel_index.ingest_runs WHERE source_id='"+
      SOURCE+"' AND source_version='v2-partial';");
    assert.equal(count(),1);

    // A newer COMPLETE but UNSEALED run also blocks fallback to old v1.
    runSql('INSERT INTO bdp_parcel_index.ingest_runs '+
      '(source_id,source_version,outcome,finished_at,received_records,'+
      'omitted_unidentified,source_reported_truncated,observed_envelope) '+
      "VALUES ('"+SOURCE+"','v3-complete','complete',"+
      "clock_timestamp()+interval '30 seconds',0,0,FALSE,"+
      'public.ST_MakeEnvelope(-97.76,30.24,-97.71,30.27,4326));');
    assert.equal(count(),0);
    process.stdout.write(SEALED_SOURCE_AUTHORITY_SUCCESS+'\n');
  } catch(error) {
    const p=created ? spawnSync('docker',['logs','--tail','35',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:256*1024,
    }) : null;
    const detail=String((p?.stderr||'')+(p?.stdout||'')).slice(-1300);
    throw new Error(('Disposable sealed-source authority smoke failed: '+
      error.message+'\n'+detail).replaceAll(password,'[redacted]').slice(0,2900));
  } finally {
    if(created) {
      try { docker(['rm','--force','--volumes',name],{timeout:30_000}); }
      catch {
        process.stderr.write('WARNING: failed to remove disposable sealed-source container\n');
      }
    }
  }
}
if(process.argv[1] &&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runSealedSourceAuthorityDisposableSmoke().catch(error=>{
    process.stderr.write(error.message+'\n');
    process.exitCode=1;
  });
}
