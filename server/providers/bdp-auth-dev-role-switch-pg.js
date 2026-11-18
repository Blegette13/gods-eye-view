import {PRIMARY_ACCOUNT_SQL} from './bdp-primary-account-reader.js';

/**
 * Step 40C-62D-C6 — UNROUTED, SOURCE-ONLY trusted local auth SQL gateway.
 * The canonical ldos_auth_account_reader remains NOLOGIN. A separate future,
 * reviewed SQL LOGIN must have only SET TRUE/INHERIT FALSE membership.
 * Factory construction does not connect. There is NO persistent role
 * provisioning, HTTP handler, Supabase identity, or GIS release here.
 */
export const AUTH_DEV_GATEWAY_LOGIN='ldos_auth_gateway_login';
export const AUTH_DEV_READER_ROLE='ldos_auth_account_reader';
export const AUTH_DEV_CONNECT_TIMEOUT_MS=2000;
export const AUTH_DEV_MAX_POOL=2;
const KEYS=['database','host','password','port','user'];

// One attestation, pinned to the same PG client and read-only transaction as
// the actual parameterized account lookup. Test all effective column rights:
// has_table_privilege(SELECT) can be true from ANY column-level SELECT grant.
export const AUTH_DEV_ROLE_SWITCH_ATTEST_SQL=`
SELECT
  current_database() = 'ldos_auth_dev' AS correct_db,
  NOT pg_catalog.pg_is_in_recovery() AS primary_db,
  session_user = 'ldos_auth_gateway_login' AS correct_login,
  current_user = 'ldos_auth_account_reader' AS effective_reader,
  current_setting('transaction_read_only') = 'on' AS read_only_tx,
  COALESCE((SELECT r.rolcanlogin AND NOT(r.rolsuper OR r.rolcreatedb
    OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
    FROM pg_catalog.pg_roles r WHERE r.rolname = session_user),FALSE) AS safe_login,
  COALESCE((SELECT NOT(r.rolcanlogin OR r.rolsuper OR r.rolcreatedb
    OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
    FROM pg_catalog.pg_roles r WHERE r.rolname = current_user),FALSE) AS safe_reader,
  (SELECT count(*) = 1 AND bool_and(r.rolname = 'ldos_auth_account_reader'
    AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option)
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
    JOIN pg_catalog.pg_roles g ON g.oid = m.member
    WHERE g.rolname = session_user) AS exact_membership,
  pg_catalog.has_schema_privilege(current_user,'ldos_app_auth','USAGE') AS schema_usage,
  NOT pg_catalog.has_schema_privilege(current_user,'ldos_app_auth','CREATE') AS no_schema_create,
  pg_catalog.has_column_privilege(current_user,'ldos_app_auth.accounts','subject','SELECT') AS subject_read,
  pg_catalog.has_column_privilege(current_user,'ldos_app_auth.accounts','account_state','SELECT') AS state_read,
  pg_catalog.has_column_privilege(current_user,'ldos_app_auth.accounts','revision','SELECT') AS revision_read,
  NOT pg_catalog.has_column_privilege(current_user,'ldos_app_auth.accounts','created_at','SELECT') AS no_created_at,
  NOT pg_catalog.has_table_privilege(current_user,'ldos_app_auth.accounts',
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_account_writes,
  NOT pg_catalog.has_table_privilege(current_user,'ldos_app_auth.sessions',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_session_rights,
  NOT pg_catalog.has_table_privilege(current_user,'ldos_app_auth.county_grants',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_county_rights,
  NOT pg_catalog.has_function_privilege(current_user,
    'ldos_app_auth.guard_revision()','EXECUTE') AS no_guard_execution,
  pg_catalog.to_regprocedure('ldos_app_auth.current_county_candidate_rpc(text,text)')
    IS NULL AS no_candidate_rpc
`;
const PROOF=Object.freeze([
  'correct_db','primary_db','correct_login','effective_reader',
  'read_only_tx','safe_login','safe_reader','exact_membership',
  'schema_usage','no_schema_create','subject_read','state_read',
  'revision_read','no_created_at','no_account_writes','no_session_rights',
  'no_county_rights','no_guard_execution','no_candidate_rpc',
]);
export function validAuthDevSettings(x){
  if(!x||typeof x!=='object'||Array.isArray(x)
    || (Object.getPrototypeOf(x)!==Object.prototype && Object.getPrototypeOf(x)!==null)
    || Object.keys(x).sort().join('|')!==KEYS.join('|'))return false;
  return x.host==='127.0.0.1'&&x.port===54338
    &&x.database==='ldos_auth_dev'&&x.user===AUTH_DEV_GATEWAY_LOGIN
    &&typeof x.password==='string'&&x.password.length>=32
    &&x.password.length<=256&&!/[\r\n\0]/.test(x.password);
}
export function validAuthDevRoleSwitchProof(result){
  return !!result&&result.command==='SELECT'&&result.rowCount===1
    &&Array.isArray(result.rows)&&result.rows.length===1
    &&result.rows[0]&&typeof result.rows[0]==='object'
    &&!Array.isArray(result.rows[0])
    &&Object.keys(result.rows[0]).length===PROOF.length
    &&PROOF.every(k=>result.rows[0][k]===true);
}

