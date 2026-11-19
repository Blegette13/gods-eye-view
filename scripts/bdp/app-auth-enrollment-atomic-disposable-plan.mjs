import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/**
 * C14B2A: one safe PLAN ONLY check of the exact synthetic SQL proposal.
 * No Docker, PostgreSQL connection, environment variable, secret, or write.
 * This is NOT authorization to provision an account/role or execute SQL.
 */
export const C14B2A_SQL_BLOB='ce88fe8f4aeda3077fe3a03d19a0b4085a3e0004';
export const C14B2A_PLAN_PASS=
  'PLAN: C14B2A guarded serializable enrollment/activation SQL reviewed for isolated synthetic PostgreSQL only; no database connection or writes.';

export function requireC14B2APlanOnly(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--plan-only')
    throw new Error('C14B2A supports only --plan-only');
  return true;
}
export function c14b2aGitBlob(source){
  if(typeof source!=='string')return null;
  return createHash('sha1')
    .update('blob '+Buffer.byteLength(source,'utf8')+'\0')
    .update(source,'utf8').digest('hex');
}
export function verifyC14B2ASource(source){
  if(typeof source!=='string' || c14b2aGitBlob(source)!==C14B2A_SQL_BLOB)
    throw new Error('C14B2A exact synthetic SQL review hash mismatch');
  if(!source.includes("current_database() <> 'ldos_c14b_disposable'")
    ||!source.includes("current_user <> 'postgres'")
    ||!source.includes("current_setting('transaction_isolation')<>'serializable'")
    ||!source.includes('SECURITY INVOKER')
    ||!source.includes('REVOKE ALL ON FUNCTION ldos_app_auth.disposable_enrollment_transition(')
    ||!source.trimEnd().endsWith('COMMIT;'))
    throw new Error('C14B2A security invariant changed; STOP');
  return true;
}
export function runC14B2APlanOnly(args=process.argv.slice(2)){
  requireC14B2APlanOnly(args);
  const source=readFileSync(new URL(
    '../../server/standalone/sql/landOsEnrollmentAtomicDisposable.sql',
    import.meta.url),'utf8');
  verifyC14B2ASource(source);
  process.stdout.write(C14B2A_PLAN_PASS+'\n');
  return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{runC14B2APlanOnly();}
  catch{process.stderr.write('C14B2A review plan rejected; no database access or writes.\n');
    process.exitCode=1;}
}
