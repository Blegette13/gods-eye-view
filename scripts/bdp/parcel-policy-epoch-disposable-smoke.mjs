import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  DRIVER_SMOKE_IMAGE,SYNTHETIC_DRIVER_FIXTURE_SQL,
} from './parcel-pg-driver-disposable-smoke.mjs';

/**
 * Step 40C-40 — isolated, synthetic ONLY transactional PostGIS epoch proof.
 * Opt-in to a FRESH Docker container with NO network, host ports, bind mounts,
 * production connections, production secrets or actual GIS records.
 * No rights/DB owner or sessions are created in a real database.
 */
export const POLICY_EPOCH_SMOKE_PASS =
  'PASS: disposable PostGIS policy epochs advance on ABA, rollback atomically, and remain denied to application roles.';
const SOURCE = 'step40c13-synthetic';
const COUNTY = '48453';
const READY = 'PostgreSQL init process complete; ready for start up.';

export function requirePolicyEpochDisposableOptIn(args) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing policy-epoch smoke without exact --disposable-only');
  }
  return true;
}
function docker(args,{input,timeout=120_000}={}) {
  const p=spawnSync('docker',args,{
    input,encoding:'utf8',timeout,maxBuffer:3*1024*1024,
  });
  if(p.error||p.status!==0)throw new Error('Disposable Docker failed: '+
    String(p.error?.message||p.stderr||p.stdout||'').slice(-1300));
  return p.stdout||'';
}
async function ready(name) {
  for(let n=0;n<60;n++) {
    const state=docker(['inspect','--format','{{.State.Status}}',name]).trim();
    if(state!=='running')throw new Error('Disposable PostGIS exited');
    const logs=spawnSync('docker',['logs',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
    });
    if(logs.status===0&&String(logs.stdout+logs.stderr).includes(READY)) {
      const result=spawnSync('docker',[
        'exec',name,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10_000});
      if(result.status===0)return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable PostGIS unavailable');
}

/** Every SQL write targets ONLY the temporary network-disabled container. */
export async function runPolicyEpochDisposableSmoke(args=process.argv.slice(2)) {
  requirePolicyEpochDisposableOptIn(args);
  const name='ldos-policy-epoch-smoke-'+randomBytes(6).toString('hex');
  const password=randomBytes(32).toString('hex');
  let created=false;
  try {
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
      if(p.error||p.status!==0)throw new Error('Disposable SQL failed: '+
        String(p.error?.message||p.stderr||p.stdout||'').slice(-1600));
      return String(p.stdout||'').trim();
    };
    const file=filename=>readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+filename,import.meta.url),'utf8');
    const epoch=scope=>{
      assert.ok(['source_cache','geometry_publication'].includes(scope));
      const out=sql("SELECT epoch FROM bdp_parcel_index.parcel_policy_epochs "+
        "WHERE policy_scope='"+scope+"' AND source_id='"+SOURCE+"';");
      assert.match(out,/^[1-9][0-9]*$/,'Policy key must have one valid epoch');
      return BigInt(out);
    };
    const advance=(scope,previous)=>{
      const next=epoch(scope);
      assert.equal(next,previous+1n,'Each committed policy change increments once');
      return next;
    };

    sql('SELECT PostGIS_Version();');
    sql(file('parcelIndexFoundation.sql'));
    sql(file('parcelRestrictedRpcFoundation.sql'));
    sql(file('parcelGeometryPublicationRightsFoundation.sql'));
    sql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    sql("INSERT INTO bdp_parcel_index.geometry_publication_reviews "+
      "(source_id,county_fips) VALUES ('"+SOURCE+"','"+COUNTY+"');");
    sql(file('parcelPolicyEpochFoundation.sql'));

    // Existing rows are seeded as epoch 1, without invented historic events.
    assert.equal(epoch('source_cache'),1n);
    assert.equal(epoch('geometry_publication'),1n);
    assert.equal(sql("SELECT count(*) FROM bdp_parcel_index.parcel_policy_epochs "+
      "WHERE source_id='"+SOURCE+"';"),'2');

    // TRUNCATE bypasses row triggers. A DBA must not be able to silently
    // reset review policy history via ordinary TRUNCATE or source CASCADE.
    for (const truncate of [
      'TRUNCATE bdp_parcel_index.geometry_publication_reviews;',
      'TRUNCATE bdp_parcel_index.source_registry CASCADE;',
    ]) {
      const result=execSql(truncate);
      assert.notEqual(result.status,0,'Policy TRUNCATE should fail closed');
      assert.match(String(result.stderr),/Policy rights TRUNCATE prohibited/i);
    }
    assert.equal(epoch('source_cache'),1n);
    assert.equal(epoch('geometry_publication'),1n);
    assert.equal(sql("SELECT count(*) FROM bdp_parcel_index.geometry_publication_reviews "+
      "WHERE source_id='"+SOURCE+"';"),'1');

    // Deny even a synthetic non-login role any direct rights-epoch SELECT.
    sql('CREATE ROLE ldos_policy_epoch_probe NOLOGIN NOINHERIT;');
    sql('GRANT USAGE ON SCHEMA bdp_parcel_index TO ldos_policy_epoch_probe;');
    assert.equal(sql("SELECT has_table_privilege('ldos_policy_epoch_probe',"+
      "'bdp_parcel_index.parcel_policy_epochs','SELECT');"),'f');
    const denied=execSql('BEGIN READ ONLY;\n'+
      'SET LOCAL ROLE ldos_policy_epoch_probe;\n'+
      'SELECT epoch FROM bdp_parcel_index.parcel_policy_epochs;');
    assert.notEqual(denied.status,0);
    assert.match(String(denied.stderr),/permission denied/i);

    // Source caching rights A→B→A returns identical facts, different epoch.
    const original=sql("SELECT rights_state,rights_review_reference FROM "+
      "bdp_parcel_index.source_registry WHERE source_id='"+SOURCE+"';");
    let v=epoch('source_cache');
    sql("UPDATE bdp_parcel_index.source_registry SET rights_state='revoked' "+
      "WHERE source_id='"+SOURCE+"';");
    v=advance('source_cache',v);
    sql("UPDATE bdp_parcel_index.source_registry SET rights_state='approved' "+
      "WHERE source_id='"+SOURCE+"';");
    v=advance('source_cache',v);
    const restored=sql("SELECT rights_state,rights_review_reference FROM "+
      "bdp_parcel_index.source_registry WHERE source_id='"+SOURCE+"';");
    assert.equal(restored,original,'A→B→A restored caching facts');
    assert.equal(v,3n,'Reapproval must never reuse original epoch');

    // Even a no-op rights write advances, so the revision never misses a
    // mutable rights operation due to timestamp/policy shape equality.
    sql("UPDATE bdp_parcel_index.source_registry SET rights_state=rights_state "+
      "WHERE source_id='"+SOURCE+"';");
    v=advance('source_cache',v);

    // An UPDATE and bump must commit or ROLLBACK TOGETHER.
    sql('BEGIN;\n'+
      "UPDATE bdp_parcel_index.source_registry SET rights_state='revoked' "+
      "WHERE source_id='"+SOURCE+"';\nROLLBACK;");
    assert.equal(epoch('source_cache'),v);
    assert.equal(sql("SELECT rights_state FROM bdp_parcel_index.source_registry "+
      "WHERE source_id='"+SOURCE+"';"),'approved');

    // Publication rights have their OWN monotonic revision, independent
    // of caching. Never infer legal approval from a cache epoch.
    const cacheBaseline=epoch('source_cache');
    let legal=epoch('geometry_publication');
    sql("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='approved',allow_geometry_redistribution=TRUE,"+
      "review_reference='synthetic/policy-epoch-40',"+
      "reviewed_at=clock_timestamp()-interval '2 hours',"+
      "expires_at=clock_timestamp()+interval '2 hours' "+
      "WHERE source_id='"+SOURCE+"';");
    legal=advance('geometry_publication',legal);
    const originalReview=sql("SELECT review_state,allow_geometry_redistribution,"+
      "review_reference,reviewed_at,expires_at FROM "+
      "bdp_parcel_index.geometry_publication_reviews WHERE source_id='"+SOURCE+"';");
    sql("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='revoked',allow_geometry_redistribution=FALSE "+
      "WHERE source_id='"+SOURCE+"';");
    legal=advance('geometry_publication',legal);
    sql("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='approved',allow_geometry_redistribution=TRUE "+
      "WHERE source_id='"+SOURCE+"';");
    legal=advance('geometry_publication',legal);
    const restoredReview=sql("SELECT review_state,allow_geometry_redistribution,"+
      "review_reference,reviewed_at,expires_at FROM "+
      "bdp_parcel_index.geometry_publication_reviews WHERE source_id='"+SOURCE+"';");
    assert.equal(restoredReview,originalReview,'A→B→A restored identical legal facts');
    assert.equal(legal,4n,'Reapproved legal rights MUST retain a newer epoch');
    assert.equal(epoch('source_cache'),cacheBaseline);

    // Rolled-back legal revocation must not consume an epoch.
    sql('BEGIN;\n'+
      "UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='revoked',allow_geometry_redistribution=FALSE "+
      "WHERE source_id='"+SOURCE+"';\nROLLBACK;");
    assert.equal(epoch('geometry_publication'),legal);
    assert.equal(sql("SELECT review_state FROM "+
      "bdp_parcel_index.geometry_publication_reviews WHERE source_id='"+SOURCE+"';"),
    'approved');

    // Deleting the review must not erase policy revision history; an
    // identically keyed future insert must advance the existing epoch.
    sql("DELETE FROM bdp_parcel_index.geometry_publication_reviews "+
      "WHERE source_id='"+SOURCE+"';");
    legal=advance('geometry_publication',legal);
    sql("INSERT INTO bdp_parcel_index.geometry_publication_reviews "+
      "(source_id,county_fips) VALUES ('"+SOURCE+"','"+COUNTY+"');");
    legal=advance('geometry_publication',legal);
    assert.equal(legal,6n);
    assert.equal(epoch('source_cache'),cacheBaseline);

    process.stdout.write(POLICY_EPOCH_SMOKE_PASS+'\n');
  } catch(error) {
    const logs=created?spawnSync('docker',['logs','--tail','30',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:128*1024,
    }):null;
    const details=String((logs?.stderr||'')+(logs?.stdout||'')).slice(-1200);
    throw new Error(('Disposable policy-epoch SQL smoke failed: '+
      error.message+'\n'+details).replaceAll(password,'[redacted]').slice(0,3000));
  } finally {
    if(created) {
      try{docker(['rm','--force','--volumes',name],{timeout:30_000});}
      catch{process.stderr.write('WARNING: disposable policy-epoch container cleanup failed\n');}
    }
  }
}
if(process.argv[1] &&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runPolicyEpochDisposableSmoke().catch(error=>{
    process.stderr.write(error.message+'\n');
    process.exitCode=1;
  });
}
