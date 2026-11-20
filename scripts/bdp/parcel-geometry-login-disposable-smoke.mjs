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
import { EXTRA_SYNTHETIC_PARCELS_SQL } from './parcel-geometry-disposable-smoke.mjs';
import {
  SEALED_GEOMETRY_ROLE_ATTESTATION_SQL,
} from '../../server/providers/bdp-parcel-sealed-geometry-rpc.js';

/**
 * Step 40C-38 — opt-in, disposable, SYNTHETIC PostGIS geometry LOGIN test.
 * Real password-authenticated LOGIN, not SET ROLE owner impersonation.
 * NO ports, host network, mounted volume, local database or actual county GIS.
 * NO production role/rights/license or browser geometry delivery is changed.
 */
export const GEOMETRY_LOGIN_DISPOSABLE_SUCCESS =
  'PASS: disposable PostGIS geometry-only LOGIN, exact principal, two sealed RPCs and grant revocation.';
export const GEOMETRY_LOGIN='ldos_parcel_geometry_test';
const SOURCE='step40c13-synthetic';
const COUNTY='48453';
const READY='PostgreSQL init process complete; ready for start up.';
const INITIAL='bdp_parcel_index.parcel_geometry_sealed_initial_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer)';
const KEYSET='bdp_parcel_index.parcel_geometry_keyset_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer,text,bigint)';
const OTHER='bdp_parcel_index.parcel_geometry_publication_review_rpc(text,text)';
const PROOF=['same_principal','safe_principal','no_schema_create',
  'no_source_table','no_run_table','no_seal_table','no_parcel_table',
  'no_coverage_table','no_rights_table','sealed_initial_allowed',
  'sealed_keyset_allowed','unsealed_snapshot_denied','metadata_source_denied',
  'metadata_viewport_denied','sealed_authority_denied',
  'publication_review_denied','exact_login','safe_login',
  'no_role_memberships','schema_usage','no_index_table_access',
  'no_index_sequence_access','no_other_index_rpc'];

