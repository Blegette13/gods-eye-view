import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CONTAINER,verifyTarget} from './app-auth-local-ledger-first-migration.mjs';
import {
  POSTFLIGHT_SQL,verifyPostflight,
} from './app-auth-local-reader-role-migration.mjs';

/**
 * Step 40C-62D-C8 — persistent, local-dev-only READ-ONLY account gateway
 * readiness attestation. Absolutely no role, credential, user, session,
 * permission, or GIS mutation is performed by this script.
 */
export const PASS='PASS: local persistent auth-dev primary and NOLOGIN account-reader privileges verified; gateway LOGIN absent, ledger empty, candidate RPC absent; no database writes.';
export const READINESS_EXPECTED='ldos_auth_dev|f|t|t|t|t';

export const READINESS_SQL=[
  'SELECT',
  '  current_database(),',
  '  pg_is_in_recovery(),',
  "  current_user = 'postgres',",
  '  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles',
  "    WHERE rolname = 'ldos_auth_gateway_login'),",
  "  to_regprocedure('ldos_app_auth.current_county_candidate_rpc(text,text)') IS NULL,",
  '  (SELECT count(*) = 0 FROM ldos_app_auth.accounts)',
  '    AND (SELECT count(*) = 0 FROM ldos_app_auth.sessions)',
  '    AND (SELECT count(*) = 0 FROM ldos_app_auth.county_grants);',
].join('\n');

export function requireReadOnlyFlag(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--check-local-auth-only')
    throw new Error('Use exactly --check-local-auth-only');
  return true;
}
export function verifyReadiness(output){
  if(typeof output!=='string'||output.trim()!==READINESS_EXPECTED)
    throw new Error('Local account gateway readiness mismatch; STOP');
  return true;
}
function docker(args){
  const p=spawnSync('docker',args,{
    encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:1024*1024,
  });
  if(p.error||p.status!==0)throw new Error('Read-only Docker probe unavailable');
  return String(p.stdout||'').trim();
}
function metadata(){
  const inspect=(template)=>docker(['inspect','--format',template,CONTAINER]);
  return {
    labels:JSON.parse(inspect('{{json .Config.Labels}}')),
    image:inspect('{{.Config.Image}}'),
    health:inspect('{{.State.Health.Status}}'),
    ports:JSON.parse(inspect('{{json .NetworkSettings.Ports}}')),
    mounts:JSON.parse(inspect('{{json .Mounts}}')),
  };
}
function query(sql){
  return docker(['exec',CONTAINER,'psql','-X','-U','postgres',
    '-d','ldos_auth_dev','-v','ON_ERROR_STOP=1','-A','-t','-q','-c',sql]);
}
export function runReadOnlyAuthGatewayPreflight(args=process.argv.slice(2)){
  requireReadOnlyFlag(args);
  let stage='exact Docker target attestation';
  try{
    verifyTarget(metadata());
    stage='read-only primary/gateway/ledger readiness';
    verifyReadiness(query(READINESS_SQL));
    stage='read-only NOLOGIN account-reader role ACL attestation';
    verifyPostflight(query(POSTFLIGHT_SQL));
    process.stdout.write(PASS+'\n');
    return true;
  }catch{
    throw new Error('Local auth gateway read-only preflight failed at '+stage+
      '; STOP and inspect, no writes attempted');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{runReadOnlyAuthGatewayPreflight()}
  catch(e){process.stderr.write(e.message+'\n');process.exitCode=1}
}
