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
import {
  GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL,
} from '../../server/providers/bdp-parcel-geometry-publication-review-db.js';

/**
 * Step 40C-36: opt-in, disposable REAL PostGIS publisher-policy test.
 * No bridge/network, host ports, bind mounts, persistent DB or GIS source
 * imports. Uses solely synthetic source and rights records. A test-only
 * independent LOGIN gets the SINGLE review RPC EXECUTE in this container.
 * Does NOT grant production GIS redistribution or authorize any browser API.
 */
export const PUBLICATION_REVIEW_SMOKE_SUCCESS =
  'PASS: disposable PostGIS independent geometry-review LOGIN, current rights, least privilege and revocation.';
export const PUBLICATION_REVIEW_LOGIN='ldos_parcel_publication_test';
const SOURCE='step40c13-synthetic',COUNTY='48453';
const FN='bdp_parcel_index.parcel_geometry_publication_review_rpc(text,text)';
const AUTH_FN='bdp_parcel_index.approved_sources_rpc(text)';
const READY='PostgreSQL init process complete; ready for start up.';
const PROOF_KEYS=['exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_index_table_access','no_index_sequence_access',
  'fixed_rpc_execute','no_other_index_rpc'];
export function requirePublicationReviewSmokeOptIn(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only') {
    throw new Error('Refusing independent publication test without exact --disposable-only');
  }
  return true;
}
function docker(args,{input,timeout=120_000}={}) {
  const p=spawnSync('docker',args,{
    input,encoding:'utf8',timeout,maxBuffer:3*1024*1024,
  });
  if(p.error||p.status!==0)throw new Error('Disposable Docker failed: '+
    String(p.error?.message||p.stderr||p.stdout||'').slice(-1600));
  return p.stdout||'';
}
async function ready(name) {
  for(let attempt=0;attempt<60;attempt++) {
    const state=docker(['inspect','--format','{{.State.Status}}',name]).trim();
    if(state!=='running')throw new Error('Disposable database exited');
    const logs=spawnSync('docker',['logs',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
    });
    if(logs.status===0&&String(logs.stdout+logs.stderr).includes(READY)) {
      const p=spawnSync('docker',[
        'exec',name,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10_000});
      if(p.status===0)return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable PostGIS not ready');
}
export async function runPublicationReviewDisposableSmoke(args=process.argv.slice(2)) {
  requirePublicationReviewSmokeOptIn(args);
  const name='ldos-publication-review-test-'+randomBytes(6).toString('hex');
  const postgresPassword=randomBytes(32).toString('hex');
  const loginPassword=randomBytes(32).toString('hex');
  let created=false;
  try {
    docker(['run','-d','--name',name,'--network','none',
      '-e','POSTGRES_PASSWORD='+postgresPassword,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      DRIVER_SMOKE_IMAGE],{timeout:240_000});
    created=true;
    await ready(name);
    const execSql=(sql,asLogin=false)=>spawnSync('docker',[
      'exec','-i',...(asLogin?['-e','PGPASSWORD='+loginPassword]:[]),
      name,'psql','-X','-t','-A','-v','ON_ERROR_STOP=1',
      ...(asLogin?['-h','127.0.0.1','-U',PUBLICATION_REVIEW_LOGIN]:['-U','postgres']),
      '-d','postgres',
    ],{input:sql,encoding:'utf8',timeout:120_000,maxBuffer:3*1024*1024});
    const apply=(sql,asLogin=false)=>{
      const p=execSql(sql,asLogin);
      if(p.error||p.status!==0)throw new Error('Disposable SQL failed: '+
        String(p.error?.message||p.stderr||p.stdout||'').slice(-1600));
      return String(p.stdout||'').trim();
    };
    const denied=(sql,asLogin=true)=>{
      const p=execSql(sql,asLogin);
      assert.notEqual(p.status,0,'Unapproved access unexpectedly succeeded');
      assert.match(String(p.stderr),/permission denied/i);
    };
    const file=name=>readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+name,import.meta.url),'utf8');

    apply('SELECT PostGIS_Version();');
    apply(file('parcelIndexFoundation.sql'));
    apply(file('parcelRestrictedRpcFoundation.sql'));
    apply(file('parcelGeometryPublicationRightsFoundation.sql'));
    apply(SYNTHETIC_DRIVER_FIXTURE_SQL);
    apply("INSERT INTO bdp_parcel_index.geometry_publication_reviews "+
      "(source_id,county_fips) VALUES ('"+SOURCE+"','"+COUNTY+"');");
    apply(file('parcelGeometryPublicationReviewRpcFoundation.sql'));

    assert.equal(apply("SELECT has_function_privilege('ldos_parcel_rpc_client','"+
      FN+"','EXECUTE');"),'f');
    apply('CREATE ROLE '+PUBLICATION_REVIEW_LOGIN+
      ' LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE '+
      "NOREPLICATION NOBYPASSRLS PASSWORD '"+loginPassword+"';");
    apply('GRANT USAGE ON SCHEMA bdp_parcel_index TO '+PUBLICATION_REVIEW_LOGIN+';');

    const query=(county=COUNTY,source=SOURCE)=>{
      assert.match(county,/^48[0-9]{3}$/);
      assert.match(source,/^[a-z][a-z0-9_-]{2,79}$/);
      return "SELECT count(*) FROM bdp_parcel_index."+
        "parcel_geometry_publication_review_rpc('"+county+"','"+source+"');";
    };
    denied(query());
    denied('SELECT review_state FROM bdp_parcel_index.geometry_publication_reviews;');
    denied("SELECT * FROM bdp_parcel_index.approved_sources_rpc('"+COUNTY+"');");
    apply('GRANT EXECUTE ON FUNCTION '+FN+' TO '+PUBLICATION_REVIEW_LOGIN+';');

    const roleProof=()=>{
      const text=apply('PREPARE ldos_publication_attest(text) AS '+
        GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL+";\n"+
        "EXECUTE ldos_publication_attest('"+PUBLICATION_REVIEW_LOGIN+"');",true);
      const line=text.split(/\r?\n/).find(x=>/^([tf]\|){8}[tf]$/.test(x.trim()));
      assert.ok(line,'Expected nine catalog-attestation booleans');
      return Object.fromEntries(PROOF_KEYS.map((key,i)=>[
        key,line.trim().split('|')[i]==='t',
      ]));
    };
    const allTrue=()=>assert.ok(Object.values(roleProof()).every(v=>v===true),
      'Independent publication LOGIN must pass its nine restrictions');
    allTrue();

    // Approved source caching from the fixture DOES NOT approve publishing.
    assert.equal(apply(query(),true),'0');
    apply("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='approved',allow_geometry_redistribution=TRUE,"+
      "review_reference='synthetic/review-36',"+
      "reviewed_at=clock_timestamp()-interval '2 hours',"+
      "expires_at=clock_timestamp()+interval '2 hours' "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(apply(query(),true),'1');
    assert.equal(apply(query('48029'),true),'0');
    assert.equal(apply(query(COUNTY,'other-source'),true),'0');

    // An independently approved review must be CURRENT; expire and revoke.
    apply("UPDATE bdp_parcel_index.geometry_publication_reviews "+
      "SET expires_at=clock_timestamp()-interval '1 hour' "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(apply(query(),true),'0');
    apply("UPDATE bdp_parcel_index.geometry_publication_reviews "+
      "SET expires_at=clock_timestamp()+interval '2 hours',"+
      "review_reference='synthetic/review-36-updated' "+
      "WHERE source_id='"+SOURCE+"';");
    const changed=apply("SELECT review_reference FROM "+
      "bdp_parcel_index.parcel_geometry_publication_review_rpc('"+
      COUNTY+"','"+SOURCE+"');",true);
    assert.equal(changed,'synthetic/review-36-updated',
      'Review reference revision must be visible to trusted runtime');
    apply("UPDATE bdp_parcel_index.geometry_publication_reviews "+
      "SET review_state='revoked',allow_geometry_redistribution=FALSE "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(apply(query(),true),'0');
    apply("UPDATE bdp_parcel_index.geometry_publication_reviews "+
      "SET review_state='approved',allow_geometry_redistribution=TRUE "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(apply(query(),true),'1');

    // Negative privilege tests under a REAL LOGIN, never SET ROLE.
    apply('GRANT SELECT ON bdp_parcel_index.geometry_publication_reviews TO '+
      PUBLICATION_REVIEW_LOGIN+';');
    assert.equal(roleProof().no_index_table_access,false);
    apply('REVOKE SELECT ON bdp_parcel_index.geometry_publication_reviews FROM '+
      PUBLICATION_REVIEW_LOGIN+';');
    allTrue();
    apply('GRANT EXECUTE ON FUNCTION '+AUTH_FN+' TO '+PUBLICATION_REVIEW_LOGIN+';');
    assert.equal(roleProof().no_other_index_rpc,false);
    apply('REVOKE EXECUTE ON FUNCTION '+AUTH_FN+' FROM '+PUBLICATION_REVIEW_LOGIN+';');
    allTrue();

    // Source caching is independent: a review record can remain approved
    // after cache revocation. The separate sealed-source gate must still
    // deny geometry; NEVER mistake this review-only result as sufficient.
    apply("UPDATE bdp_parcel_index.source_registry "+
      "SET rights_state='revoked' WHERE source_id='"+SOURCE+"';");
    assert.equal(apply(query(),true),'1');
    process.stdout.write(PUBLICATION_REVIEW_SMOKE_SUCCESS+'\n');
  } catch(error) {
    const log=created?spawnSync('docker',['logs','--tail','35',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:128*1024,
    }):null;
    const diagnostic=String((log?.stderr||'')+(log?.stdout||'')).slice(-1300);
    throw new Error(('Disposable publication review smoke failed: '+
      error.message+'\n'+diagnostic)
      .replaceAll(postgresPassword,'[redacted]')
      .replaceAll(loginPassword,'[redacted]').slice(0,3000));
  } finally {
    if(created){
      try{docker(['rm','--force','--volumes',name],{timeout:30_000});}
      catch{
        process.stderr.write('WARNING: disposable publication DB cleanup failed\n');
      }
    }
  }
}
if(process.argv[1] &&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runPublicationReviewDisposableSmoke().catch(error=>{
    process.stderr.write(error.message+'\n');
    process.exitCode=1;
  });
}
