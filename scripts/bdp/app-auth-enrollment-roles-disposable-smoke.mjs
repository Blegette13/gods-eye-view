import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {C14B_DB,C14B_IMAGE,validC14BSource} from './app-auth-enrollment-schema-disposable-smoke.mjs';
import {verifyC14B2ASource,c14b2aGitBlob} from './app-auth-enrollment-atomic-disposable-plan.mjs';

/** C14B2C1: synthetic role and LOGIN negative-privilege proof. No real auth data. */
export const C14B2C1_ROLE_BLOB='ab9b9c61362832dca9522b80f70ccf2a13fd0965';
export const C14B2C1_PASS='PASS: C14B2C1 isolated PG17 synthetic executor and review-issuer LOGINs, two NOLOGIN roles, distinct SCRAM credentials, zero membership, denied direct auth table and prototype EXECUTE rights, denied SET ROLE; persistent auth-dev untouched.';
export const C14B2C1_NAMES=Object.freeze([
  'ldos_auth_enrollment_executor_login','ldos_auth_review_issuer_login',
  'ldos_auth_enrollment_writer','ldos_auth_review_issuer_writer',
]);
const TABLES=Object.freeze([
  'accounts','sessions','county_grants','enrollment_reviewer_authorities',
  'enrollment_invitations','enrollment_requests','enrollment_approvals',
  'enrollment_audit_events',
]);
const CALL='ldos_app_auth.disposable_enrollment_transition(text,uuid,text,uuid,uuid,uuid,bigint)';

