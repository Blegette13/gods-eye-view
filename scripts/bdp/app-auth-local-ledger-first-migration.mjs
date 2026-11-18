import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Step 40C-62D-C2: opt-in, exact-target, initial schema ONLY. */
export const CONTAINER='ldos-auth-dev-auth-postgres-1';
export const LEDGER_BLOB='e0b2be7140e9abcbfa0d6a0ac47beca86d7f9fa7';
export const PASS='PASS: local dev-only auth ledger schema installed; deny-first accounts/sessions/county-grants empty; no reader role or GIS rights.';

export function requireFlag(args){
  if(!Array.isArray(args)||args.length!==1
    || !['--plan-only','--apply-local-auth-only'].includes(args[0]))
    throw new Error('Use exactly --plan-only or --apply-local-auth-only');
  return args[0];
}
export function gitBlob(text){
  if(typeof text!=='string')throw new TypeError('SQL source missing');
  return createHash('sha1')
    .update('blob '+Buffer.byteLength(text,'utf8')+'\0')
    .update(text,'utf8').digest('hex');
}
export function makeMigration(source){
  if(gitBlob(source)!==LEDGER_BLOB)
    throw new Error('Auth ledger source changed; review before migration');
  const stripped=source.replace(/^(?:--[^\n]*\r?\n)*/,'').trim();
  const match=/^BEGIN;\s*\n([\s\S]*?)\r?\nCOMMIT;$/.exec(stripped);
  if(!match || match[0]!==stripped)
    throw new Error('Unexpected atomic ledger SQL framing');
  const sqlBody=match[1];
  for(const required of ['CREATE SCHEMA ldos_app_auth;',
    'CREATE TABLE ldos_app_auth.accounts',
    'CREATE TABLE ldos_app_auth.sessions',
    'CREATE TABLE ldos_app_auth.county_grants']){
    if(!sqlBody.includes(required))throw new Error('Ledger SQL mismatch');
  }
  const guard=[
    'BEGIN;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '30s';",
    'DO $local_dev_guard$',
    'BEGIN',
    " IF current_database() <> 'ldos_auth_dev'",
    '    OR pg_is_in_recovery()',
    "    OR current_user <> 'postgres'",
    "    OR to_regnamespace('ldos_app_auth') IS NOT NULL",
    "    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles",
    "      WHERE rolname = 'ldos_auth_account_reader') THEN",
    "   RAISE EXCEPTION 'Unapproved local dev DB migration target';",
    ' END IF;',
    'END',
    '$local_dev_guard$;',
  ].join('\n');
  return guard+'\n'+sqlBody+'\nCOMMIT;\n';
}
export function verifyTarget({labels,image,health,ports,mounts}={}){
  if(!labels || labels['com.docker.compose.project']!=='ldos-auth-dev'
    || labels['com.docker.compose.service']!=='auth-postgres'
    || image!=='postgres:17' || health!=='healthy'
    || !ports || Object.keys(ports).length!==1
    || !Array.isArray(ports['5432/tcp'])
    || ports['5432/tcp'].length!==1
    || ports['5432/tcp'][0].HostIp!=='127.0.0.1'
    || ports['5432/tcp'][0].HostPort!=='54338'
    || !Array.isArray(mounts) || mounts.length!==1
    || mounts[0].Type!=='volume'
    || mounts[0].Name!=='ldos-auth-dev_ldos_auth_dev_pgdata'
    || mounts[0].Destination!=='/var/lib/postgresql/data')
    throw new Error('Unrecognized auth-dev Docker container; STOP');
  return true;
}
export function verifyPreflight(x){
  if(typeof x!=='string'||x.trim()!=='ldos_auth_dev|f|t|t')
    throw new Error('Auth-dev primary or schema/role state changed; STOP');
  return true;
}
export function verifyPostflight(x){
  if(typeof x!=='string'||x.trim()!=='ldos_auth_dev|f|t|0|0|0|t')
    throw new Error('Auth-dev schema empty/role checks failed; STOP');
  return true;
}
function docker(args,{input,timeout=20000}={}){
  const r=spawnSync('docker',args,{
    input,encoding:'utf8',windowsHide:true,timeout,maxBuffer:1024*1024,
  });
  if(r.error||r.status!==0)throw new Error('Local Docker operation unavailable');
  return String(r.stdout||'').trim();
}
function inspect(tmpl){return docker(['inspect','--format',tmpl,CONTAINER])}
function metadata(){
  return {
    labels:JSON.parse(inspect('{{json .Config.Labels}}')),
    image:inspect('{{.Config.Image}}'),
    health:inspect('{{.State.Health.Status}}'),
    ports:JSON.parse(inspect('{{json .NetworkSettings.Ports}}')),
    mounts:JSON.parse(inspect('{{json .Mounts}}')),
  };
}
const preflight=[
  'SELECT current_database(),pg_is_in_recovery(),',
  "to_regnamespace('ldos_app_auth') IS NULL,",
  "NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ldos_auth_account_reader');",
].join('\n');
const postflight=[
  'SELECT current_database(),pg_is_in_recovery(),',
  "to_regnamespace('ldos_app_auth') IS NOT NULL,",
  '(SELECT count(*) FROM ldos_app_auth.accounts),',
  '(SELECT count(*) FROM ldos_app_auth.sessions),',
  '(SELECT count(*) FROM ldos_app_auth.county_grants),',
  "NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ldos_auth_account_reader');",
].join('\n');
function psql(args,stdin){
  return docker(['exec','-i',CONTAINER,'psql','-X','-U','postgres',
    '-d','ldos_auth_dev','-v','ON_ERROR_STOP=1','-A','-t','-q',...args],
    {input:stdin,timeout:55000});
}
export function planSummary(source){
  const sql=makeMigration(source);
  return Object.freeze({
    db:'ldos_auth_dev',container:CONTAINER,sourceBlob:LEDGER_BLOB,
    bytes:Buffer.byteLength(sql,'utf8'),createsRoles:false,createsUsers:false,
    createsSessions:false,createsCountyGrants:false,grantsGisRights:false,
  });
}
export function runLocalSchemaMigration(args=process.argv.slice(2)){
  const flag=requireFlag(args);
  const source=readFileSync(new URL(
    '../../server/standalone/sql/landOsAccountAuthorityFoundation.sql',
    import.meta.url,
  ),'utf8');
  const summary=planSummary(source);
  if(flag==='--plan-only'){
    process.stdout.write('PLAN: exact reviewed local dev schema only; no Docker commands or writes; source '+summary.sourceBlob+'.\n');
    return summary;
  }
  let stage='Docker target attestation';
  try{
    verifyTarget(metadata());
    stage='read-only SQL target preflight';
    verifyPreflight(psql(['-c',preflight]));
    stage='atomic initial auth-ledger schema';
    psql([],makeMigration(source));
    stage='read-only empty-schema postflight';
    verifyPostflight(psql(['-c',postflight]));
    process.stdout.write(PASS+'\n');
    return true;
  }catch{
    throw new Error('Local app-auth migration failed at '+stage+'; STOP, inspect local instance before retrying');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{runLocalSchemaMigration()}
  catch(e){process.stderr.write(e.message+'\n');process.exitCode=1}
}
