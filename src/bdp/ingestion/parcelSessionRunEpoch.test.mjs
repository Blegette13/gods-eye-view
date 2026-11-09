import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  SESSION_RUN_EPOCH_SMOKE_PASS,
  requireSessionRunEpochDisposableOptIn,
  runSessionRunEpochDisposableSmoke,
} from '../../../scripts/bdp/parcel-session-run-epoch-disposable-smoke.mjs';

const auth=readFileSync(new URL(
  './sql/parcelSessionCountyEpochFoundation.sql',import.meta.url),'utf8');
const run=readFileSync(new URL(
  './sql/parcelRunSelectionEpochFoundation.sql',import.meta.url),'utf8');
const smoke=readFileSync(new URL(
  '../../../scripts/bdp/parcel-session-run-epoch-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('43 SQL drafts are atomic DBA-only and no public GRANT or login exists',()=>{
  for(const sql of [auth,run]){
    assert.match(sql,/^BEGIN;/m);
    assert.match(sql,/^COMMIT;/m);
    assert.doesNotMatch(sql,/^\s*GRANT\s/mi);
    assert.doesNotMatch(sql,/CREATE ROLE|CREATE USER|CREATE SERVER/i);
    assert.match(sql,/REVOKE ALL ON/);
    assert.match(sql,/SECURITY DEFINER/);
    assert.match(sql,/SET search_path = pg_catalog, pg_temp/);
  }
});

