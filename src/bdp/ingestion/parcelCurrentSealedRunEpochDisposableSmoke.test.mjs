import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 CURRENT_SEALED_RUN_EPOCH_SMOKE_PASS,
 requireCurrentRunEpochDisposableOptIn,
 runCurrentRunEpochDisposableSmoke,
} from '../../../scripts/bdp/parcel-current-run-epoch-disposable-smoke.mjs';

const source=readFileSync(new URL(
  '../../../scripts/bdp/parcel-current-run-epoch-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('45 real PostGIS test refuses anything but exact disposable-only flag',()=>{
 assert.equal(requireCurrentRunEpochDisposableOptIn(['--disposable-only']),true);
 for(const args of [
   [],null,['--prod'],['--reuse'],['--disposable-only','--reuse'],
   ['--disposable-only','--disposable-only'],
 ])assert.throws(()=>requireCurrentRunEpochDisposableOptIn(args),
   /Refusing current-run epoch SQL smoke/);
});
test('invalid flag fails before creating Docker containers',async()=>{
 await assert.rejects(runCurrentRunEpochDisposableSmoke(['--production']),
   /Refusing current-run epoch SQL smoke/);
});
test('real database test cannot network, mount or reuse an existing database',()=>{
 assert.match(source,/docker\(\['run','-d','--name',container,'--network','none'/);
 assert.doesNotMatch(source,/'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
 assert.doesNotMatch(source,/new Pool\(|connectionString|bdp-postgis/);
 assert.match(source,/randomBytes\(6\)\.toString\('hex'\)/);
 assert.match(source,/docker\(\['rm','--force','--volumes',container\]/);
});
test('real password login cannot impersonate source, publication or geometry',()=>{
 assert.match(source,/CREATE ROLE '\+LOGIN\+' LOGIN NOINHERIT/);
 assert.match(source,/NOREPLICATION NOBYPASSRLS PASSWORD/);
 assert.match(source,/'PGPASSWORD='\+loginPassword/);
 assert.match(source,/'-h','127\.0\.0\.1','-U',LOGIN/);
 assert.doesNotMatch(source,/SET LOCAL ROLE|SET SESSION AUTHORIZATION/);
});
test('SQL draft, fixture and synthetic source are only database inputs',()=>{
 for(const fragment of [
   'SYNTHETIC_DRIVER_FIXTURE_SQL',
   'EXTRA_SYNTHETIC_PARCELS_SQL',
   'parcelIndexFoundation.sql','parcelRestrictedRpcFoundation.sql',
   'parcelRunSealFoundation.sql','parcelRunSelectionEpochFoundation.sql',
   'parcelCurrentSealedRunEpochRpcFoundation.sql',
   'step40c13-synthetic',
 ])assert.ok(source.includes(fragment),fragment);
});
test('sealing current run is required; newer running run preserves run but bumps revision',()=>{
 assert.match(source,/Unsealed run cannot be verified/);
 assert.match(source,/parcel_run_seals/);
 assert.match(source,/assert\.equal\(epoch\(\),2n\)/);
 assert.match(source,/assert\.equal\(epoch\(\),3n\)/);
 assert.match(source,/synthetic-running/);
 assert.match(source,/Newer FINISHED but failed run must NEVER expose older sealed run/);
 assert.match(source,/Older sealed source cannot silently win after newer failed run/);
});
test('restricted run-epoch account denies raw table access and cross-RPC privilege drift',()=>{
 assert.match(source,/PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL/);
 assert.match(source,/Nine strict database role proof booleans required/);
 assert.match(source,/roleProof\(\)\.no_index_table_access,false/);
 assert.match(source,/REVOKE SELECT ON bdp_parcel_index\.parcel_run_selection_epochs/);
 assert.match(source,/denied\('SELECT \* FROM bdp_parcel_index\.ingest_runs;/);
});
test('test has guaranteed cleanup, generic failure and no browser geometry',()=>{
 assert.match(CURRENT_SEALED_RUN_EPOCH_SMOKE_PASS,
   /^PASS: disposable PostGIS current sealed-run epoch LOGIN/);
 assert.match(source,/replaceAll\(loginPassword,'\[redacted\]'\)/);
 assert.match(source,/replaceAll\(postgresPassword,'\[redacted\]'\)/);
 assert.match(source,/finally\{[\s\S]*?docker\(\['rm','--force','--volumes',container\]/);
 assert.doesNotMatch(source,/createServer\(|\.listen\(|app\.get\(|ST_AsGeoJSON/);
});

test('45 Docker Desktop health and locally available PostGIS image preflight precedes fixture',()=>{
 assert.match(source,/docker\(\['info','--format','\{\{\.ServerVersion\}\}'\],\{timeout:30_000\}\)/);
 assert.match(source,/docker\(\['image','inspect',DRIVER_SMOKE_IMAGE\],\{timeout:30_000\}\)/);
 assert.match(source,/--pull=never/);
 assert.ok(source.indexOf("docker(['info'")<source.indexOf("docker(['run'"));
 assert.ok(source.indexOf("docker(['image'")<source.indexOf("docker(['run'"));
});
test('45 a docker run timeout still attempts scoped disposable container cleanup',()=>{
 assert.match(source,/let created=false,runAttempted=false/);
 assert.match(source,/runAttempted=true;\s*docker\(\['run'/);
 assert.match(source,/if\(created\|\|runAttempted\)\{/);
 assert.match(source,/docker\(\['rm','--force','--volumes',container\]/);
});
test('45 Docker timeout error exposes only operation, never startup password or arguments',()=>{
 assert.match(source,/p\.error\?\.code==='ETIMEDOUT'/);
 assert.match(source,/Docker command timed out/);
 assert.match(source,/\['info','image','run','inspect','exec','rm'\]/);
 assert.doesNotMatch(source,/String\(args\)|JSON\.stringify\(args\)/);
});
