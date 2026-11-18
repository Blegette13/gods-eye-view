import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CONTAINER,verifyTarget} from './app-auth-local-ledger-first-migration.mjs';

/** Step 40C-62D-C5: staged, local-dev-only NOLOGIN account-reader role. */
export const ROLE='ldos_auth_account_reader';
export const PASS='PASS: local auth-dev NOLOGIN account reader installed with account-column SELECT only; no credentials, users, sessions, county grants or GIS rights.';
export const PREFLIGHT_OK='ldos_auth_dev|f|t|0|0|0|t|t';
export const POSTFLIGHT_OK='ldos_auth_dev|f|t|0|0|0|t';

export function requireFlag(args){
  if(!Array.isArray(args)||args.length!==1
    || !['--plan-only','--apply-local-auth-only'].includes(args[0]))
    throw new Error('Use exactly --plan-only or --apply-local-auth-only');
  return args[0];
}

// The canonical account reader is intentionally NOLOGIN. A separate, later,
// vetted credential/LOGIN migration is required before any SQL driver use.
// It receives no SELECT on sessions/county grants, no writes and no GIS rights.
export function makeRoleMigration(){
  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $local_auth_reader_guard$
BEGIN
  IF current_database() <> 'ldos_auth_dev'
    OR pg_is_in_recovery()
    OR current_user <> 'postgres'
    OR to_regnamespace('ldos_app_auth') IS NULL
    OR to_regclass('ldos_app_auth.accounts') IS NULL
    OR to_regclass('ldos_app_auth.sessions') IS NULL
    OR to_regclass('ldos_app_auth.county_grants') IS NULL
    OR to_regprocedure('ldos_app_auth.current_county_candidate_rpc(text,text)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ldos_auth_account_reader')
    OR EXISTS (SELECT 1 FROM ldos_app_auth.accounts)
    OR EXISTS (SELECT 1 FROM ldos_app_auth.sessions)
    OR EXISTS (SELECT 1 FROM ldos_app_auth.county_grants) THEN
    RAISE EXCEPTION 'Unapproved local account reader migration target';
  END IF;
END
$local_auth_reader_guard$;
CREATE ROLE ldos_auth_account_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA ldos_app_auth TO ldos_auth_account_reader;
GRANT SELECT (subject, account_state, revision)
  ON TABLE ldos_app_auth.accounts TO ldos_auth_account_reader;
COMMIT;
`;
}

// Read-only query. Exact target, three empty ledger tables, no reader role,
// and no earlier candidate RPC deployment (that has separate owner rules).
export const PREFLIGHT_SQL=`SELECT current_database(),pg_is_in_recovery(),
  to_regnamespace('ldos_app_auth') IS NOT NULL,
  (SELECT count(*) FROM ldos_app_auth.accounts),
  (SELECT count(*) FROM ldos_app_auth.sessions),
  (SELECT count(*) FROM ldos_app_auth.county_grants),
  NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ldos_auth_account_reader'),
  to_regprocedure('ldos_app_auth.current_county_candidate_rpc(text,text)') IS NULL;`;

// Every right tested under the exact new role. TRUE only for the minimal
// column grants; other columns, tables, mutations and role membership deny.
export const POSTFLIGHT_SQL=`SELECT current_database(),pg_is_in_recovery(),
  to_regnamespace('ldos_app_auth') IS NOT NULL,
  (SELECT count(*) FROM ldos_app_auth.accounts),
  (SELECT count(*) FROM ldos_app_auth.sessions),
  (SELECT count(*) FROM ldos_app_auth.county_grants),
  (
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ldos_auth_account_reader'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
      AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
      AND NOT rolinherit)
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r
      ON r.oid=m.member OR r.oid=m.roleid
      WHERE r.rolname='ldos_auth_account_reader')
    AND has_schema_privilege('ldos_auth_account_reader','ldos_app_auth','USAGE')
    AND NOT has_schema_privilege('ldos_auth_account_reader','ldos_app_auth','CREATE')
    AND has_column_privilege('ldos_auth_account_reader','ldos_app_auth.accounts','subject','SELECT')
    AND has_column_privilege('ldos_auth_account_reader','ldos_app_auth.accounts','account_state','SELECT')
    AND has_column_privilege('ldos_auth_account_reader','ldos_app_auth.accounts','revision','SELECT')
    AND NOT has_column_privilege('ldos_auth_account_reader','ldos_app_auth.accounts','created_at','SELECT')
    AND NOT has_table_privilege('ldos_auth_account_reader','ldos_app_auth.accounts','INSERT')
    AND NOT has_table_privilege('ldos_auth_account_reader','ldos_app_auth.accounts','UPDATE')
    AND NOT has_table_privilege('ldos_auth_account_reader','ldos_app_auth.accounts','DELETE')
    AND NOT has_table_privilege('ldos_auth_account_reader','ldos_app_auth.accounts','TRUNCATE')
    AND NOT has_table_privilege('ldos_auth_account_reader','ldos_app_auth.sessions','SELECT')
    AND NOT has_table_privilege('ldos_auth_account_reader','ldos_app_auth.county_grants','SELECT')
    AND NOT has_function_privilege('ldos_auth_account_reader','ldos_app_auth.guard_revision()','EXECUTE')
    AND to_regprocedure('ldos_app_auth.current_county_candidate_rpc(text,text)') IS NULL
  );`;

export function verifyPreflight(output){
  if(typeof output!=='string'||output.trim()!==PREFLIGHT_OK)
    throw new Error('Auth-dev role preflight mismatch; STOP');
  return true;
}
export function verifyPostflight(output){
  if(typeof output!=='string'||output.trim()!==POSTFLIGHT_OK)
    throw new Error('Auth-dev reader role grants mismatch; STOP');
  return true;
}
export function planSummary(){
  return Object.freeze({
    db:'ldos_auth_dev', container:CONTAINER, role:ROLE,
    login:false, createsPassword:false, createsUsers:false,
    grantsAccountColumnSelect:true, grantsSessionRead:false,
    grantsCountyRead:false, grantsWrite:false, grantsGisRights:false,
  });
}
function docker(args,{input,timeout=20000}={}){
  const r=spawnSync('docker',args,{
    input,encoding:'utf8',windowsHide:true,timeout,maxBuffer:1024*1024,
  });
  if(r.error||r.status!==0)throw new Error('Local Docker operation unavailable');
  return String(r.stdout||'').trim();
}
function inspect(template){return docker(['inspect','--format',template,CONTAINER])}
function metadata(){return {
  labels:JSON.parse(inspect('{{json .Config.Labels}}')),
  image:inspect('{{.Config.Image}}'),
  health:inspect('{{.State.Health.Status}}'),
  ports:JSON.parse(inspect('{{json .NetworkSettings.Ports}}')),
  mounts:JSON.parse(inspect('{{json .Mounts}}')),
};}
function psql(args,input){
  return docker(['exec','-i',CONTAINER,'psql','-X','-U','postgres',
    '-d','ldos_auth_dev','-v','ON_ERROR_STOP=1','-A','-t','-q',...args],
  {input,timeout:55000});
}
export function runLocalReaderRoleMigration(args=process.argv.slice(2)){
  const flag=requireFlag(args);
  const plan=planSummary();
  if(flag==='--plan-only'){
    process.stdout.write('PLAN: exact local auth-dev NOLOGIN account reader; three SELECT columns only; no Docker commands or writes.\n');
    return plan;
  }
  let stage='Docker target attestation';
  try{
    verifyTarget(metadata());
    stage='read-only ledger/role preflight';
    verifyPreflight(psql(['-c',PREFLIGHT_SQL]));
    stage='atomic NOLOGIN account reader role migration';
    psql([],makeRoleMigration());
    stage='read-only privilege/empty-ledger postflight';
    verifyPostflight(psql(['-c',POSTFLIGHT_SQL]));
    process.stdout.write(PASS+'\n');
    return true;
  }catch{
    throw new Error('Local reader role migration failed at '+stage+'; STOP, inspect local instance before retrying');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{runLocalReaderRoleMigration()}
  catch(e){process.stderr.write(e.message+'\n');process.exitCode=1}
}
