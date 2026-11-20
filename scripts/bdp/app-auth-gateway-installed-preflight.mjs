import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CONTAINER,verifyTarget} from './app-auth-local-ledger-first-migration.mjs';

/**
 * Step 40C-62D-C12 — READ-ONLY post-apply attestation of the persistent
 * restricted gateway principal. No passwords, mutations, app accounts, GIS.
 * Replays EXACTLY the source-reviewed C11 postflight SELECT.
 */
export const C12_PREFLIGHT_PASS=
  'PASS: C12 persistent local auth primary, restricted gateway LOGIN and SET-only NOLOGIN reader attested; empty ledger; no database writes.';
export const C12_POSTFLIGHT_EXPECTED='ldos_auth_dev|f|t|t|t|t|t|t|t|t';

export function requireC12CheckOnly(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--check-local-auth-only')
    throw new Error('C12 permits only --check-local-auth-only');
  return true;
}
export function extractC11Postflight(source){
  if(typeof source!=='string')throw new TypeError('C11 reviewed SQL source required');
  const m=/^[ \t]*\$postflight = @'\r?\n([\s\S]*?)\r?\n'@/m.exec(source);
  const sql=m?.[1]?.replace(/\r\n/g,'\n');
  if(!sql||!sql.trimStart().startsWith('SELECT\n')
    ||!sql.trimEnd().endsWith(';')
    ||!sql.includes("rolname='ldos_auth_gateway_login'")
    ||!sql.includes('NOT has_schema_privilege')
    ||!sql.includes('NOT has_table_privilege')
    ||!sql.includes("m.set_option")
    ||!sql.includes('FROM ldos_app_auth.county_grants')
    ||/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|ALTER|GRANT|REVOKE)\b/i.test(
      sql.replace(/'[^']*'/g,"''")
    ))throw new Error('C11 fixed read-only postflight changed; STOP');
  return sql;
}
export function verifyC12Postflight(output){
  if(typeof output!=='string'||output.trim()!==C12_POSTFLIGHT_EXPECTED)
    throw new Error('C12 installed role attestation mismatch; STOP');
  return true;
}
function docker(args){
  const r=spawnSync('docker',args,{
    encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:1024*1024,
  });
  if(r.error||r.status!==0)throw new Error('C12 local Docker probe unavailable');
  return String(r.stdout||'').trim();
}
function metadata(){
  const inspect=t=>docker(['inspect','--format',t,CONTAINER]);
  return {
    labels:JSON.parse(inspect('{{json .Config.Labels}}')),
    image:inspect('{{.Config.Image}}'),
    health:inspect('{{.State.Health.Status}}'),
    ports:JSON.parse(inspect('{{json .NetworkSettings.Ports}}')),
    mounts:JSON.parse(inspect('{{json .Mounts}}')),
  };
}
export function runC12InstalledRoleCheck(args=process.argv.slice(2)){
  requireC12CheckOnly(args);
  let stage='exact auth-dev Docker target';
  try{
    verifyTarget(metadata());
    stage='read-only installed gateway role postflight';
    const reviewed=readFileSync(new URL('./app-auth-dev-gateway-provision.ps1',import.meta.url),'utf8');
    const sql=extractC11Postflight(reviewed);
    const out=docker(['exec',CONTAINER,'psql','-X','-q','-A','-t',
      '-v','ON_ERROR_STOP=1','-U','postgres','-d','ldos_auth_dev',
      '-c',sql]);
    verifyC12Postflight(out);
    process.stdout.write(C12_PREFLIGHT_PASS+'\n');
    return true;
  }catch{
    throw new Error('C12 read-only gateway preflight failed at '+stage+
      '; STOP, do not rerun migrations');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{runC12InstalledRoleCheck()}
  catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
}
