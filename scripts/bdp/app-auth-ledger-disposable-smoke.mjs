import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

/**
 * Step 40C-58. REAL SQL proof of the UNDEPLOYED Step 40C-57 draft.
 * Creates a FRESH, isolated PostGIS Docker container using synthetic data
 * and TWO separate password-authenticated logins, NEVER any Supabase DB.
 * No host ports, mounts, network, persistent volume, user token or GIS data.
 * This is NOT app authorization, Supabase login, MFA, a release gate or an
 * approved production migration. It MUST NOT be run without --disposable-only.
 */
export const APP_AUTH_LEDGER_SMOKE_PASS =
  'PASS: disposable app-owned PostgreSQL ledger: deny-default rows, independent LOGINs, monotonic ABA revisions, immutable bindings, rollback, concurrent updates and delete/truncate denial.';
const IMAGE='postgis/postgis:17-3.5';
const READY='PostgreSQL init process complete; ready for start up.';
const LOGIN=Object.freeze({
  writer:'ldos_auth_ledger_writer_fixture',
  reader:'ldos_auth_ledger_reader_fixture',
});
const SUBJECT='11111111-1111-4111-8111-111111111111';
const DIGEST='a'.repeat(64);
const COUNTY='48453';

export function requireAppAuthLedgerDisposableOptIn(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw Error('Refusing app authorization ledger SQL smoke without exactly --disposable-only');
  return true;
}
function docker(args,timeout=30000){
  const p=spawnSync('docker',args,{
    encoding:'utf8',timeout,maxBuffer:1024*1024,
  });
  if(p.status!==0||p.error)
    throw Error('Disposable Docker '+args[0]+' unavailable or failed');
  return String(p.stdout||'').trim();
}
async function waitUntilReady(container){
  for(let attempt=0;attempt<60;attempt++){
    const inspect=spawnSync('docker',[
      'inspect','--format','{{.State.Status}}',container,
    ],{encoding:'utf8',timeout:10000,maxBuffer:100000});
    if(inspect.status!==0||inspect.stdout.trim()!=='running')
      throw Error('Disposable database container not running');
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
  throw Error('Disposable database startup did not complete');
}
function runPsqlArgs(container,as,passwords){
  return [
    'exec','-i',...(as?['-e','PGPASSWORD='+passwords[as]]:[]),
    container,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1',
    ...(as?['-h','127.0.0.1','-U',LOGIN[as]]:['-U','postgres']),
    '-d','postgres',
  ];
}
function runSqlSync(container,statement,as,passwords){
  return spawnSync('docker',runPsqlArgs(container,as,passwords),{
    input:statement,encoding:'utf8',timeout:120000,maxBuffer:1024*1024,
  });
}
async function runSqlAsync(container,statement,as,passwords){
  return new Promise((done,reject)=>{
    const child=spawn('docker',runPsqlArgs(container,as,passwords),{
      stdio:['pipe','pipe','pipe'],windowsHide:true,
    });
    let stdout='',stderr='',settled=false;
    const finish=(err,result)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      if(err)reject(err);else done(result);
    };
    const timer=setTimeout(()=>{
      child.kill();
      finish(Error('Disposable concurrent SQL request timed out'));
    },120000);
    child.on('error',()=>finish(Error('Disposable concurrent Docker SQL unavailable')));
    child.stdout.on('data',chunk=>{
      stdout+=chunk.toString('utf8');
      if(stdout.length>1048576){
        child.kill();
        finish(Error('Disposable concurrent SQL output too large'));
      }
    });
    child.stderr.on('data',chunk=>{
      stderr+=chunk.toString('utf8');
      if(stderr.length>1048576){
        child.kill();
        finish(Error('Disposable concurrent SQL error too large'));
      }
    });
    child.stdin.on('error',()=>{/* handled by process exit; no raw SQL dump */});
    child.on('close',status=>{
      if(status!==0)return finish(Error('Disposable concurrent SQL failed'));
      finish(null,stdout.trim());
    });
    child.stdin.end(statement);
  });
}
export async function runAppAuthLedgerDisposableSmoke(args=process.argv.slice(2)){
  requireAppAuthLedgerDisposableOptIn(args);
  const container='ldos-auth-ledger-'+randomBytes(6).toString('hex');
  const password=randomBytes(32).toString('hex');
  const passwords=Object.freeze({
    writer:randomBytes(32).toString('hex'),
    reader:randomBytes(32).toString('hex'),
  });
  let attempted=false;
  let stage='Docker and image preflight';
  try {
    docker(['info','--format','{{.ServerVersion}}']);
    docker(['image','inspect',IMAGE]);
    attempted=true;
    docker([
      'run','-d','--name',container,'--network','none','--pull=never',
      '-e','POSTGRES_PASSWORD='+password,
      '-e','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',IMAGE,
    ],240000);
    await waitUntilReady(container);
    stage='draft schema installation';

    const sql=(statement,as)=>{
      const p=runSqlSync(container,statement,as,passwords);
      if(p.status!==0||p.error)throw Error('Disposable SQL unexpectedly failed: '+
        (as||'setup')); // Never echo SQL or secrets.
      return String(p.stdout||'').trim();
    };
    const denied=(statement,as,errorPattern)=>{
      const p=runSqlSync(container,statement,as,passwords);
      assert.equal(p.error,undefined,'SQL denial must run against the real database');
      assert.notEqual(p.status,0,'Prohibited SQL succeeded: '+(as||'setup'));
      assert.match(String(p.stderr||''),errorPattern,
        'Unexpected SQL failure category on '+(as||'setup'));
    };
    const read=()=>readFileSync(new URL(
      '../../server/standalone/sql/landOsAccountAuthorityFoundation.sql',
      import.meta.url,
    ),'utf8');

    // Fresh, independent container. Never use a PostgreSQL URL or live store.
    sql('SELECT version();');
    sql(read());
    stage='role setup and restricted ACL checks';
    assert.equal(sql("SELECT count(*) FROM pg_namespace WHERE nspname='ldos_app_auth';"),'1');
    assert.equal(sql("SELECT count(*) FROM ldos_app_auth.accounts;"),'0');

    for(const [kind,role] of Object.entries(LOGIN)){
      sql('CREATE ROLE '+role+' LOGIN NOINHERIT NOSUPERUSER NOCREATEDB '+
        'NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '+
        "'"+passwords[kind]+"';");
    }
    sql('GRANT USAGE ON SCHEMA ldos_app_auth TO '+LOGIN.writer+';');
    sql('GRANT USAGE ON SCHEMA ldos_app_auth TO '+LOGIN.reader+';');
    // Extra permissions exist ONLY on these randomized synthetic fixtures to
    // prove database trigger rejection rather than trivial missing SQL GRANT.
    sql('GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN '+
      'SCHEMA ldos_app_auth TO '+LOGIN.writer+';');
    for(const kind of Object.keys(LOGIN)){
      const role=LOGIN[kind];
      assert.equal(sql("SELECT rolsuper::text||'|'||rolcreatedb::text||'|'"+
        "||rolcreaterole::text||'|'||rolreplication::text||'|'"+
        "||rolbypassrls::text FROM pg_roles WHERE rolname='"+role+"';"),
        'false|false|false|false|false');
      assert.equal(sql("SELECT has_function_privilege('"+role+
        "','ldos_app_auth.guard_revision()','EXECUTE');"),'f');
    }
    assert.equal(sql("SELECT has_table_privilege('"+LOGIN.reader+
      "','ldos_app_auth.accounts','SELECT');"),'f');
    assert.equal(sql("SELECT has_schema_privilege('"+LOGIN.writer+
      "','ldos_app_auth','CREATE');"),'f');

    denied('SELECT * FROM ldos_app_auth.accounts;','reader',/permission denied/i);
    denied('INSERT INTO ldos_app_auth.accounts(subject) VALUES ('+
      "'"+SUBJECT+"');",'reader',/permission denied/i);
    denied('CREATE TABLE ldos_app_auth.spoofed(x text);','writer',/permission denied/i);
    denied('ALTER TABLE ldos_app_auth.accounts DISABLE TRIGGER ALL;',
      'writer',/must be owner|permission denied/i);

    stage='deny-by-default synthetic records';
    assert.equal(sql("INSERT INTO ldos_app_auth.accounts(subject) VALUES ('"+
      SUBJECT+"') RETURNING account_state||'|'||revision;",'writer'),'suspended|1');
    assert.equal(sql("INSERT INTO ldos_app_auth.sessions "+
      '(session_digest,subject,issued_at,expires_at) VALUES ('+
      "'"+DIGEST+"','"+SUBJECT+"',"+
      "clock_timestamp()-interval '5 minutes',clock_timestamp()+interval '2 hours') "+
      "RETURNING session_state||'|'||mfa_state||'|'||revision;",'writer'),
      'revoked|unverified|1');
    assert.equal(sql("INSERT INTO ldos_app_auth.county_grants(subject,county_fips) VALUES ('"+
      SUBJECT+"','"+COUNTY+"') RETURNING grant_state||'|'||revision;",'writer'),
      'denied|1');

    stage='account session and county ABA revisions';
    // Every permitted UPDATE advances revision, even an unchanged value.
    const updateAccount=(value)=>sql('UPDATE ldos_app_auth.accounts SET account_state='+
      "'"+value+"' WHERE subject='"+SUBJECT+
      "' RETURNING account_state||'|'||revision;",'writer');
    assert.equal(updateAccount('active'),'active|2');
    assert.equal(updateAccount('suspended'),'suspended|3');
    assert.equal(updateAccount('active'),'active|4');
    const updateSession=(state,mfa)=>sql('UPDATE ldos_app_auth.sessions SET '+
      "session_state='"+state+"',mfa_state='"+mfa+"' WHERE session_digest='"+
      DIGEST+"' RETURNING session_state||'|'||mfa_state||'|'||revision;",'writer');
    assert.equal(updateSession('active','verified'),'active|verified|2');
    assert.equal(updateSession('revoked','unverified'),'revoked|unverified|3');
    assert.equal(updateSession('active','verified'),'active|verified|4');

    const updateGrant=(state)=>sql('UPDATE ldos_app_auth.county_grants '+
      "SET grant_state='"+state+"' WHERE subject='"+SUBJECT+
      "' AND county_fips='"+COUNTY+"' RETURNING grant_state||'|'||revision;",
      'writer');
    assert.equal(updateGrant('allowed'),'allowed|2');
    assert.equal(updateGrant('denied'),'denied|3');
    assert.equal(updateGrant('allowed'),'allowed|4');

    stage='immutable binding constraints and deletion denial';
    denied("UPDATE ldos_app_auth.county_grants SET revision=1 WHERE subject='"+
      SUBJECT+"';",'writer',/authority revision is database-managed/i);
    denied("UPDATE ldos_app_auth.accounts SET subject='"+
      '22222222-2222-4222-8222-222222222222'+"' WHERE subject='"+
      SUBJECT+"';",'writer',/account identity is immutable/i);
    denied("UPDATE ldos_app_auth.sessions SET session_digest='"+
      'b'.repeat(64)+"' WHERE session_digest='"+DIGEST+
      "';",'writer',/session binding is immutable/i);
    denied("UPDATE ldos_app_auth.sessions SET issued_at=issued_at+interval '1 minute' "+
      "WHERE session_digest='"+DIGEST+"';",'writer',/session binding is immutable/i);
    denied("UPDATE ldos_app_auth.county_grants SET county_fips='48029' WHERE subject='"+
      SUBJECT+"';",'writer',/county binding is immutable/i);
    denied("UPDATE ldos_app_auth.sessions SET expires_at=issued_at+interval '9 hours' "+
      "WHERE session_digest='"+DIGEST+"';",'writer',/violates check constraint/i);
    denied("INSERT INTO ldos_app_auth.county_grants(subject,county_fips) VALUES ('"+
      SUBJECT+"','06037');",'writer',/violates check constraint/i);
    denied("INSERT INTO ldos_app_auth.accounts(subject,revision) VALUES ('"+
      '22222222-2222-4222-8222-222222222222'+"',99);",
      'writer',/initial authority revision must be 1/i);
    denied("DELETE FROM ldos_app_auth.county_grants WHERE subject='"+
      SUBJECT+"';",'writer',/authority rows must be retained/i);
    for(const table of ['accounts','sessions','county_grants'])
      denied('TRUNCATE ldos_app_auth.'+table+' CASCADE;',
        'writer',/authority rows must be retained/i);

    stage='transaction rollback and concurrent revisions';
    const grantRev=()=>sql("SELECT revision FROM ldos_app_auth.county_grants "+
      "WHERE subject='"+SUBJECT+"' AND county_fips='"+COUNTY+"';",'writer');
    assert.equal(grantRev(),'4');
    sql("BEGIN; UPDATE ldos_app_auth.county_grants SET grant_state='denied' "+
      "WHERE subject='"+SUBJECT+"' AND county_fips='"+COUNTY+"'; ROLLBACK;",
      'writer');
    assert.equal(grantRev(),'4','A rolled-back update cannot advance a committed epoch');

    // Two separate actual password-authenticated backend connections issue
    // updates. Row locking must preserve two successive revisions.
    const update="UPDATE ldos_app_auth.county_grants SET grant_state='denied' "+
      "WHERE subject='"+SUBJECT+"' AND county_fips='"+COUNTY+
      "' RETURNING revision;";
    const first=runSqlAsync(container,
      'BEGIN; '+update+' SELECT pg_sleep(0.7); COMMIT;','writer',passwords);
    await sleep(150);
    const second=runSqlAsync(container,
      'BEGIN; '+update+' COMMIT;','writer',passwords);
    const results=await Promise.all([first,second]);
    assert.deepEqual(results.sort(),['5','6'],
      'Concurrent connections must receive sequential revisions');
    assert.equal(grantRev(),'6');
    assert.equal(sql("SELECT grant_state FROM ldos_app_auth.county_grants WHERE subject='"+
      SUBJECT+"';",'writer'),'denied');

    stage='final role and row isolation';
    // A granted synthetic writer is still NOT table owner, cannot bypass
    // authority guards or grant rights to unauthenticated readers.
    assert.equal(sql("SELECT has_table_privilege('"+LOGIN.reader+
      "','ldos_app_auth.sessions','SELECT');"),'f');
    assert.equal(sql('SELECT count(*) FROM ldos_app_auth.accounts;','writer'),'1');
    assert.equal(sql('SELECT count(*) FROM ldos_app_auth.sessions;','writer'),'1');
    assert.equal(sql('SELECT count(*) FROM ldos_app_auth.county_grants;','writer'),'1');
    process.stdout.write(APP_AUTH_LEDGER_SMOKE_PASS+'\n');
  }catch{
    // Deliberately never print Docker/psql command arguments, output,
    // synthetic credentials, account identifiers or schema data.
    throw Error('Disposable app-owned ledger SQL proof failed at '+stage+
      '; no live database changed');
  }finally{
    if(attempted){
      try{docker(['rm','--force','--volumes',container],30000);}
      catch{
        process.stderr.write('WARNING: disposable ledger container cleanup unconfirmed\n');
      }
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runAppAuthLedgerDisposableSmoke().catch(error=>{
    process.stderr.write(error.message+'\n');
    process.exitCode=1;
  });
}