/** Produces the only query adapter accepted by the fixed account reader. */
export function createUnroutedAuthDevRoleSwitchPg({Pool,settings}={}){
  if(typeof Pool!=='function'||!validAuthDevSettings(settings))
    throw new TypeError('Fixed local-only auth gateway settings and trusted pg.Pool required');
  const pool=new Pool({
    host:'127.0.0.1',port:54338,database:'ldos_auth_dev',
    user:AUTH_DEV_GATEWAY_LOGIN,password:settings.password,ssl:false,
    max:AUTH_DEV_MAX_POOL,min:0,connectionTimeoutMillis:AUTH_DEV_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis:3000,statement_timeout:2000,
    idle_in_transaction_session_timeout:4000,
    allowExitOnIdle:true,application_name:'ldos-auth-gateway-staged',
  });
  if(!pool||typeof pool.connect!=='function'||typeof pool.end!=='function'
    ||typeof pool.on!=='function')throw new TypeError('Invalid trusted pg.Pool implementation');
  pool.on('error',()=>{/* no DB details in logs */});
  let closed=false;
  return Object.freeze({
    async query(input={}){
      if(!input||typeof input!=='object'||Array.isArray(input)
        ||Reflect.ownKeys(input).length!==4
        ||!['text','values','rowMode','signal'].every(k=>Object.hasOwn(input,k)))
        throw new Error('Auth-dev primary account read denied');
      const {text,values,rowMode,signal}=input;
      if(closed||text!==PRIMARY_ACCOUNT_SQL||rowMode!=='array'
        ||!Array.isArray(values)||values.length!==1
        ||typeof values[0]!=='string'
        ||!(signal instanceof AbortSignal)||signal.aborted)
        throw new Error('Auth-dev primary account read denied');
      let client,started=false,rolledBack=false;
      try{
        client=await pool.connect();
        if(closed||signal.aborted||!client||typeof client.query!=='function'
          ||typeof client.release!=='function')throw Error('Rejected client');
        await client.query('BEGIN READ ONLY');
        started=true;
        await client.query('SET LOCAL ROLE ldos_auth_account_reader');
        const proof=await client.query(AUTH_DEV_ROLE_SWITCH_ATTEST_SQL);
        if(closed||signal.aborted||!validAuthDevRoleSwitchProof(proof))
          throw Error('Role proof rejected');
        const result=await client.query({text,values,rowMode});
        if(closed||signal.aborted)throw Error('Cancelled');
        await client.query('ROLLBACK');
        rolledBack=true;
        return result;
      }catch{
        throw new Error('Auth-dev primary account read denied');
      }finally{
        if(client){
          if(started&&!rolledBack){
            try{await client.query('ROLLBACK');rolledBack=true;}
            catch{/* evict this session: role state may be unsafe */}
          }
          try{client.release(rolledBack?undefined:new Error('Evict unsafe SQL session'));}
          catch{/* fail closed */}
        }
      }
    },
    async close(){
      if(closed)return;
      closed=true;
      await pool.end();
    },
  });
}
