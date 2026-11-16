import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

/**
 * Step 40C-59: ONLY synthetic disposable PostgreSQL candidate-RPC proof.
 * It NEVER connects to Supabase/Auth, existing PostGIS, app DB or public
 * HTTP services. No host port, network, mounts, persisted volumes or GIS.
 * The function yields candidate REVISION EVIDENCE only, never approval.
 */
export const APP_AUTH_CANDIDATE_SMOKE_PASS =
  'PASS: disposable app-owned current-candidate RPC: restricted SQL LOGINs, no raw tables, deny defaults, independent epochs and revoked/expired denial; no geometry authorized.';
const IMAGE='postgis/postgis:17-3.5';
const READY='PostgreSQL init process complete; ready for start up.';
const ID='11111111-1111-4111-8111-111111111111';
const DIGEST='a'.repeat(64);
const COUNTY='48453';
const ROLE=Object.freeze({
  reader:'ldos_auth_candidate_reader_fixture',
  blocked:'ldos_auth_candidate_blocked_fixture',
});
const RPC='ldos_app_auth.current_county_candidate_rpc(text,text)';

export function requireCandidateRpcDisposableOptIn(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw Error('Refusing app candidate RPC SQL smoke without exactly --disposable-only');
  return true;
}
function docker(args,timeout=30000){
  const p=spawnSync('docker',args,{encoding:'utf8',timeout,maxBuffer:1024*1024});
  if(p.error||p.status!==0)throw Error('Disposable Docker unavailable');
  return String(p.stdout||'').trim();
}
async function waitUntilReady(container){
  for(let i=0;i<60;i++){
    const info=spawnSync('docker',[
      'inspect','--format','{{.State.Status}}',container,
    ],{encoding:'utf8',timeout:10000,maxBuffer:128000});
    if(info.status!==0||info.stdout.trim()!=='running')
      throw Error('Disposable container stopped');
    const logs=spawnSync('docker',['logs',container],{
      encoding:'utf8',timeout:10000,maxBuffer:1048576,
    });
    if(logs.status===0&&String(logs.stdout+logs.stderr).includes(READY)){
      const pg=spawnSync('docker',[
        'exec',container,'pg_isready','-U','postgres','-d','postgres',
      ],{encoding:'utf8',timeout:10000});
      if(pg.status===0)return;
    }
    await sleep(1000);
  }
  throw Error('Disposable Postgres startup unavailable');
}
function psql(container,query,role,passwords){
  return spawnSync('docker',[
    'exec','-i',...(role?['-e','PGPASSWORD='+passwords[role]]:[]),
    container,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1',
    ...(role?['-h','127.0.0.1','-U',ROLE[role]]:['-U','postgres']),
    '-d','postgres',
  ],{input:query,encoding:'utf8',timeout:120000,maxBuffer:1048576});
}
export async function runAppAuthCandidateRpcDisposableSmoke(
  args=process.argv.slice(2)
){
  requireCandidateRpcDisposableOptIn(args);
  const container='ldos-auth-candidate-'+randomBytes(6).toString('hex');
  const rootPassword=randomBytes(32).toString('hex');
  const passwords={
    reader:randomBytes(32).toString('hex'),
    blocked:randomBytes(32).toString('hex'),
  };
  let attempted=false;
  let stage='Docker/image preflight';
  try{
    docker(['info','--format','{{.ServerVersion}}']);
    docker(['image','inspect',IMAGE]);
    attempted=true;
    docker(['run','-d','--name',container,'--network','none','--pull=never',
      '-e','POSTGRES_PASSWORD='+rootPassword,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',
      IMAGE],240000);
    await waitUntilReady(container);
    const sql=(statement,role)=>{
      const p=psql(container,statement,role,passwords);
      if(p.error||p.status!==0)
        throw Error('Isolated SQL check unexpectedly failed');
      return String(p.stdout||'').trim();
    };
    const denied=(statement,role,re)=>{
      const p=psql(container,statement,role,passwords);
      assert.equal(p.error,undefined,'SQL denial must execute on Postgres');
      assert.notEqual(p.status,0,'Denied SQL unexpectedly succeeded');
      assert.match(String(p.stderr||''),re,'SQL denial failure category mismatch');
    };
    const file=name=>readFileSync(new URL(
      '../../server/standalone/sql/'+name,import.meta.url,
    ),'utf8');
    stage='install unmodified app ledger and candidate RPC into fresh database';
    sql(file('landOsAccountAuthorityFoundation.sql'));
    sql(file('landOsCurrentCountyCandidateRpc.sql'));
    assert.equal(sql("SELECT count(*) FROM pg_namespace WHERE nspname='ldos_app_auth';"),'1');
    assert.equal(sql("SELECT count(*) FROM ldos_app_auth.sessions;"),'0');

    stage='two restricted password LOGINs and exact function permissions';
    for(const role of Object.keys(ROLE)){
      sql('CREATE ROLE '+ROLE[role]+
        ' LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE '+
        'NOREPLICATION NOBYPASSRLS PASSWORD '+
        "'"+passwords[role]+"';");
      sql('GRANT USAGE ON SCHEMA ldos_app_auth TO '+ROLE[role]+';');
      assert.equal(sql("SELECT rolsuper::text||'|'||rolcreatedb::text||'|'"+
        "||rolcreaterole::text||'|'||rolbypassrls::text FROM pg_roles "+
        "WHERE rolname='"+ROLE[role]+"';"),'false|false|false|false');
      assert.equal(sql("SELECT has_table_privilege('"+ROLE[role]+
        "','ldos_app_auth.sessions','SELECT');"),'f');
      assert.equal(sql("SELECT has_schema_privilege('"+ROLE[role]+
        "','ldos_app_auth','CREATE');"),'f');
    }
    assert.equal(sql("SELECT has_function_privilege('"+ROLE.reader+
      "','"+RPC+"','EXECUTE');"),'f');
    assert.equal(sql("SELECT has_function_privilege('"+ROLE.blocked+
      "','"+RPC+"','EXECUTE');"),'f');
    sql('GRANT EXECUTE ON FUNCTION '+RPC+' TO '+ROLE.reader+';');
    assert.equal(sql("SELECT has_function_privilege('"+ROLE.reader+
      "','"+RPC+"','EXECUTE');"),'t');
    assert.equal(sql("SELECT has_function_privilege('"+ROLE.blocked+
      "','"+RPC+"','EXECUTE');"),'f');
    assert.equal(sql("SELECT has_function_privilege('public','"+
      RPC+"','EXECUTE');"),'f');

    const candidate=(digest=DIGEST,county=COUNTY)=>
      'SELECT account_epoch||\'|\'||session_epoch||\'|\'||county_grant_epoch '+
      'FROM ldos_app_auth.current_county_candidate_rpc('+
      "'"+digest+"','"+county+"');";
    stage='raw table access and RPC privilege boundaries';
    denied('SELECT * FROM ldos_app_auth.accounts;','reader',/permission denied/i);
    denied('SELECT * FROM ldos_app_auth.sessions;','reader',/permission denied/i);
    denied('SELECT * FROM ldos_app_auth.county_grants;','reader',/permission denied/i);
    denied('SELECT * FROM ldos_app_auth.sessions;','blocked',/permission denied/i);
    denied(candidate(),'blocked',/permission denied/i);
    denied('CREATE TABLE ldos_app_auth.escape(x integer);','reader',
      /permission denied/i);
    denied('ALTER FUNCTION '+RPC+' RENAME TO attacker_rpc;','reader',
      /must be owner|permission denied/i);

    stage='deny-first fixture and one valid revision-only candidate';
    sql("INSERT INTO ldos_app_auth.accounts(subject) VALUES ('"+ID+"');");
    sql("INSERT INTO ldos_app_auth.sessions "+
      "(session_digest,subject,issued_at,expires_at) VALUES ('"+DIGEST+
      "','"+ID+"',clock_timestamp()-interval '1 minute',"+
      "clock_timestamp()+interval '2 hours');");
    sql("INSERT INTO ldos_app_auth.county_grants(subject,county_fips) VALUES ('"+
      ID+"','"+COUNTY+"');");
    assert.equal(sql(candidate(),'reader'),'','deny-by-default returns no record');
    sql("UPDATE ldos_app_auth.accounts SET account_state='active' "+
      "WHERE subject='"+ID+"';");
    assert.equal(sql(candidate(),'reader'),'','revoked session remains denied');
    sql("UPDATE ldos_app_auth.sessions SET session_state='active',"+
      "mfa_state='verified' WHERE session_digest='"+DIGEST+"';");
    assert.equal(sql(candidate(),'reader'),'','county grant still denies');
    sql("UPDATE ldos_app_auth.county_grants SET grant_state='allowed' "+
      "WHERE subject='"+ID+"' AND county_fips='"+COUNTY+"';");
    assert.equal(sql(candidate(),'reader'),'2|2|2');

    stage='wrong source identity, county and malformed input denied';
    for(const [digest,county] of [
      ['b'.repeat(64),COUNTY],
      [DIGEST,'48029'],
      [DIGEST,'06037'],
      [DIGEST,''],
      ['A'.repeat(64),COUNTY],
      ['a'.repeat(63),COUNTY],
    ])assert.equal(sql(candidate(digest,county),'reader'),'');
    assert.equal(sql("SELECT count(*) FROM ldos_app_auth.current_county_candidate_rpc('"+
      DIGEST+"','"+COUNTY+"');",'reader'),'1');

    stage='revocation and ABA changes do not resurrect old revisions';
    sql("UPDATE ldos_app_auth.county_grants SET grant_state='denied' "+
      "WHERE subject='"+ID+"';");
    assert.equal(sql(candidate(),'reader'),'');
    sql("UPDATE ldos_app_auth.county_grants SET grant_state='allowed' "+
      "WHERE subject='"+ID+"';");
    assert.equal(sql(candidate(),'reader'),'2|2|4');

    sql("UPDATE ldos_app_auth.accounts SET account_state='suspended' "+
      "WHERE subject='"+ID+"';");
    assert.equal(sql(candidate(),'reader'),'');
    sql("UPDATE ldos_app_auth.accounts SET account_state='active' "+
      "WHERE subject='"+ID+"';");
    assert.equal(sql(candidate(),'reader'),'4|2|4');

    sql("UPDATE ldos_app_auth.sessions SET mfa_state='unverified' "+
      "WHERE session_digest='"+DIGEST+"';");
    assert.equal(sql(candidate(),'reader'),'');
    sql("UPDATE ldos_app_auth.sessions SET mfa_state='verified' "+
      "WHERE session_digest='"+DIGEST+"';");
    assert.equal(sql(candidate(),'reader'),'4|4|4');

    sql("UPDATE ldos_app_auth.sessions SET session_state='revoked' "+
      "WHERE session_digest='"+DIGEST+"';");
    assert.equal(sql(candidate(),'reader'),'');
    sql("UPDATE ldos_app_auth.sessions SET session_state='active' "+
      "WHERE session_digest='"+DIGEST+"';");
    assert.equal(sql(candidate(),'reader'),'4|6|4');

    stage='expiry and future-issued session fail closed';
    sql("UPDATE ldos_app_auth.sessions SET expires_at=clock_timestamp()-interval '1 second' "+
      "WHERE session_digest='"+DIGEST+"';");
    assert.equal(sql(candidate(),'reader'),'','expired session must deny');
    sql("UPDATE ldos_app_auth.sessions SET expires_at=clock_timestamp()+interval '2 hours' "+
      "WHERE session_digest='"+DIGEST+"';");
    assert.equal(sql(candidate(),'reader'),'4|8|4');
    // Do NOT modify issue_at: the ledger forbids rebinding an issued session.
    // Check that a separate fresh future-issued synthetic row cannot be used.
    const future='b'.repeat(64);
    sql("INSERT INTO ldos_app_auth.sessions "+
      "(session_digest,subject,session_state,mfa_state,issued_at,expires_at) "+
      "VALUES ('"+future+"','"+ID+"','active','verified',"+
      "clock_timestamp()+interval '10 minutes',"+
      "clock_timestamp()+interval '1 hour');");
    assert.equal(sql(candidate(future,COUNTY),'reader'),'');
    assert.equal(sql("SELECT count(*) FROM ldos_app_auth.accounts;"),'1');
    assert.equal(sql("SELECT count(*) FROM ldos_app_auth.county_grants;"),'1');
    assert.equal(sql("SELECT count(*) FROM ldos_app_auth.sessions;"),'2');
    process.stdout.write(APP_AUTH_CANDIDATE_SMOKE_PASS+'\n');
  }catch{
    // Never print SQL statements, passwords, user IDs, provider tokens or
    // server responses. Stage names contain no identifiable user data.
    throw Error('Disposable app-candidate RPC proof failed at '+stage+
      '; no live database changed');
  }finally{
    if(attempted){
      try{docker(['rm','--force','--volumes',container],30000);}
      catch{process.stderr.write('WARNING: isolated candidate container cleanup unconfirmed\n');}
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runAppAuthCandidateRpcDisposableSmoke().catch(err=>{
    process.stderr.write(err.message+'\n');
    process.exitCode=1;
  });
}
