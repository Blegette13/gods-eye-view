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
import {
  SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL,
} from '../../server/providers/bdp-parcel-sealed-source-authority-db.js';

/**
 * Step 40C-35: strictly opt-in, network-isolated disposable PostGIS LOGIN
 * identity and privilege proof. NO existing BDP connection, ports, network
 * bridges, mounts, secrets or local database privileges are touched.
 * Uses a one-use password-authenticated LOGIN that disappears with Docker.
 *
 * This is NOT production deployment, a GIS publication license, account
 * authentication, live pg.Pool attestation or authorization for any browser.
 */
export const AUTHORITY_DB_LOGIN_SUCCESS =
  'PASS: disposable PostGIS authority-only LOGIN, pinned-principal attestation, least privilege and revocation.';
export const AUTHORITY_DB_LOGIN = 'ldos_parcel_authority_test';
const SOURCE = 'step40c13-synthetic';
const COUNTY = '48453';
const READY = 'PostgreSQL init process complete; ready for start up.';
const FN = 'bdp_parcel_index.parcel_sealed_source_authority_rpc(text)';
const OTHER = 'bdp_parcel_index.approved_sources_rpc(text)';
const PROOF_KEYS = [
  'exact_login','safe_login','no_role_memberships','schema_usage',
  'no_schema_create','no_index_table_access','no_index_sequence_access',
  'fixed_rpc_execute','no_other_index_rpc',
];