export function requireGeometryLoginDisposableOptIn(args) {
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only'){
    throw new Error('Refusing geometry LOGIN smoke without exact --disposable-only');
  }
  return true;
}
function docker(args,{input,timeout=120_000}={}) {
  const p=spawnSync('docker',args,{
    input,encoding:'utf8',timeout,maxBuffer:3*1024*1024,
  });
  if(p.error||p.status!==0)throw new Error('Disposable Docker failed: '+
    String(p.error?.message||p.stderr||p.stdout||'').slice(-1500));
  return p.stdout||'';
}
async function ready(name) {
  for(let i=0;i<60;i++){
    const state=docker(['inspect','--format','{{.State.Status}}',name]).trim();
    if(state!=='running')throw Error('Disposable PostGIS exited prematurely');
    const p=spawnSync('docker',['logs',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
    });
    if(p.status===0&&String(p.stdout+p.stderr).includes(READY)){
      const pg=spawnSync('docker',[
        'exec',name,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10_000});
      if(pg.status===0)return;
    }
    await sleep(1000);
  }
  throw Error('Disposable PostGIS did not initialize');
}
export async function runGeometryLoginDisposableSmoke(args=process.argv.slice(2)) {
  requireGeometryLoginDisposableOptIn(args);
  const name='ldos-geometry-login-test-'+randomBytes(6).toString('hex');
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
    const command=(sql,asLogin=false)=>spawnSync('docker',[
      'exec','-i',...(asLogin?['-e','PGPASSWORD='+loginPassword]:[]),
      name,'psql','-X','-t','-A','-v','ON_ERROR_STOP=1',
      ...(asLogin?['-h','127.0.0.1','-U',GEOMETRY_LOGIN]:['-U','postgres']),
      '-d','postgres',
    ],{input:sql,encoding:'utf8',timeout:120_000,maxBuffer:3*1024*1024});
    const apply=(sql,asLogin=false)=>{
      const p=command(sql,asLogin);
      if(p.error||p.status!==0)throw new Error('Disposable SQL failed: '+
        String(p.error?.message||p.stderr||p.stdout||'').slice(-1600));
      return String(p.stdout||'').trim();
    };
    const denied=(sql,asLogin=true)=>{
      const p=command(sql,asLogin);
      assert.notEqual(p.status,0,'Restricted geometry role unexpectedly granted access');
      assert.match(String(p.stderr),/permission denied/i);
    };
    const file=n=>readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+n,import.meta.url),'utf8');
    apply('SELECT PostGIS_Version();');
    apply(file('parcelIndexFoundation.sql'));
    apply(file('parcelRestrictedRpcFoundation.sql'));
    apply(file('parcelGeometryPublicationRightsFoundation.sql'));
    apply(SYNTHETIC_DRIVER_FIXTURE_SQL);
    apply(EXTRA_SYNTHETIC_PARCELS_SQL);
    apply("INSERT INTO bdp_parcel_index.geometry_publication_reviews "+
      "(source_id,county_fips) VALUES ('"+SOURCE+"','"+COUNTY+"');");
    apply(file('parcelGeometryRestrictedRpcFoundation.sql'));
    apply(file('parcelRunSealFoundation.sql'));
    apply(file('parcelGeometryKeysetRpcFoundation.sql'));
    apply(file('parcelGeometrySealedInitialRpcFoundation.sql'));
    apply(file('parcelSealedSourceAuthorityRpcFoundation.sql'));
    apply(file('parcelGeometryPublicationReviewRpcFoundation.sql'));

    apply('CREATE ROLE '+GEOMETRY_LOGIN+
      ' LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE '+
      "NOREPLICATION NOBYPASSRLS PASSWORD '"+loginPassword+"';");
    apply('GRANT USAGE ON SCHEMA bdp_parcel_index TO '+GEOMETRY_LOGIN+';');
    const runId=apply('SELECT id FROM bdp_parcel_index.ingest_runs '+
      "WHERE source_id='"+SOURCE+"' AND source_version='v1';");
    assert.match(runId,/^[1-9][0-9]*$/);
    const initial="SELECT count(*) FROM "+
      "bdp_parcel_index.parcel_geometry_sealed_initial_rpc('"+COUNTY+"','"+
      SOURCE+"',"+runId+",-97.76,30.24,-97.71,30.27,3);";
    const keyset="SELECT count(*) FROM "+
      "bdp_parcel_index.parcel_geometry_keyset_rpc('"+COUNTY+"','"+
      SOURCE+"',"+runId+",-97.76,30.24,-97.71,30.27,3,'SYNTHETIC-PARCEL',1);";

    denied(initial);
    denied('SELECT source_parcel_id FROM bdp_parcel_index.parcel_versions;');
    apply('GRANT EXECUTE ON FUNCTION '+INITIAL+' TO '+GEOMETRY_LOGIN+';');
    apply('GRANT EXECUTE ON FUNCTION '+KEYSET+' TO '+GEOMETRY_LOGIN+';');

    const roleProof=(expected=GEOMETRY_LOGIN)=>{
      assert.match(expected,/^ldos_parcel_geometry_[a-z][a-z0-9_]{2,31}$/);
      const t=apply('PREPARE ldos_geometry_attest(text) AS '+
        SEALED_GEOMETRY_ROLE_ATTESTATION_SQL+";\n"+
        "EXECUTE ldos_geometry_attest('"+expected+"');",true);
      const n=PROOF.length;
      const pattern=new RegExp('^([tf]\\|){'+(n-1)+'}[tf]$');
      const line=t.split(/\r?\n/).find(s=>pattern.test(s.trim()));
      assert.ok(line,'Expected all geometry-only login privilege booleans');
      return Object.fromEntries(PROOF.map((key,i)=>[
        key,line.trim().split('|')[i]==='t',
      ]));
    };
    const allTrue=()=>{
      const values=roleProof();
      assert.ok(Object.values(values).every(x=>x===true),
        'Dedicated geometry LOGIN must pass every catalog privilege');
    };
    allTrue();
    assert.equal(roleProof('ldos_parcel_geometry_wrong').exact_login,false);
    assert.equal(apply(initial,true),'0',
      'Unsealed run cannot be read even by geometry-only login');

    apply('INSERT INTO bdp_parcel_index.parcel_run_seals '+
      '(ingest_run_id,source_id,county_fips,source_version,indexed_records) '+
      "VALUES ("+runId+",'"+SOURCE+"','"+COUNTY+"','v1',3);");
    assert.equal(apply(initial,true),'0',
      'Caching rights never imply publication approval');
    apply("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='approved',allow_geometry_redistribution=TRUE,"+
      "review_reference='synthetic/geometry-38',"+
      "reviewed_at=clock_timestamp()-interval '2 hours',"+
      "expires_at=clock_timestamp()+interval '2 hours' "+
      "WHERE source_id='"+SOURCE+"';");
    const count=Number(apply(initial,true));
    assert.ok(count>=1&&count<=3,'Only bounded synthetic parcels can be read');
    const keysetCount=Number(apply(keyset,true));
    assert.ok(keysetCount>=0&&keysetCount<=3);

    apply('GRANT SELECT ON bdp_parcel_index.parcel_versions TO '+GEOMETRY_LOGIN+';');
    assert.equal(roleProof().no_index_table_access,false);
    apply('REVOKE SELECT ON bdp_parcel_index.parcel_versions FROM '+GEOMETRY_LOGIN+';');
    allTrue();
    apply('GRANT EXECUTE ON FUNCTION '+OTHER+' TO '+GEOMETRY_LOGIN+';');
    assert.equal(roleProof().no_other_index_rpc,false);
    apply('REVOKE EXECUTE ON FUNCTION '+OTHER+' FROM '+GEOMETRY_LOGIN+';');
    allTrue();
    apply('GRANT ldos_parcel_rpc_client TO '+GEOMETRY_LOGIN+';');
    assert.equal(roleProof().no_role_memberships,false);
    apply('REVOKE ldos_parcel_rpc_client FROM '+GEOMETRY_LOGIN+';');
    allTrue();

    apply("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='revoked',allow_geometry_redistribution=FALSE "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(apply(initial,true),'0');
    process.stdout.write(GEOMETRY_LOGIN_DISPOSABLE_SUCCESS+'\n');
  }catch(error){
    const logs=created?spawnSync('docker',['logs','--tail','30',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:128*1024,
    }):null;
    const details=String((logs?.stderr||'')+(logs?.stdout||'')).slice(-1200);
    throw new Error(('Disposable geometry LOGIN smoke failed: '+
      error.message+'\n'+details)
      .replaceAll(postgresPassword,'[redacted]')
      .replaceAll(loginPassword,'[redacted]').slice(0,3000));
  }finally{
    if(created){
      try{docker(['rm','--force','--volumes',name],{timeout:30_000});}
      catch{process.stderr.write('WARNING: disposable geometry-login cleanup failed\n');}
    }
  }
}
if(process.argv[1] &&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runGeometryLoginDisposableSmoke().catch(err=>{
    process.stderr.write(err.message+'\n');
    process.exitCode=1;
  });
}
