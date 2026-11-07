import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  POLICY_EPOCH_SMOKE_PASS,requirePolicyEpochDisposableOptIn,
  runPolicyEpochDisposableSmoke,
} from '../../../scripts/bdp/parcel-policy-epoch-disposable-smoke.mjs';

const sql=readFileSync(new URL(
  './sql/parcelPolicyEpochFoundation.sql',import.meta.url),'utf8');
const smoke=readFileSync(new URL(
  '../../../scripts/bdp/parcel-policy-epoch-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('40C40 migration draft is transactional and has zero application GRANTs',()=>{
  assert.match(sql,/^BEGIN;/m);
  assert.match(sql,/^COMMIT;/m);
  assert.match(sql,/DBA-REVIEW-ONLY/);
  assert.doesNotMatch(sql,/^\s*GRANT\s/mi);
  assert.doesNotMatch(sql,/CREATE ROLE|CREATE USER|CREATE OR REPLACE FUNCTION/i);
  assert.match(sql,/REVOKE ALL ON TABLE bdp_parcel_index\.parcel_policy_epochs FROM PUBLIC/);
});

test('epoch table contains only two explicit policy scopes and durable BIGINT',()=>{
  assert.match(sql,/CREATE TABLE bdp_parcel_index\.parcel_policy_epochs/);
  assert.match(sql,/policy_scope IN \('source_cache','geometry_publication'\)/);
  assert.match(sql,/epoch bigint NOT NULL CHECK \(epoch > 0\)/);
  assert.match(sql,/PRIMARY KEY \(policy_scope,source_id\)/);
  assert.doesNotMatch(sql,/current_user|sessionHandle|countyGrants|ST_AsGeoJSON/);
});

test('backfill marks known records at epoch 1, not invented historical rights',()=>{
  assert.match(sql,/SELECT 'source_cache',source_id,1[\s\S]*?FROM bdp_parcel_index\.source_registry/);
  assert.match(sql,/SELECT 'geometry_publication',source_id,1[\s\S]*?FROM bdp_parcel_index\.geometry_publication_reviews/);
  assert.match(sql,/historical rights changes cannot be reconstructed/i);
});

test('both rights tables have INSERT UPDATE DELETE revision triggers',()=>{
  assert.match(sql,/CREATE TRIGGER source_cache_epoch_increment/);
  assert.match(sql,/CREATE TRIGGER geometry_publication_epoch_increment/);
  assert.equal((sql.match(/AFTER INSERT OR UPDATE OR DELETE/g)||[]).length,2);
  assert.equal((sql.match(/FOR EACH ROW EXECUTE FUNCTION/g)||[]).length,2);
});

test('trigger chooses policy scope from trusted table, never supplied epoch',()=>{
  assert.match(sql,/TG_TABLE_SCHEMA IS DISTINCT FROM 'bdp_parcel_index'/);
  assert.match(sql,/TG_TABLE_NAME = 'source_registry'/);
  assert.match(sql,/TG_TABLE_NAME = 'geometry_publication_reviews'/);
  assert.match(sql,/v_scope := 'source_cache'/);
  assert.match(sql,/v_scope := 'geometry_publication'/);
  assert.match(sql,/TG_OP = 'DELETE'/);
});