export function requireAuthorityDbLoginDisposableOptIn(args) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing authority-login smoke without exact --disposable-only');
  }
  return true;
}
function docker(args,{input,timeout=120_000}={}) {
  const p=spawnSync('docker',args,{
    input,encoding:'utf8',timeout,maxBuffer:3*1024*1024,
  });
  if(p.error || p.status!==0) throw new Error(
    'Disposable Docker operation failed: '+
    String(p.error?.message||p.stderr||p.stdout||'').slice(-1500));
  return p.stdout || '';
}
async function ready(name) {
  for(let i=0;i<60;i++) {
    const status=docker(['inspect','--format','{{.State.Status}}',name]).trim();
    if(status!=='running') throw new Error('Disposable PostGIS exited before readiness');
    const logs=spawnSync('docker',['logs',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
    });
    if(logs.status===0 && (String(logs.stdout)+String(logs.stderr)).includes(READY)) {
      const pg=spawnSync('docker',[
        'exec',name,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10_000});
      if(pg.status===0) return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable PostGIS was not ready');
}

export async function runAuthorityDbLoginDisposableSmoke(
  args=process.argv.slice(2),
) {
  requireAuthorityDbLoginDisposableOptIn(args);
  const name='ldos-authority-login-test-'+randomBytes(6).toString('hex');
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
      'exec','-i',...(asLogin ? ['-e','PGPASSWORD='+loginPassword] : []),
      name,'psql','-X','-t','-A','-v','ON_ERROR_STOP=1',
      ...(asLogin ? ['-h','127.0.0.1','-U',AUTHORITY_DB_LOGIN]
        : ['-U','postgres']),
      '-d','postgres',
    ],{input:sql,encoding:'utf8',timeout:120_000,maxBuffer:3*1024*1024});
    const apply=(sql,asLogin=false)=>{
      const p=execSql(sql,asLogin);
      if(p.error || p.status!==0) {
        throw new Error('Disposable SQL failed: '+
          String(p.error?.message||p.stderr||p.stdout||'').slice(-1600));
      }
      return String(p.stdout||'').trim();
    };
    const deny=(sql,asLogin=true)=>{
      const p=execSql(sql,asLogin);
      assert.notEqual(p.status,0,'Authority login unexpectedly gained access');
      assert.match(String(p.stderr),/permission denied/i);
    };
    const file=filename=>readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+filename,import.meta.url),'utf8');

    apply('SELECT PostGIS_Version();');
    apply(file('parcelIndexFoundation.sql'));
    apply(file('parcelRestrictedRpcFoundation.sql'));
    apply(SYNTHETIC_DRIVER_FIXTURE_SQL);
    apply(EXTRA_SYNTHETIC_PARCELS_SQL);
    apply(file('parcelRunSealFoundation.sql'));
    apply(file('parcelSealedSourceAuthorityRpcFoundation.sql'));

    // A REAL PostgreSQL LOGIN (not SET ROLE through a superuser session).
    // No persistent credential or role survives container removal.
    apply('CREATE ROLE '+AUTHORITY_DB_LOGIN+
      ' LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE '+
      "NOREPLICATION NOBYPASSRLS PASSWORD '"+loginPassword+"';");
    apply('GRANT USAGE ON SCHEMA bdp_parcel_index TO '+AUTHORITY_DB_LOGIN+';');
    const authorityQuery="SELECT count(*) FROM "+
      "bdp_parcel_index.parcel_sealed_source_authority_rpc('"+COUNTY+"');";
    deny(authorityQuery);
    deny('SELECT source_id FROM bdp_parcel_index.source_registry;');
    apply('GRANT EXECUTE ON FUNCTION '+FN+' TO '+AUTHORITY_DB_LOGIN+';');

    const proof=()=>{
      // Prepared statement binds the expected LOGIN; no unsafe SQL injection.
      const result=apply('PREPARE ldos_authority_attest(text) AS '+
        SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL+
        ";\nEXECUTE ldos_authority_attest('"+AUTHORITY_DB_LOGIN+"');",true);
      const line=result.split(/\r?\n/).find(x=>/^([tf]\|){8}[tf]$/.test(x.trim()));
      assert.ok(line,'Expected nine strict boolean role proof fields');
      return Object.fromEntries(PROOF_KEYS.map((key,index)=>[
        key,line.trim().split('|')[index]==='t',
      ]));
    };
    const allTrue=()=>assert.ok(Object.values(proof()).every(v=>v===true),
      'A clean authority-only LOGIN must pass ALL attestations');

    allTrue();
    assert.equal(apply(authorityQuery,true),'0',
      'An unsealed synthetic run must not be authoritative');
    const runId=apply('SELECT id FROM bdp_parcel_index.ingest_runs '+
      "WHERE source_id='"+SOURCE+"' AND source_version='v1';");
    assert.match(runId,/^[1-9][0-9]*$/);
    apply('INSERT INTO bdp_parcel_index.parcel_run_seals '+
      '(ingest_run_id,source_id,county_fips,source_version,indexed_records) '+
      "VALUES ("+runId+",'"+SOURCE+"','"+COUNTY+"','v1',3);");
    assert.equal(apply(authorityQuery,true),'1');
    assert.equal(apply("SELECT count(*) FROM "+
      "bdp_parcel_index.parcel_sealed_source_authority_rpc('48029');",true),'0');

    // Simulate a privilege creep regression and ensure each failure is
    // *observed by the same role-bound catalog statement*.
    apply('GRANT SELECT ON bdp_parcel_index.parcel_versions TO '+AUTHORITY_DB_LOGIN+';');
    assert.equal(proof().no_index_table_access,false);
    apply('REVOKE SELECT ON bdp_parcel_index.parcel_versions FROM '+AUTHORITY_DB_LOGIN+';');
    allTrue();

    apply('GRANT EXECUTE ON FUNCTION '+OTHER+' TO '+AUTHORITY_DB_LOGIN+';');
    assert.equal(proof().no_other_index_rpc,false);
    apply('REVOKE EXECUTE ON FUNCTION '+OTHER+' FROM '+AUTHORITY_DB_LOGIN+';');
    allTrue();

    apply('GRANT CREATE ON SCHEMA bdp_parcel_index TO '+AUTHORITY_DB_LOGIN+';');
    assert.equal(proof().no_schema_create,false);
    apply('REVOKE CREATE ON SCHEMA bdp_parcel_index FROM '+AUTHORITY_DB_LOGIN+';');
    allTrue();

    apply('GRANT ldos_parcel_rpc_client TO '+AUTHORITY_DB_LOGIN+';');
    assert.equal(proof().no_role_memberships,false);
    apply('REVOKE ldos_parcel_rpc_client FROM '+AUTHORITY_DB_LOGIN+';');
    allTrue();

    // Last: explicit source caching revocation cannot preserve old authority.
    apply("UPDATE bdp_parcel_index.source_registry SET rights_state='revoked' "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(apply(authorityQuery,true),'0');
    process.stdout.write(AUTHORITY_DB_LOGIN_SUCCESS+'\n');
  } catch(error) {
    const logs=created ? spawnSync('docker',['logs','--tail','30',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:128*1024,
    }) : null;
    const details=String((logs?.stderr||'')+(logs?.stdout||'')).slice(-1200);
    throw new Error(('Disposable authority login smoke failed: '+
      error.message+'\n'+details)
      .replaceAll(postgresPassword,'[redacted]')
      .replaceAll(loginPassword,'[redacted]').slice(0,2900));
  } finally {
    if(created) {
      try { docker(['rm','--force','--volumes',name],{timeout:30_000}); }
      catch {
        process.stderr.write(
          'WARNING: disposable authority login container cleanup failed\n');
      }
    }
  }
}
if(process.argv[1] &&
  import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runAuthorityDbLoginDisposableSmoke().catch(error=>{
    process.stderr.write(error.message+'\n');
    process.exitCode=1;
  });
}