test('account/session revision schema is separate from GIS parcel index',()=>{
  assert.match(auth,/CREATE SCHEMA ldos_private_auth/);
  assert.match(auth,/REVOKE ALL ON SCHEMA ldos_private_auth FROM PUBLIC/);
  assert.doesNotMatch(auth,/ST_AsGeoJSON|ST_Transform|geometry\s*\(/i);
  assert.match(auth,/NOT the actual authentication or MFA service/i);
});

test('synthetic account/county decisions default to deny on every dimension',()=>{
  for(const flag of [
    'account_active','mfa_verified','session_active','allow_discovery',
  ])assert.match(auth,new RegExp(flag+' boolean NOT NULL DEFAULT FALSE'));
  assert.match(auth,/PRIMARY KEY \(session_digest,county_fips\)/);
  assert.match(auth,/session_digest ~ '\^\[0-9a-f\]\{64\}\$'/);
});

test('session/county epochs are positive durable BIGINT and never reset by delete',()=>{
  assert.match(auth,/CREATE TABLE ldos_private_auth\.session_county_epochs/);
  assert.match(auth,/epoch bigint NOT NULL CHECK \(epoch > 0\)/);
  assert.match(auth,/PRIMARY KEY \(session_digest,county_fips\)/);
  assert.doesNotMatch(auth,/REFERENCES ldos_private_auth\.session_county_decisions/);
});

test('every INSERT UPDATE DELETE changes grant epoch under a row lock',()=>{
  assert.match(auth,/AFTER INSERT OR UPDATE OR DELETE ON ldos_private_auth\.session_county_decisions/);
  assert.match(auth,/ON CONFLICT \(session_digest,county_fips\)/);
  assert.match(auth,/epoch=current_epoch\.epoch\+1/);
  assert.doesNotMatch(auth,/\bnextval\s*\(/i);
});

test('session key reassignment and TRUNCATE cannot bypass identity/epoch',()=>{
  assert.match(auth,/BEFORE UPDATE ON ldos_private_auth\.session_county_decisions/);
  assert.match(auth,/OLD\.session_digest IS DISTINCT FROM NEW\.session_digest/);
  assert.match(auth,/OLD\.county_fips IS DISTINCT FROM NEW\.county_fips/);
  assert.match(auth,/Session grant identity cannot change/);
  assert.match(auth,/BEFORE TRUNCATE ON ldos_private_auth\.session_county_decisions/);
  assert.match(auth,/Session grant TRUNCATE prohibited/);
});

test('run-selection counter uses source/county identity, not claimed coverage',()=>{
  assert.match(run,/CREATE TABLE bdp_parcel_index\.parcel_run_selection_epochs/);
  assert.match(run,/PRIMARY KEY \(source_id,county_fips\)/);
  assert.match(run,/epoch bigint NOT NULL CHECK \(epoch > 0\)/);
  assert.doesNotMatch(run,/allow_geometry_redistribution|approved.*AS verified/);
});

test('run epoch installation locks all relevant rights/ingest/seal tables',()=>{
  assert.match(run,/LOCK TABLE bdp_parcel_index\.source_registry,/);
  assert.match(run,/bdp_parcel_index\.ingest_runs,/);
  assert.match(run,/bdp_parcel_index\.parcel_run_seals IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(run,/Historic transitions CANNOT be reconstructed/i);
});

test('new finished-run writes and future seals independently advance epochs',()=>{
  assert.match(run,/AFTER INSERT OR UPDATE OR DELETE ON bdp_parcel_index\.ingest_runs/);
  assert.match(run,/AFTER INSERT ON bdp_parcel_index\.parcel_run_seals/);
  assert.match(run,/ON CONFLICT \(source_id,county_fips\)/);
  assert.match(run,/epoch=current_epoch\.epoch\+1/);
});

test('sealed run identity remains immutable and TRUNCATE CASCADE fails',()=>{
  assert.match(run,/BEFORE UPDATE ON bdp_parcel_index\.ingest_runs/);
  assert.match(run,/OLD\.source_id IS DISTINCT FROM NEW\.source_id/);
  assert.match(run,/BEFORE TRUNCATE ON bdp_parcel_index\.ingest_runs/);
  assert.match(run,/BEFORE TRUNCATE ON bdp_parcel_index\.parcel_run_seals/);
  assert.match(run,/Run selection TRUNCATE prohibited/);
});

test('exact disposable-only flag required before any Docker interaction',()=>{
  assert.equal(requireSessionRunEpochDisposableOptIn(['--disposable-only']),true);
  for(const args of [
    null,[],['--prod'],['--local'],
    ['--disposable-only','--reuse'],
    ['--disposable-only','--disposable-only'],
  ])assert.throws(()=>requireSessionRunEpochDisposableOptIn(args),
    /Refusing session\/run epoch smoke/);
});

test('invalid opt-in refuses before starting Docker',async()=>{
  await assert.rejects(runSessionRunEpochDisposableSmoke(['--production']),
    /Refusing session\/run epoch smoke/);
});

test('Docker uses no network, ports, mounts, or existing BDP connection',()=>{
  assert.match(smoke,/docker\(\['run','-d','--name',name,'--network','none'/);
  assert.doesNotMatch(smoke,/'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.match(smoke,/docker\(\['rm','--force','--volumes',name\]/);
  assert.match(smoke,/replaceAll\(password,'\[redacted\]'\)/);
  assert.doesNotMatch(smoke,/bdp-postgis|connectionString|new Pool\(|\.listen\(/);
});

test('only synthetic county/source records and draft SQL are used',()=>{
  for(const item of [
    'SYNTHETIC_DRIVER_FIXTURE_SQL','EXTRA_SYNTHETIC_PARCELS_SQL',
    'parcelIndexFoundation.sql','parcelRestrictedRpcFoundation.sql',
    'parcelRunSealFoundation.sql','parcelSessionCountyEpochFoundation.sql',
    'parcelRunSelectionEpochFoundation.sql','step40c13-synthetic',
  ])assert.ok(smoke.includes(item),item);
});

test('session ABA revoke and reapprove preserve current facts but not version',()=>{
  for(const item of [
    'ABA returns identical grant facts','sessionEpoch(),2n',
    'sessionEpoch(),3n','sessionEpoch(),4n',
    'Reapprove cannot reuse session/county revision',
    'DELETE FROM ldos_private_auth.session_county_decisions',
    'sessionEpoch(),6n',
  ])assert.ok(smoke.includes(item),item);
});

test('session rollback and TRUNCATE denial leave original epoch untouched',()=>{
  assert.match(smoke,/Session grant TRUNCATE prohibited/);
  assert.match(smoke,/assert\.equal\(sessionEpoch\(\),4n/);
  assert.match(smoke,/assert\.equal\(grantState\(\),approved\)/);
  assert.match(smoke,/Session grant identity cannot change/);
});

test('run seal bumps selection revision and cannot mutate its immutable seal',()=>{
  for(const item of [
    'runEpoch(),1n','runEpoch(),2n','runEpoch(),3n',
    'Sealed parcel run is immutable','runEpoch(),4n',
    'runEpoch(),5n','Run selection TRUNCATE prohibited',
  ])assert.ok(smoke.includes(item),item);
});

test('session and run epochs remain unavailable to ordinary application roles',()=>{
  for(const table of [
    'ldos_private_auth.session_county_epochs',
    'ldos_private_auth.session_county_decisions',
    'bdp_parcel_index.parcel_run_selection_epochs',
    'bdp_parcel_index.parcel_run_seals',
  ])assert.ok(smoke.includes(table),table);
  assert.match(smoke,/has_table_privilege/);
  assert.match(smoke,/permission denied/i);
});

test('test creates no real session cookie, publisher, or browser geometry',()=>{
  assert.match(SESSION_RUN_EPOCH_SMOKE_PASS,
    /^PASS: disposable PostGIS session\/county and sealed-run epochs/);
  assert.match(smoke,/NOT a real application account store/);
  assert.doesNotMatch(smoke,/createServer\(|app\.get\(|ST_AsGeoJSON/);
});
