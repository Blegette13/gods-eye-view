import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  createUnroutedAuthDevRoleSwitchPg,
  AUTH_DEV_GATEWAY_LOGIN,
} from '../../server/providers/bdp-auth-dev-role-switch-pg.js';
import {
  PRIMARY_ACCOUNT_SQL,createUnroutedPrimaryAccountReader,
} from '../../server/providers/bdp-primary-account-reader.js';

/**
 * Step 40C-62D-C12 — one-shot, server-only real node-postgres READ PROOF.
 * Only exact loopback auth-dev. Password arrives through redirected stdin
 * from the local Windows DPAPI wrapper, never from argv/env/source control.
 * No routes, real subjects, table writes, sessions, counties or GIS.
 */
export const C12_DRIVER_PASS=
  'PASS: C12 real restricted node-postgres gateway on local auth-dev; exact primary account read denied for absent synthetic UUID, role-switch privilege proof passed, raw table and role escalation denied; no database writes.';
export const C12_SYNTHETIC_SUBJECT='11111111-1111-4111-8111-111111111111';
const FIELDS=['subject','account_state','revision'];

export function requireC12DriverFlag(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--local-auth-dev-only')
    throw new Error('C12 requires exactly --local-auth-dev-only');
  return true;
}
export function validC12Secret(text){
  return typeof text==='string' && /^[0-9a-f]{64}$/.test(text);
}
export async function readSecretStdin(stream){
  if(!stream||typeof stream[Symbol.asyncIterator]!=='function')
    throw new Error('C12 protected stdin unavailable');
  const chunks=[];
  let length=0;
  try{
    for await(const part of stream){
      if(!Buffer.isBuffer(part))throw new Error('Invalid secret transport');
      length+=part.length;
      if(length>66)throw new Error('Secret transport too large');
      chunks.push(part);
    }
    const assembled=Buffer.concat(chunks);
    try {
      const text=assembled.toString('utf8');
      if(!/^[0-9a-f]{64}\r?\n?$/.test(text))
        throw new Error('Invalid protected secret format');
      return text.replace(/\r?\n$/,'');
    }finally{assembled.fill(0);}
  }finally{for(const chunk of chunks)chunk.fill(0);}
}
export function exactEmptyAccountQuery(result){
  return !!result&&result.command==='SELECT'
    &&result.rowCount===0
    &&Array.isArray(result.rows)&&result.rows.length===0
    &&Array.isArray(result.fields)&&result.fields.length===3
    &&result.fields.map(x=>x?.name).join('|')===FIELDS.join('|');
}
export function validC12LoginProof(result){
  const r=result?.rows?.[0];
  return result?.command==='SELECT'&&result?.rowCount===1
    &&result.rows.length===1&&r&&typeof r==='object'
    &&!Array.isArray(r)&&Object.keys(r).sort().join('|')===
      'db|login|primary|session'
    &&r.db==='ldos_auth_dev'&&r.login===AUTH_DEV_GATEWAY_LOGIN
    &&r.session===AUTH_DEV_GATEWAY_LOGIN&&r.primary===true;
}
const LOGIN_PROOF_SQL=
  "SELECT current_database() AS db, current_user AS login, "+
  "session_user AS session, NOT pg_is_in_recovery() AS primary";
export const C12_DENIED_SQL=Object.freeze([
  'SELECT subject FROM ldos_app_auth.accounts;',
  'SELECT * FROM ldos_app_auth.sessions;',
  'SELECT * FROM ldos_app_auth.county_grants;',
  'SET ROLE postgres;',
]);
export async function verifyC12LiveGateway({Pool,password}={}){
  if(typeof Pool!=='function'||!validC12Secret(password))
    throw new TypeError('C12 trusted pg.Pool and protected credential required');
  const settings=Object.freeze({
    host:'127.0.0.1',port:54338,database:'ldos_auth_dev',
    user:AUTH_DEV_GATEWAY_LOGIN,password,
  });
  let adapter=null,loginPool=null;
  try{
    adapter=createUnroutedAuthDevRoleSwitchPg({Pool,settings});
    const signal=new AbortController().signal;
    const query=Object.freeze({
      text:PRIMARY_ACCOUNT_SQL,values:[C12_SYNTHETIC_SUBJECT],
      rowMode:'array',signal,
    });
    // Unlike reader(null), this raw check distinguishes an absent account
    // from a swallowed SQL/authorization/driver error.
    const empty=await adapter.query(query);
    if(!exactEmptyAccountQuery(empty))
      throw new Error('Refusing nonempty or malformed account data');
    const reader=createUnroutedPrimaryAccountReader({query:adapter.query});
    if(await reader({subject:C12_SYNTHETIC_SUBJECT,signal})!==null)
      throw new Error('Unexpected authorized synthetic account');

    // A separate actual LOGIN session must have NO raw table read rights and
    // cannot escalate to postgres without the SET LOCAL ROLE guard.
    loginPool=new Pool({
      ...settings,ssl:false,max:1,min:0,
      connectionTimeoutMillis:2000,idleTimeoutMillis:3000,
      statement_timeout:2000,idle_in_transaction_session_timeout:4000,
      allowExitOnIdle:true,application_name:'ldos-c12-raw-denial-check',
    });
    if(!loginPool||typeof loginPool.query!=='function'
      ||typeof loginPool.end!=='function'||typeof loginPool.on!=='function')
      throw new Error('Invalid trusted pg.Pool');
    loginPool.on('error',()=>{/* no credential/SQL details in logs */});
    if(!validC12LoginProof(await loginPool.query(LOGIN_PROOF_SQL)))
      throw new Error('Unexpected SQL login or database');
    for(const sql of C12_DENIED_SQL){
      let denied=false;
      try{await loginPool.query(sql);}
      catch(e){denied=e?.code==='42501';}
      if(!denied)throw new Error('Raw SQL permission denial not proven');
    }
    return true;
  }catch{
    throw new Error('C12 restricted local PostgreSQL driver verification failed');
  }finally{
    if(loginPool)try{await loginPool.end();}catch{/* no SQL details */}
    if(adapter)try{await adapter.close();}catch{/* no SQL details */}
  }
}
export async function runC12LiveGateway(args=process.argv.slice(2),{
  input=process.stdin,loadPg=()=>import('pg'),
}={}){
  requireC12DriverFlag(args);
  const password=await readSecretStdin(input);
  if(!validC12Secret(password))throw new Error('Protected C12 credential rejected');
  let Pool;
  try{
    const mod=await loadPg();
    Pool=mod?.Pool??mod?.default?.Pool;
    if(typeof Pool!=='function')throw new Error('Invalid driver');
  }catch{throw new Error('C12 requires locally installed node-postgres (pg)');}
  if(!await verifyC12LiveGateway({Pool,password}))
    throw new Error('C12 restricted driver denied');
  process.stdout.write(C12_DRIVER_PASS+'\n');
  return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runC12LiveGateway().catch(e=>{
    const message=e.message==='C12 requires locally installed node-postgres (pg)'
      ?e.message:'C12 local restricted PostgreSQL driver verification failed; no database writes.';
    process.stderr.write(message+'\n');
    process.exitCode=1;
  });
}