export function requireC14B2C1Only(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw new Error('C14B2C1 requires exactly --disposable-only');
  return true;
}
export function exactRoleSql(source,executorSecret,issuerSecret){
  if(typeof source!=='string'||c14b2aGitBlob(source)!==C14B2C1_ROLE_BLOB
    ||typeof executorSecret!=='string'||!/^[0-9a-f]{64}$/.test(executorSecret)
    ||typeof issuerSecret!=='string'||!/^[0-9a-f]{64}$/.test(issuerSecret)
    ||executorSecret===issuerSecret)
    throw new Error('C14B2C1 reviewed SQL or synthetic secrets invalid');
  let sql=source;
  for(const [marker,secret] of [
    ['__C14B2C1_EXECUTOR_64HEX__',executorSecret],
    ['__C14B2C1_ISSUER_64HEX__',issuerSecret],
  ]){
    if(sql.split(marker).length!==2)
      throw new Error('C14B2C1 synthetic credential framing changed');
    sql=sql.replace(marker,secret);
  }
  if(sql.includes('__C14B2C1_'))throw new Error('Unreplaced synthetic secret marker');
  return sql;
}
function docker(args,{input,raw=false,timeout=30000}={}){
  const p=spawnSync('docker',args,{
    encoding:'utf8',input,timeout,windowsHide:true,maxBuffer:1024*1024,
  });
  if(p.error)throw new Error('C14B2C1 disposable Docker unavailable');
  if(raw)return p;
  if(p.status!==0)throw new Error('C14B2C1 disposable Docker operation failed');
  return String(p.stdout||'').trim();
}
async function ready(name){
  for(let i=0;i<60;i++){
    const r=spawnSync('docker',['logs',name],{
      encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:1024*1024,
    });
    if(r.status===0&&String(r.stdout+r.stderr).includes(
      'PostgreSQL init process complete; ready for start up.')){
      const p=spawnSync('docker',['exec',name,'pg_isready','-U','postgres',
        '-d',C14B_DB],{encoding:'utf8',timeout:10000,windowsHide:true});
      if(p.status===0)return;
    }
    await sleep(1000);
  }
  throw new Error('C14B2C1 disposable PG17 did not become ready');
}
export async function runC14B2C1RoleMatrix(args=process.argv.slice(2)){
  requireC14B2C1Only(args);
  const name='ldos-c14b2c1-role-'+randomBytes(6).toString('hex');
  const root=randomBytes(32).toString('hex');
  const executor=randomBytes(32).toString('hex');
  const issuer=randomBytes(32).toString('hex');
  const loginSecrets=[executor,issuer];
  let created=false,stage='local PG17 image preflight';
  const sql=statement=>docker(['exec','-i',name,'psql','-X','-q','-A','-t',
    '-v','ON_ERROR_STOP=1','-U','postgres','-d',C14B_DB],
    {input:statement,timeout:50000});
  const login=(role,secret,statement,raw=false)=>docker([
    'exec','-i','-e','PGPASSWORD='+secret,name,'psql','-X','-q','-A','-t',
    '-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U',role,'-d',C14B_DB,
  ],{input:statement,raw,timeout:30000});
  const denied=(role,secret,statement)=>{
    const p=login(role,secret,'\\set VERBOSITY verbose\n'+statement+'\n',true);
    assert.notEqual(p.status,0,'Unexpected SQL success');
    assert.match(String(p.stderr||''),/\b42501\b/);
  };
  try{
    docker(['info','--format','{{.ServerVersion}}']);
    docker(['image','inspect',C14B_IMAGE]);
    stage='fresh network-isolated PG17';
    docker(['run','-d','--rm','--network','none','--pull','never',
      '--name',name,'-e','POSTGRES_PASSWORD='+root,
      '-e','POSTGRES_DB='+C14B_DB,C14B_IMAGE],{timeout:120000});
    created=true;
    await ready(name);
    stage='load reviewed synthetic account ledger, review schema and atomic prototype';
    const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
    const ledger=read('../../server/standalone/sql/landOsAccountAuthorityFoundation.sql');
    const schema=read('../../server/standalone/sql/landOsEnrollmentReviewDisposable.sql');
    const atomic=read('../../server/standalone/sql/landOsEnrollmentAtomicDisposable.sql');
    const matrix=read('../../server/standalone/sql/landOsEnrollmentRolesDisposable.sql');
    if(!validC14BSource(schema)||!verifyC14B2ASource(atomic))
      throw new Error('Reviewed synthetic SQL changed');
    const roleSql=exactRoleSql(matrix,executor,issuer);
    sql(ledger);sql(schema);sql(atomic);
    stage='create four restricted synthetic principals without grants';
    sql(roleSql);

    stage='verify SQL role flags, disjoint identities and no membership';
    const names=C14B2C1_NAMES.map(r=>"'"+r+"'").join(',');
    const roleRows=sql("SELECT rolname||'|'||rolcanlogin||'|'||(NOT rolinherit)||'|'"+
      "||(NOT rolsuper)||'|'||(NOT rolcreatedb)||'|'||(NOT rolcreaterole)||'|'"+
      "||(NOT rolreplication)||'|'||(NOT rolbypassrls) FROM pg_catalog.pg_roles "+
      "WHERE rolname IN ("+names+") ORDER BY rolname;");
    const rows=roleRows.split('\n');
    assert.equal(rows.length,4);
    for(const row of rows){
      const [who,canLogin,...flags]=row.split('|');
      assert.ok(C14B2C1_NAMES.includes(who));
      assert.equal(canLogin, C14B2C1_NAMES.slice(0,2).includes(who)?'t':'f');
      assert.deepEqual(flags,Array(6).fill('t'));
    }
    assert.equal(sql("SELECT count(*) FROM pg_catalog.pg_auth_members m "+
      "JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member "+
      "WHERE r.rolname IN ("+names+");"),'0');
    assert.equal(sql("SELECT count(*) FROM pg_catalog.pg_roles "+
      "WHERE rolname IN ('ldos_auth_gateway_login','ldos_auth_account_reader');"),'0');
    assert.equal(sql("SELECT count(*) FROM pg_catalog.pg_authid "+
      "WHERE rolname IN ('ldos_auth_enrollment_executor_login',"+
      "'ldos_auth_review_issuer_login') "+
      "AND rolpassword LIKE 'SCRAM-SHA-256$%';"),'2');

    stage='deny schema, function and all direct table grants';
    const matrixRows=sql("SELECT rolname||'|'||"+
      "has_schema_privilege(rolname,'ldos_app_auth','USAGE')||'|'||"+
      "has_schema_privilege(rolname,'ldos_app_auth','CREATE')||'|'||"+
      "has_function_privilege(rolname,'"+CALL+"','EXECUTE') "+
      "FROM pg_catalog.pg_roles WHERE rolname IN ("+names+") ORDER BY rolname;");
    for(const line of matrixRows.split('\n'))assert.match(line,/\|f\|f\|f$/);
    for(const role of C14B2C1_NAMES){
      for(const table of TABLES){
        assert.equal(sql("SELECT has_table_privilege('"+role+"',"+
          "'ldos_app_auth."+table+"',"+
          "'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');"),'f');
      }
    }

    stage='verify actual password-authenticated login and denied operations';
    const logins=C14B2C1_NAMES.slice(0,2);
    for(let i=0;i<2;i++){
      const role=logins[i],secret=loginSecrets[i];
      assert.equal(login(role,secret,
        'SELECT current_database(),current_user,session_user,pg_is_in_recovery();'),
        C14B_DB+'|'+role+'|'+role+'|f');
      for(const operation of [
        'SELECT subject FROM ldos_app_auth.accounts;',
        'SELECT * FROM ldos_app_auth.enrollment_approvals;',
        'SELECT * FROM ldos_app_auth.enrollment_reviewer_authorities;',
        'SELECT * FROM ldos_app_auth.sessions;',
        'SELECT * FROM ldos_app_auth.county_grants;',
        "INSERT INTO ldos_app_auth.accounts(subject) VALUES ('11111111-1111-4111-8111-111111111111');",
        "UPDATE ldos_app_auth.enrollment_requests SET request_state='revoked';",
        'SELECT ldos_app_auth.disposable_enrollment_transition(NULL,NULL,NULL,NULL,NULL,NULL,NULL);',
        'SET ROLE postgres;',
        'SET ROLE ldos_auth_enrollment_writer;',
        'SET ROLE ldos_auth_review_issuer_writer;',
        'SET ROLE '+logins[1-i]+';',
      ])denied(role,secret,operation);
    }

    stage='check all six synthetic ledger tables remain empty';
    const selected=['accounts','sessions','county_grants','enrollment_requests',
      'enrollment_approvals','enrollment_audit_events'];
    assert.equal(sql('SELECT '+selected.map(t=>
      '(SELECT count(*) FROM ldos_app_auth.'+t+')').join(',')+';'),
      '0|0|0|0|0|0');
    process.stdout.write(C14B2C1_PASS+'\n');
    return true;
  }catch{
    throw new Error('C14B2C1 disposable role-isolation proof failed at '+
      stage+'; no persistent database targeted');
  }finally{
    if(created){
      try{docker(['rm','--force','--volumes',name],{timeout:30000});}
      catch{process.stderr.write(
        'WARNING: C14B2C1 disposable container cleanup unconfirmed\n');}
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runC14B2C1RoleMatrix().catch(e=>{
    process.stderr.write(e.message+'\n');process.exitCode=1;
  });
}