test('transactional UPSERT uses prior locked epoch not unsafe sequence nextval',()=>{
  assert.match(sql,/ON CONFLICT \(policy_scope,source_id\)/);
  assert.match(sql,/epoch = existing\.epoch \+ 1/);
  assert.match(sql,/SECURITY DEFINER/);
  assert.match(sql,/SET search_path = pg_catalog, pg_temp/);
  const statements=sql.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(statements,/SELECT max\(epoch\)|\bnextval\s*\(/i);
});

test('counter cannot be directly selected by existing metadata or PUBLIC role',()=>{
  assert.match(sql,/REVOKE ALL ON TABLE bdp_parcel_index\.parcel_policy_epochs\s+FROM ldos_parcel_rpc_client/);
  assert.match(sql,/REVOKE ALL ON FUNCTION bdp_parcel_index\.bump_parcel_policy_epoch\(\)\s+FROM PUBLIC/);
  assert.match(sql,/REVOKE ALL ON FUNCTION bdp_parcel_index\.bump_parcel_policy_epoch\(\)\s+FROM ldos_parcel_rpc_client/);
});

test('policy moves invalidate both old and new source keys',()=>{
  assert.match(sql,/IF TG_OP = 'UPDATE' THEN/);
  assert.match(sql,/OLD\.source_id IS DISTINCT FROM NEW\.source_id/);
  assert.match(sql,/VALUES \(v_scope,OLD\.source_id,1,clock_timestamp\(\)\)/);
  assert.match(sql,/VALUES \(v_scope,v_source,1,clock_timestamp\(\)\)/);
});

test('40C40 Docker smoke cannot run without exact one disposable-only flag',()=>{
  assert.equal(requirePolicyEpochDisposableOptIn(['--disposable-only']),true);
  for(const args of [
    null,[],['--local'],['--prod'],['--disposable-only','--reuse'],
    ['--disposable-only','--disposable-only'],
  ]) assert.throws(()=>requirePolicyEpochDisposableOptIn(args),
    /Refusing policy-epoch smoke/);
});

test('invalid flag rejects before any Docker action',async()=>{
  await assert.rejects(runPolicyEpochDisposableSmoke(['--production']),
    /Refusing policy-epoch smoke/);
});

test('Docker uses no network, host ports, bind mounts or persistent database',()=>{
  assert.match(smoke,/docker\(\['run','-d','--name',name,'--network','none'/);
  assert.doesNotMatch(smoke,/'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.match(smoke,/docker\(\['rm','--force','--volumes',name\]/);
  assert.match(smoke,/'POSTGRES_HOST_AUTH_METHOD=scram-sha-256'/);
  assert.match(smoke,/replaceAll\(password,'\[redacted\]'\)/);
  assert.doesNotMatch(smoke,/connectionString|bdp-postgis|new Pool\(|\.listen\(/);
});

test('smoke uses only invented source fixtures and exact reviewed schema drafts',()=>{
  for(const v of [
    'parcelIndexFoundation.sql',
    'parcelRestrictedRpcFoundation.sql',
    'parcelGeometryPublicationRightsFoundation.sql',
    'SYNTHETIC_DRIVER_FIXTURE_SQL',
    'parcelPolicyEpochFoundation.sql',
    'step40c13-synthetic',
  ]) assert.ok(smoke.includes(v),v);
});

test('same approved source facts after revoke reapprove have different epochs',()=>{
  assert.match(smoke,/A→B→A returns identical facts/);
  assert.match(smoke,/rights_state='revoked'/);
  assert.match(smoke,/rights_state='approved'/);
  assert.match(smoke,/assert\.equal\(restored,original/);
  assert.match(smoke,/assert\.equal\(v,3n/);
});

test('separate publication right ABA is never treated like cache approval',()=>{
  assert.match(smoke,/review_state='approved',allow_geometry_redistribution=TRUE/);
  assert.match(smoke,/review_state='revoked',allow_geometry_redistribution=FALSE/);
  assert.match(smoke,/assert\.equal\(restoredReview,originalReview/);
  assert.match(smoke,/assert\.equal\(legal,4n/);
  assert.match(smoke,/assert\.equal\(epoch\('source_cache'\),cacheBaseline\)/);
});

test('rollback does not persist epoch nor rights changes for either policy',()=>{
  assert.equal((smoke.match(/ROLLBACK;/g)||[]).length,2);
  assert.match(smoke,/assert\.equal\(epoch\('source_cache'\),v\)/);
  assert.match(smoke,/assert\.equal\(epoch\('geometry_publication'\),legal\)/);
});

test('DELETE and later INSERT cannot reset an earlier legal policy epoch',()=>{
  assert.match(smoke,/DELETE FROM bdp_parcel_index\.geometry_publication_reviews/);
  assert.match(smoke,/INSERT INTO bdp_parcel_index\.geometry_publication_reviews/);
  assert.match(smoke,/assert\.equal\(legal,6n\)/);
  assert.match(smoke,/rights operation due to timestamp\/policy shape equality/);
  assert.match(POLICY_EPOCH_SMOKE_PASS,
    /^PASS: disposable PostGIS policy epochs advance on ABA/);
});
