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
import { SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL } from
  '../../server/providers/bdp-parcel-sealed-source-authority-db.js';
import { GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL } from
  '../../server/providers/bdp-parcel-geometry-publication-review-db.js';
import { SEALED_GEOMETRY_ROLE_ATTESTATION_SQL } from
  '../../server/providers/bdp-parcel-sealed-geometry-rpc.js';

/**
 * Step 40C-39 — THREE real restricted LOGINs in one disposable synthetic
 * PostGIS instance. This integration tests SQL policy and role separation,
 * NOT live node-postgres pools, session authentication, cross-transaction
 * atomicity, actual county GIS licenses, or permission to publish polygons.
 *
 * No ports, Docker network, host paths/mounts, existing database connections,
 * production credentials or real GIS sources. Everything is deleted.
 */
export const THREE_PRINCIPAL_SMOKE_PASS =
  'PASS: disposable PostGIS three independent LOGINs, sealed source, independent review, geometry gate and revocation.';
const READY = 'PostgreSQL init process complete; ready for start up.';
const SOURCE = 'step40c13-synthetic';
const COUNTY = '48453';
const LOGINS = Object.freeze({
  source: 'ldos_parcel_authority_test',
  review: 'ldos_parcel_publication_test',
  geometry: 'ldos_parcel_geometry_test',
});
const FN = Object.freeze({
  source: 'bdp_parcel_index.parcel_sealed_source_authority_rpc(text)',
  review: 'bdp_parcel_index.parcel_geometry_publication_review_rpc(text,text)',
  initial: 'bdp_parcel_index.parcel_geometry_sealed_initial_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer)',
  keyset: 'bdp_parcel_index.parcel_geometry_keyset_rpc(text,text,bigint,double precision,double precision,double precision,double precision,integer,text,bigint)',
});
const ROLES = Object.freeze({
  source: Object.freeze([
    'exact_login','safe_login','no_role_memberships','schema_usage',
    'no_schema_create','no_index_table_access','no_index_sequence_access',
    'fixed_rpc_execute','no_other_index_rpc',
  ]),
  review: Object.freeze([
    'exact_login','safe_login','no_role_memberships','schema_usage',
    'no_schema_create','no_index_table_access','no_index_sequence_access',
    'fixed_rpc_execute','no_other_index_rpc',
  ]),
  geometry: Object.freeze([
    'same_principal','safe_principal','no_schema_create','no_source_table',
    'no_run_table','no_seal_table','no_parcel_table','no_coverage_table',
    'no_rights_table','sealed_initial_allowed','sealed_keyset_allowed',
    'unsealed_snapshot_denied','metadata_source_denied',
    'metadata_viewport_denied','sealed_authority_denied',
    'publication_review_denied','exact_login','safe_login',
    'no_role_memberships','schema_usage','no_index_table_access',
    'no_index_sequence_access','no_other_index_rpc',
  ]),
});
export function requireThreePrincipalDisposableOptIn(args) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--disposable-only') {
    throw new Error('Refusing three-principal SQL smoke without exact --disposable-only');
  }
  return true;
}
function docker(args, { input, timeout = 120_000 } = {}) {
  const p = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout, maxBuffer: 3 * 1024 * 1024,
  });
  if (p.error || p.status !== 0) {
    throw new Error('Disposable Docker command failed: ' +
      String(p.error?.message || p.stderr || p.stdout || '').slice(-1300));
  }
  return p.stdout || '';
}
async function ready(name) {
  for (let i = 0; i < 60; i++) {
    const state = docker(['inspect', '--format', '{{.State.Status}}', name]).trim();
    if (state !== 'running') throw new Error('Disposable PostGIS exited');
    const logs = spawnSync('docker', ['logs', name], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    if (logs.status === 0 &&
      String(logs.stdout + logs.stderr).includes(READY)) {
      const pg = spawnSync('docker', [
        'exec', name, 'pg_isready', '-U', 'postgres', '-d', 'postgres',
      ], { encoding: 'utf8', timeout: 10_000 });
      if (pg.status === 0) return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable PostGIS startup failed');
}

/**
 * Tests three distinct authenticated SQL principals under repeated, separate
 * READ ONLY database connections. Separate calls do NOT prove a shared MVCC
 * snapshot, parallel execution or policy ABA resistance.
 */
export async function runThreePrincipalDisposableSmoke(
  args = process.argv.slice(2),
) {
  requireThreePrincipalDisposableOptIn(args);
  const name = 'ldos-three-principal-smoke-' + randomBytes(6).toString('hex');
  const postgresPassword = randomBytes(32).toString('hex');
  const passwords = Object.freeze({
    source: randomBytes(32).toString('hex'),
    review: randomBytes(32).toString('hex'),
    geometry: randomBytes(32).toString('hex'),
  });
  let created = false;
  try {
    docker(['run','-d','--name',name,'--network','none',
      '-e','POSTGRES_PASSWORD='+postgresPassword,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      DRIVER_SMOKE_IMAGE], { timeout: 240_000 });
    created = true;
    await ready(name);

    const execSql = (sql, principal = null) => spawnSync('docker', [
      'exec','-i',
      ...(principal ? ['-e','PGPASSWORD='+passwords[principal]] : []),
      name,'psql','-X','-t','-A','-v','ON_ERROR_STOP=1',
      ...(principal ? ['-h','127.0.0.1','-U',LOGINS[principal]] : ['-U','postgres']),
      '-d','postgres',
    ], { input:sql, encoding:'utf8', timeout:120_000, maxBuffer:3*1024*1024 });
    const sql = (statement, principal = null) => {
      const result = execSql(statement, principal);
      if (result.error || result.status !== 0) {
        throw new Error('Disposable SQL failed: ' +
          String(result.error?.message || result.stderr || result.stdout || '').slice(-1500));
      }
      return String(result.stdout || '').trim();
    };
    const denied = (statement, principal) => {
      const result = execSql(statement, principal);
      assert.notEqual(result.status, 0, 'Cross-principal SQL unexpectedly succeeded');
      assert.match(String(result.stderr), /permission denied/i);
    };
    const file = filename => readFileSync(new URL(
      '../../src/bdp/ingestion/sql/'+filename, import.meta.url), 'utf8');

    sql('SELECT PostGIS_Version();');
    for (const foundation of [
      'parcelIndexFoundation.sql',
      'parcelRestrictedRpcFoundation.sql',
      'parcelGeometryPublicationRightsFoundation.sql',
    ]) sql(file(foundation));
    sql(SYNTHETIC_DRIVER_FIXTURE_SQL);
    sql(EXTRA_SYNTHETIC_PARCELS_SQL);
    sql("INSERT INTO bdp_parcel_index.geometry_publication_reviews "+
      "(source_id,county_fips) VALUES ('"+SOURCE+"','"+COUNTY+"');");
    for (const foundation of [
      'parcelGeometryRestrictedRpcFoundation.sql',
      'parcelRunSealFoundation.sql',
      'parcelGeometryKeysetRpcFoundation.sql',
      'parcelGeometrySealedInitialRpcFoundation.sql',
      'parcelSealedSourceAuthorityRpcFoundation.sql',
      'parcelGeometryPublicationReviewRpcFoundation.sql',
    ]) sql(file(foundation));

    const sourceQuery = "SELECT count(*) FROM "+
      "bdp_parcel_index.parcel_sealed_source_authority_rpc('"+COUNTY+"');";
    const reviewQuery = "SELECT count(*) FROM "+
      "bdp_parcel_index.parcel_geometry_publication_review_rpc('"+COUNTY+"','"+SOURCE+"');";
    const runId = sql('SELECT id FROM bdp_parcel_index.ingest_runs '+
      "WHERE source_id='"+SOURCE+"' AND source_version='v1';");
    assert.match(runId, /^[1-9][0-9]*$/);
    const geometryQuery = "SELECT count(*) FROM "+
      "bdp_parcel_index.parcel_geometry_sealed_initial_rpc('"+COUNTY+"','"+
      SOURCE+"',"+runId+",-97.76,30.24,-97.71,30.27,3);";

    for (const principal of Object.keys(LOGINS)) {
      sql('CREATE ROLE '+LOGINS[principal]+' LOGIN NOINHERIT '+
        'NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS '+
        "PASSWORD '"+passwords[principal]+"';");
      sql('GRANT USAGE ON SCHEMA bdp_parcel_index TO '+LOGINS[principal]+';');
    }
    denied(sourceQuery, 'source');
    denied(reviewQuery, 'review');
    denied(geometryQuery, 'geometry');
    sql('GRANT EXECUTE ON FUNCTION '+FN.source+' TO '+LOGINS.source+';');
    sql('GRANT EXECUTE ON FUNCTION '+FN.review+' TO '+LOGINS.review+';');
    sql('GRANT EXECUTE ON FUNCTION '+FN.initial+' TO '+LOGINS.geometry+';');
    sql('GRANT EXECUTE ON FUNCTION '+FN.keyset+' TO '+LOGINS.geometry+';');

    const roleProof = (principal, expectedLogin = LOGINS[principal]) => {
      const allowed = /^ldos_parcel_(?:authority|publication|geometry)_[a-z][a-z0-9_]{2,31}$/;
      assert.match(expectedLogin, allowed);
      const attestation = {
        source: SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL,
        review: GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL,
        geometry: SEALED_GEOMETRY_ROLE_ATTESTATION_SQL,
      }[principal];
      const text = sql('PREPARE ldos_role_proof(text) AS '+attestation+
        ";\nEXECUTE ldos_role_proof('"+expectedLogin+"');", principal);
      const keys = ROLES[principal];
      const match = new RegExp('^([tf]\\|){'+(keys.length-1)+'}[tf]$');
      const row = text.split(/\r?\n/).find(x=>match.test(x.trim()));
      assert.ok(row, 'Missing strict catalog privilege attestation');
      const values = row.trim().split('|');
      return Object.fromEntries(keys.map((key,i)=>[key,values[i]==='t']));
    };
    const allRolesStrict = () => {
      for (const principal of Object.keys(LOGINS)) {
        assert.ok(Object.values(roleProof(principal)).every(Boolean),
          principal+' has extra privilege or wrong database identity');
      }
    };
    allRolesStrict();
    assert.equal(roleProof('source',LOGINS.review).exact_login,false);
    assert.equal(roleProof('review',LOGINS.geometry).exact_login,false);
    assert.equal(roleProof('geometry',LOGINS.source).exact_login,false);

    // Each real password LOGIN must be unable to call other service RPCs
    // or query raw tables, even though all share the same disposable DB.
    denied(reviewQuery,'source');
    denied(geometryQuery,'source');
    denied(sourceQuery,'review');
    denied(geometryQuery,'review');
    denied(sourceQuery,'geometry');
    denied(reviewQuery,'geometry');
    for (const principal of Object.keys(LOGINS)) {
      denied('SELECT source_parcel_id FROM bdp_parcel_index.parcel_versions LIMIT 1;',principal);
      denied('SELECT review_state FROM bdp_parcel_index.geometry_publication_reviews;',principal);
    }

    const counts = () => Object.freeze({
      authority: Number(sql(sourceQuery,'source')),
      publication: Number(sql(reviewQuery,'review')),
      geometry: Number(sql(geometryQuery,'geometry')),
    });
    assert.deepEqual(counts(),{authority:0,publication:0,geometry:0});

    // An immutable run seal enables source authority, NOT GIS publication.
    sql('INSERT INTO bdp_parcel_index.parcel_run_seals '+
      '(ingest_run_id,source_id,county_fips,source_version,indexed_records) '+
      "VALUES ("+runId+",'"+SOURCE+"','"+COUNTY+"','v1',3);");
    assert.deepEqual(counts(),{authority:1,publication:0,geometry:0});

    // Only invented fixture data receives a temporary review approval.
    sql('UPDATE bdp_parcel_index.geometry_publication_reviews SET '+
      "review_state='approved',allow_geometry_redistribution=TRUE,"+
      "review_reference='synthetic/step-40c39',"+
      "reviewed_at=clock_timestamp()-interval '2 hours',"+
      "expires_at=clock_timestamp()+interval '2 hours' "+
      "WHERE source_id='"+SOURCE+"';");
    const allowed = counts();
    assert.equal(allowed.authority,1);
    assert.equal(allowed.publication,1);
    assert.ok(allowed.geometry>=1&&allowed.geometry<=3,
      'Sealed geometry must remain bounded to synthetic parcels');

    // Interleaved separate transactions: a post-read rights check MUST see
    // revocation. This is not a production-atomic revocation epoch.
    sql("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='revoked',allow_geometry_redistribution=FALSE "+
      "WHERE source_id='"+SOURCE+"';");
    assert.deepEqual(counts(),{authority:1,publication:0,geometry:0});
    sql("UPDATE bdp_parcel_index.geometry_publication_reviews SET "+
      "review_state='approved',allow_geometry_redistribution=TRUE "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(counts().geometry,allowed.geometry);

    // Source caching is independently revocable; review can remain positive.
    sql("UPDATE bdp_parcel_index.source_registry SET rights_state='revoked' "+
      "WHERE source_id='"+SOURCE+"';");
    assert.deepEqual(counts(),{authority:0,publication:1,geometry:0});
    sql("UPDATE bdp_parcel_index.source_registry SET rights_state='approved' "+
      "WHERE source_id='"+SOURCE+"';");
    assert.equal(counts().geometry,allowed.geometry);

    // One accidental cross-role RPC grant MUST fail the role's broad proof.
    sql('GRANT EXECUTE ON FUNCTION '+FN.review+' TO '+LOGINS.geometry+';');
    assert.equal(roleProof('geometry').no_other_index_rpc,false);
    sql('REVOKE EXECUTE ON FUNCTION '+FN.review+' FROM '+LOGINS.geometry+';');
    allRolesStrict();
    process.stdout.write(THREE_PRINCIPAL_SMOKE_PASS+'\n');
  } catch (error) {
    const logs = created ? spawnSync('docker',['logs','--tail','30',name],{
      encoding:'utf8',timeout:10_000,maxBuffer:128*1024,
    }):null;
    const details = String((logs?.stderr || '')+(logs?.stdout || '')).slice(-1200);
    let message = 'Disposable three-principal SQL smoke failed: '+error.message+'\n'+details;
    for (const secret of [postgresPassword,...Object.values(passwords)]) {
      message = message.replaceAll(secret,'[redacted]');
    }
    throw new Error(message.slice(0,2900));
  } finally {
    if (created) {
      try { docker(['rm','--force','--volumes',name],{timeout:30_000}); }
      catch {
        process.stderr.write('WARNING: disposable three-principal container cleanup failed\n');
      }
    }
  }
}
if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runThreePrincipalDisposableSmoke().catch(error=>{
    process.stderr.write(error.message+'\n');
    process.exitCode=1;
  });
}
