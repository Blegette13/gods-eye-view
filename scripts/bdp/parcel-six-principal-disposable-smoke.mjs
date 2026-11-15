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
import {SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL} from
  '../../server/providers/bdp-parcel-sealed-source-authority-db.js';
import {GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL} from
  '../../server/providers/bdp-parcel-geometry-publication-review-db.js';
import {SEALED_GEOMETRY_ROLE_ATTESTATION_SQL} from
  '../../server/providers/bdp-parcel-sealed-geometry-rpc.js';
import {PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL} from
  '../../server/providers/bdp-parcel-policy-epoch-db.js';
import {PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL} from
  '../../server/providers/bdp-parcel-current-sealed-run-epoch-db.js';
import {PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL} from
  '../../server/providers/bdp-parcel-session-county-epoch-db.js';

/**
 * Step 40C-49. Opt-in SIX actual password-authenticated DB LOGINS, ONE
 * NEW networkless synthetic PostGIS database. No host mounts or ports.
 * This verifies cross-principal SQL grants and sequential change detection.
 * It DOES NOT exercise a real identity provider, the Node count/cursor
 * runtime over six live pools, atomic on-wire release, or GIS licensing.
 */
export const SIX_PRINCIPAL_SMOKE_PASS =
  'PASS: disposable PostGIS six independent SQL LOGINS, sealed source, publication, geometry, policy/run/session epochs and revocation isolation.';
const READY='PostgreSQL init process complete; ready for start up.';
const SOURCE='step40c13-synthetic',COUNTY='48453',DIGEST='a'.repeat(64);
const LOGIN=Object.freeze({
  source:'ldos_parcel_authority_test',
  review:'ldos_parcel_publication_test',
  geometry:'ldos_parcel_geometry_test',
  policy:'ldos_parcel_epoch_test',
  run:'ldos_parcel_run_epoch_test',
  session:'ldos_parcel_session_epoch_test',
});
const FN=Object.freeze({
  source:'bdp_parcel_index.parcel_sealed_source_authority_rpc(text)',
  review:'bdp_parcel_index.parcel_geometry_publication_review_rpc(text,text)',
  initial:'bdp_parcel_index.parcel_geometry_sealed_initial_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer)',
  keyset:'bdp_parcel_index.parcel_geometry_keyset_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer,text,bigint)',
  policy:'bdp_parcel_index.parcel_policy_epoch_snapshot_rpc(text,text)',
  run:'bdp_parcel_index.parcel_current_sealed_run_epoch_rpc(text,text,bigint)',
  session:'ldos_private_auth.parcel_session_county_epoch_rpc(text,text)',
});
const STANDARD_PROOF=Object.freeze([
  'exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_index_table_access','no_index_sequence_access',
  'fixed_rpc_execute','no_other_index_rpc',
]);
const SESSION_PROOF=Object.freeze([
  'exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_private_table_access','no_private_sequence_access',
  'fixed_rpc_execute','no_other_private_rpc',
]);
const GEOMETRY_PROOF=Object.freeze([
  'same_principal','safe_principal','no_schema_create','no_source_table',
  'no_run_table','no_seal_table','no_parcel_table','no_coverage_table',
  'no_rights_table','sealed_initial_allowed','sealed_keyset_allowed',
  'unsealed_snapshot_denied','metadata_source_denied',
  'metadata_viewport_denied','sealed_authority_denied',
  'publication_review_denied','exact_login','safe_login',
  'no_role_memberships','schema_usage','no_index_table_access',
  'no_index_sequence_access','no_other_index_rpc',
]);
const ATTEST=Object.freeze({
  source:SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL,
  review:GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL,
  geometry:SEALED_GEOMETRY_ROLE_ATTESTATION_SQL,
  policy:PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL,
  run:PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL,
  session:PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL,
});
const KEYS=Object.freeze({
  source:STANDARD_PROOF,review:STANDARD_PROOF,geometry:GEOMETRY_PROOF,
  policy:STANDARD_PROOF,run:STANDARD_PROOF,session:SESSION_PROOF,
});
const PRINCIPALS=Object.freeze(Object.keys(LOGIN));
const ISOLATED_LOGIN=/^ldos_parcel_(?:authority|publication|geometry|epoch|run_epoch|session_epoch)_[a-z][a-z0-9_]{2,31}$/;

