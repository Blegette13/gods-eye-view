import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CONTAINER,LEDGER_BLOB,PASS,requireFlag,gitBlob,makeMigration,
  verifyTarget,verifyPreflight,verifyPostflight,planSummary,
  runLocalSchemaMigration,
} from '../../../scripts/bdp/app-auth-local-ledger-first-migration.mjs';

const source=readFileSync(new URL(
  '../../../server/standalone/sql/landOsAccountAuthorityFoundation.sql',
  import.meta.url,
),'utf8');
const metadata=()=>({
  labels:{
    'com.docker.compose.project':'ldos-auth-dev',
    'com.docker.compose.service':'auth-postgres',
  },
  image:'postgres:17',health:'healthy',
  ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'54338'}]},
  mounts:[{Type:'volume',Name:'ldos-auth-dev_ldos_auth_dev_pgdata',
    Destination:'/var/lib/postgresql/data'}],
});

test('62D-C2 requires a single explicit plan-only or apply-local-auth-only flag',()=>{
  assert.equal(requireFlag(['--plan-only']),'--plan-only');
  assert.equal(requireFlag(['--apply-local-auth-only']),'--apply-local-auth-only');
  for(const flags of [[],null,['--prod'],['--apply'],['--local-dev-only'],
    ['--apply-local-auth-only','--force'],['--plan-only','--apply-local-auth-only']])
    assert.throws(()=>requireFlag(flags));
});
test('62D-C2 source-controlled exact Git blob matches the reviewed existing SQL',()=>{
  assert.equal(gitBlob(source),LEDGER_BLOB);
  assert.match(LEDGER_BLOB,/^[0-9a-f]{40}$/);
});
test('62D-C2 refuses altered SQL including extra privileges, fake accounts and comments',()=>{
  for(const changed of [source+' ',source.replace('CREATE SCHEMA','CREATE ROLE reader; CREATE SCHEMA'),
    source.replace('DEFAULT \'suspended\'','DEFAULT \'active\''),
    source.replace('COMMIT;','COMMIT; SELECT 1;')])
    assert.throws(()=>makeMigration(changed),/source changed/);
});
test('62D-C2 rejects malformed or nonexistent ledger source',()=>{
  assert.throws(()=>makeMigration('BEGIN; COMMIT;'));
  assert.throws(()=>gitBlob(null),TypeError);
});
test('62D-C2 generates a single guarded BEGIN and final COMMIT with no nested transaction',()=>{
  const sql=makeMigration(source);
  assert.equal((sql.match(/^BEGIN;$/gm)||[]).length,1);
  assert.equal((sql.match(/^COMMIT;$/gm)||[]).length,1);
  assert.match(sql,/^BEGIN;\nSET LOCAL lock_timeout/m);
  assert.ok(sql.trimEnd().endsWith('COMMIT;'));
});
test('62D-C2 SQL validates actual DB name, current primary, postgres role and uninitialized schema',()=>{
  const sql=makeMigration(source);
  for(const fragment of [
    "current_database() <> 'ldos_auth_dev'",
    'pg_is_in_recovery()',
    "current_user <> 'postgres'",
    "to_regnamespace('ldos_app_auth') IS NOT NULL",
    "rolname = 'ldos_auth_account_reader'",
    "RAISE EXCEPTION 'Unapproved local dev DB migration target'",
  ])assert.ok(sql.includes(fragment),fragment);
});
test('62D-C2 SQL leaves default-deny accounts sessions and county grants intact',()=>{
  const sql=makeMigration(source);
  for(const fragment of [
    "DEFAULT 'suspended'","DEFAULT 'revoked'",
    "DEFAULT 'unverified'","DEFAULT 'denied'",
    'CREATE TRIGGER account_revision',
    'CREATE TRIGGER session_revision',
    'CREATE TRIGGER county_grant_revision',
    'REVOKE ALL ON ALL TABLES IN SCHEMA ldos_app_auth FROM PUBLIC',
  ])assert.ok(sql.includes(fragment),fragment);
});
test('62D-C2 SQL creates no real user, reader/writer role, or county entitlement',()=>{
  const sql=makeMigration(source).replace(/^--.*$/gm,'');
  assert.doesNotMatch(sql,/CREATE ROLE|GRANT SELECT|INSERT INTO|INSERT\s+ldos_app_auth|SET ROLE/);
});
test('62D-C2 expected pinned Docker service and exact loopback-only storage passes',()=>{
  assert.equal(verifyTarget(metadata()),true);
  assert.equal(CONTAINER,'ldos-auth-dev-auth-postgres-1');
});
test('62D-C2 refuses another Docker Compose project, service, or image',()=>{
  for(const v of [
    {labels:{...metadata().labels,'com.docker.compose.project':'bdp'}},
    {labels:{...metadata().labels,'com.docker.compose.service':'parcel-postgis'}},
    {image:'postgis/postgis:17-3.5'}, {health:'unhealthy'},
  ])assert.throws(()=>verifyTarget({...metadata(),...v}));
});
test('62D-C2 refuses exposed, remapped or multiple container network bindings',()=>{
  const cases=[
    {'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'54338'}]},
    {'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'5432'}]},
    {'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'54338'}],'5433/tcp':null},
    {'5432/tcp':[]},{},
  ];
  for(const ports of cases)assert.throws(()=>verifyTarget({...metadata(),ports}));
});
test('62D-C2 refuses foreign volumes, host mounts or multiple mounts',()=>{
  for(const mounts of [
    [],[{...metadata().mounts[0],Name:'bdp_postgis_data'}],
    [{...metadata().mounts[0],Type:'bind'}],
    [{...metadata().mounts[0],Destination:'/var/lib/postgresql'}],
    [metadata().mounts[0],metadata().mounts[0]],
  ])assert.throws(()=>verifyTarget({...metadata(),mounts}));
});
test('62D-C2 read-only SQL preflight accepts only the exact untouched primary result',()=>{
  assert.equal(verifyPreflight('ldos_auth_dev|f|t|t\n'),true);
  for(const x of ['ldos_auth_dev|t|t|t','postgres|f|t|t',
    'ldos_auth_dev|f|f|t','ldos_auth_dev|f|t|f','',
    'ldos_auth_dev|f|t|t\nother'])assert.throws(()=>verifyPreflight(x));
});
test('62D-C2 after migration requires all three tables empty and role still absent',()=>{
  assert.equal(verifyPostflight('ldos_auth_dev|f|t|0|0|0|t'),true);
  for(const x of ['ldos_auth_dev|f|t|1|0|0|t',
    'ldos_auth_dev|f|t|0|1|0|t',
    'ldos_auth_dev|f|t|0|0|1|t',
    'ldos_auth_dev|f|t|0|0|0|f',
    'ldos_auth_dev|f|f|0|0|0|t'])assert.throws(()=>verifyPostflight(x));
});
test('62D-C2 plan reports no roles, users, sessions, county grants or GIS rights',()=>{
  assert.deepEqual(planSummary(source),{
    db:'ldos_auth_dev',container:CONTAINER,sourceBlob:LEDGER_BLOB,
    bytes:Buffer.byteLength(makeMigration(source),'utf8'),
    createsRoles:false,createsUsers:false,createsSessions:false,
    createsCountyGrants:false,grantsGisRights:false,
  });
});
test('62D-C2 plan-only executes without Docker and without writing tables',()=>{
  const summary=runLocalSchemaMigration(['--plan-only']);
  assert.equal(summary.db,'ldos_auth_dev');
  assert.equal(summary.createsUsers,false);
});
test('62D-C2 implementation never invokes pg pool, external URL or Supabase keys',()=>{
  const script=readFileSync(new URL(
    '../../../scripts/bdp/app-auth-local-ledger-first-migration.mjs',
    import.meta.url,
  ),'utf8');
  assert.doesNotMatch(script,/new Pool\(|createServer\(|SUPABASE|sb_secret_|HTTP|fetch\(/);
  assert.match(PASS,/no reader role or GIS rights/);
  assert.ok(script.includes("'--apply-local-auth-only'"));
  assert.ok(script.includes("'ldos_auth_dev'"));
});