export function requireSixPrincipalDisposableOptIn(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw Error('Refusing six-principal SQL smoke without exact --disposable-only');
  return true;
}
function docker(args,{timeout=120_000}={}){
  const p=spawnSync('docker',args,{encoding:'utf8',timeout,
    maxBuffer:3*1024*1024});
  if(p.error||p.status!==0){
    const cmd=['info','image','run','inspect','exec','rm'].includes(args[0])
      ?args[0]:'unknown';
    const reason=p.error?.code==='ETIMEDOUT'?'timed out':'failed';
    // Do not log startup/exec args: they contain randomized fixture passwords.
    throw Error('Disposable Docker '+reason+' during '+cmd+': '+
      String(p.error?.message||p.stderr||p.stdout||'').slice(-900));
  }
  return String(p.stdout||'');
}
async function ready(name){
  for(let i=0;i<60;i++){
    const status=docker(['inspect','--format','{{.State.Status}}',name]).trim();
    if(status!=='running')throw Error('Isolated PostGIS container stopped');
    const log=spawnSync('docker',['logs',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
    });
    if(log.status===0&&String(log.stdout+log.stderr).includes(READY)){
      const pg=spawnSync('docker',[
        'exec',name,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10_000});
      if(pg.status===0)return;
    }
    await sleep(1000);
  }
  throw Error('Isolated PostGIS initialization timed out');
}
export async function runSixPrincipalDisposableSmoke(args=process.argv.slice(2)){
  requireSixPrincipalDisposableOptIn(args);
  const container='ldos-six-principal-'+randomBytes(6).toString('hex');
  const postgresPassword=randomBytes(32).toString('hex');
  const passwords=Object.freeze(Object.fromEntries(
    PRINCIPALS.map(p=>[p,randomBytes(32).toString('hex')]),
  ));
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

    const execSql=(statement,as=null)=>spawnSync('docker',[
      'exec','-i',...(as?['-e','PGPASSWORD='+passwords[as]]:[]),
      container,'psql','-X','-t','-A','-v','ON_ERROR_STOP=1',
      ...(as?['-h','127.0.0.1','-U',LOGIN[as]]:['-U','postgres']),
      '-d','postgres',
    ],{input:statement,encoding:'utf8',timeout:120_000,maxBuffer:3*1024*1024});
    const sql=(statement,as=null)=>{
      const p=execSql(statement,as);
      if(p.error||p.status!==0)throw Error('Disposable SQL failure ('+
        (as||'setup')+'): '+String(p.error?.message||p.stderr||'').slice(-850));
      return String(p.stdout||'').trim();
    };
    const denied=(statement,as)=>{
      const p=execSql(statement,as);
      assert.equal(p.error,undefined,'SQL denial must execute on the actual database');
      assert.notEqual(p.status,0,'Forbidden '+as+' SQL unexpectedly succeeded');
      assert.match(String(p.stderr),/permission denied/i);
    };
    const file=filename=>readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+filename,import.meta.url),'utf8');

    sql('SELECT PostGIS_Version();');
    for(const name of [
      'parcelIndexFoundation.sql',
      'parcelRestrictedRpcFoundation.sql',
      'parcelGeometryPublicationRightsFoundation.sql',
    ])sql(file(name));
    sql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    sql(EXTRA_SYNTHETIC_PARCELS_SQL);
    sql("INSERT INTO bdp_parcel_index.geometry_publication_reviews "+
      "(source_id,county_fips) VALUES ('"+SOURCE+"','"+COUNTY+"');");
    for(const name of [
      'parcelGeometryRestrictedRpcFoundation.sql',
      'parcelRunSealFoundation.sql',
      'parcelGeometryKeysetRpcFoundation.sql',
      'parcelGeometrySealedInitialRpcFoundation.sql',
      'parcelSealedSourceAuthorityRpcFoundation.sql',
      'parcelGeometryPublicationReviewRpcFoundation.sql',
      'parcelPolicyEpochFoundation.sql',
      'parcelPolicyEpochSnapshotRpcFoundation.sql',
      'parcelRunSelectionEpochFoundation.sql',
      'parcelCurrentSealedRunEpochRpcFoundation.sql',
      'parcelSessionCountyEpochFoundation.sql',
      'parcelSessionCountyEpochRpcFoundation.sql',
    ])sql(file(name));

    const runId=sql('SELECT id FROM bdp_parcel_index.ingest_runs '+
      "WHERE source_id='"+SOURCE+"' AND source_version='v1';");
    assert.match(runId,/^[1-9][0-9]*$/);
    const query=Object.freeze({
      source:"SELECT count(*) FROM bdp_parcel_index.parcel_sealed_source_authority_rpc('"+COUNTY+"');",
      review:"SELECT count(*) FROM bdp_parcel_index.parcel_geometry_publication_review_rpc('"+COUNTY+"','"+SOURCE+"');",
      geometry:"SELECT count(*) FROM bdp_parcel_index.parcel_geometry_sealed_initial_rpc('"+COUNTY+"','"+SOURCE+"',"+runId+",-97.76,30.24,-97.71,30.27,3);",
      policy:"SELECT source_cache_epoch||'|'||publication_epoch FROM bdp_parcel_index.parcel_policy_epoch_snapshot_rpc('"+COUNTY+"','"+SOURCE+"');",
      run:"SELECT run_id||'|'||epoch FROM bdp_parcel_index.parcel_current_sealed_run_epoch_rpc('"+COUNTY+"','"+SOURCE+"',"+runId+");",
      session:"SELECT epoch FROM ldos_private_auth.parcel_session_county_epoch_rpc('"+DIGEST+"','"+COUNTY+"');",
    });
    const grants=Object.freeze({
      source:[FN.source],review:[FN.review],
      geometry:[FN.initial,FN.keyset],policy:[FN.policy],
      run:[FN.run],session:[FN.session],
    });
    for(const principal of PRINCIPALS){
      assert.match(LOGIN[principal],ISOLATED_LOGIN);
      sql('CREATE ROLE '+LOGIN[principal]+' LOGIN NOINHERIT NOSUPERUSER '+
        'NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS '+
        "PASSWORD '"+passwords[principal]+"';");
      const schema=principal==='session'?'ldos_private_auth':'bdp_parcel_index';
      sql('GRANT USAGE ON SCHEMA '+schema+' TO '+LOGIN[principal]+';');
      denied(query[principal],principal);
    }
    for(const principal of PRINCIPALS){
      for(const fn of grants[principal])
        sql('GRANT EXECUTE ON FUNCTION '+fn+' TO '+LOGIN[principal]+';');
    }
    const proof=principal=>{
      const statement='PREPARE ldos_six_role_proof(text) AS '+ATTEST[principal]+
        ";\nEXECUTE ldos_six_role_proof('"+LOGIN[principal]+"');";
      const output=sql(statement,principal);
      const keys=KEYS[principal];
      const pattern=new RegExp('^([tf]\\|){'+(keys.length-1)+'}[tf]$');
      const actual=output.split(/\r?\n/).find(line=>pattern.test(line.trim()));
      assert.ok(actual,'Missing strict six-principal catalog proof: '+principal);
      return Object.freeze(Object.fromEntries(
        keys.map((k,i)=>[k,actual.trim().split('|')[i]==='t']),
      ));
    };
    const attestAll=()=>{
      for(const principal of PRINCIPALS)
        assert.ok(Object.values(proof(principal)).every(Boolean),
          'Privilege drift/extra SQL authority detected on '+principal);
    };
    attestAll();

    // Each password login can execute only its own fixed RPC(s). Privileges
    // are verified against the database, not synthetic SET ROLE claims.
    for(const principal of PRINCIPALS){
      for(const other of PRINCIPALS){
        if(principal===other)continue;
        // Session-only has no usage on index schema, other five have no
        // usage on private auth. Both denial types are valid fail-closed.
        denied(query[other],principal);
      }
      denied('SELECT source_id FROM bdp_parcel_index.source_registry;',principal);
      denied('SELECT epoch FROM ldos_private_auth.session_county_epochs;',principal);
    }

    const own=p=>sql(query[p],p);
    assert.equal(own('source'),'0');
    assert.equal(own('review'),'0');
    assert.equal(own('geometry'),'0');
    assert.match(own('policy'),/^[1-9][0-9]*\|[1-9][0-9]*$/);
    assert.equal(own('run'),'');
    assert.equal(own('session'),'');
    // Complete and immutable synthetic ingestion run.
    sql('INSERT INTO bdp_parcel_index.parcel_run_seals '+
      '(ingest_run_id,source_id,county_fips,source_version,indexed_records) '+
      "VALUES ("+runId+",'"+SOURCE+"','"+COUNTY+"','v1',3);");
    assert.equal(own('source'),'1');
    assert.match(own('run'),new RegExp('^'+runId+'\\|[1-9][0-9]*$'));
    assert.equal(own('review'),'0');
    assert.equal(own('geometry'),'0');

    // Only a made-up source receives temporary *synthetic* republication.
    sql("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='approved',allow_geometry_redistribution=TRUE,"+
      "review_reference='synthetic/step-40c49',"+
      "reviewed_at=clock_timestamp()-interval '2 hours',"+
      "expires_at=clock_timestamp()+interval '2 hours' "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(own('review'),'1');
    const quantity=Number(own('geometry'));
    assert.ok(Number.isSafeInteger(quantity)&&quantity>=1&&quantity<=3,
      'Sealed synthetic geometry count must be bounded');

    // Grant is also synthetic; current private reader only checks its
    // SQL flags, not a real user, an MFA provider or real county rights.
    sql("INSERT INTO ldos_private_auth.session_county_decisions "+
      "(session_digest,county_fips,account_active,mfa_verified,"+
      "session_active,allow_discovery) VALUES ('"+DIGEST+"','"+COUNTY+
      "',TRUE,TRUE,TRUE,TRUE);");
    assert.equal(own('session'),'1');
    const before=own('policy'),runBefore=own('run'),sessionBefore=own('session');
    assert.equal(own('source'),'1');
    assert.equal(own('review'),'1');

    // ABA of synthetic session/county grant: identical final flags, fresh
    // version. Other five SQL identities remain separate and unprivileged.
    sql("UPDATE ldos_private_auth.session_county_decisions SET "+
      "allow_discovery=FALSE WHERE session_digest='"+DIGEST+
      "' AND county_fips='"+COUNTY+"';");
    assert.equal(own('session'),'');
    sql("UPDATE ldos_private_auth.session_county_decisions SET "+
      "allow_discovery=TRUE WHERE session_digest='"+DIGEST+
      "' AND county_fips='"+COUNTY+"';");
    assert.equal(BigInt(own('session')),BigInt(sessionBefore)+2n);
    assert.equal(own('run'),runBefore);
    assert.equal(own('policy'),before);

    // Independent publication revision changes even if review is restored.
    const [c0,p0]=before.split('|').map(BigInt);
    sql("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='revoked',allow_geometry_redistribution=FALSE "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(own('review'),'0');
    assert.equal(own('geometry'),'0');
    sql("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='approved',allow_geometry_redistribution=TRUE "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(own('review'),'1');
    const [c1,p1]=own('policy').split('|').map(BigInt);
    assert.equal(c1,c0);
    assert.equal(p1,p0+2n,'Publication revoke/restore must advance its own epoch');
    assert.equal(own('run'),runBefore);

    // A newer FINISHED failed ingest MUST block older sealed run identity,
    // even though a historical sealed geometry RPC still has the old run ID.
    sql("INSERT INTO bdp_parcel_index.ingest_runs "+
      "(source_id,source_version,outcome,finished_at) VALUES ('"+
      SOURCE+"','synthetic-failed','failed',"+
      "clock_timestamp()+interval '1 hour');");
    assert.equal(own('run'),'','No fallback to stale current sealed run');
    assert.equal(own('source'),'','No fallback to stale source authority');
    assert.equal(own('session'),String(BigInt(sessionBefore)+2n));
    // A consumer MUST refuse the private result because the independent
    // source+run checks fail; this is not an atomic HTTP release test.

    // Runtime SQL ACL drift must be visible to privilege attestation.
    sql('GRANT SELECT ON bdp_parcel_index.parcel_policy_epochs TO '+LOGIN.policy+';');
    assert.equal(proof('policy').no_index_table_access,false);
    sql('REVOKE SELECT ON bdp_parcel_index.parcel_policy_epochs FROM '+LOGIN.policy+';');
    sql('GRANT SELECT ON ldos_private_auth.session_county_epochs TO '+LOGIN.session+';');
    assert.equal(proof('session').no_private_table_access,false);
    sql('REVOKE SELECT ON ldos_private_auth.session_county_epochs FROM '+LOGIN.session+';');
    attestAll();
    process.stdout.write(SIX_PRINCIPAL_SMOKE_PASS+'\n');
  }catch(e){
    const logs=attempted?spawnSync('docker',['logs','--tail','25',container],{
      encoding:'utf8',timeout:10_000,maxBuffer:128*1024,
    }):null;
    const details=String((logs?.stderr||'')+(logs?.stdout||'')).slice(-1000);
    let msg='Disposable six-principal SQL smoke failed: '+e.message+'\n'+details;
    msg=msg.replaceAll(postgresPassword,'[redacted]');
    for(const password of Object.values(passwords))
      msg=msg.replaceAll(password,'[redacted]');
    throw Error(msg.slice(0,2900));
  }finally{
    if(attempted){
      try{docker(['rm','--force','--volumes',container],{timeout:30_000});}
      catch{process.stderr.write('WARNING: six-principal disposable cleanup not confirmed\n');}
    }
  }
}
if(process.argv[1]&&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runSixPrincipalDisposableSmoke().catch(error=>{
    process.stderr.write(error.message+'\n');
    process.exitCode=1;
  });
}
