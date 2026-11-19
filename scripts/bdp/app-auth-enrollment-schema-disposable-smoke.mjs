import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

/** C14B1. Synthetic, disposable-only PostgreSQL. NOT an enrollment writer. */
export const C14B_DB='ldos_c14b_disposable';
export const C14B_IMAGE='postgres:17';
export const C14B_SQL_BLOB='5f10c530c7c5e801e7ad0d9733fcb48a2abcf5f8';
export const C14B_PASS='PASS: C14B1 isolated PG17 enrollment schema, deny-first defaults, identity/FK bindings, immutable revisions, audit append-only, replay and rollback constraints; no persistent databases touched.';
const S='11111111-1111-4111-8111-111111111111';
const I='22222222-2222-4222-8222-222222222222';
const R='33333333-3333-4333-8333-333333333333';
const INV='44444444-4444-4444-8444-444444444444';
const REQ='55555555-5555-4555-8555-555555555555';
const ENROLL='66666666-6666-4666-8666-666666666666';
const ACTIVATE='77777777-7777-4777-8777-777777777777';
const ISS='https://abcdefghijabcdefghij.supabase.co/auth/v1';
const P='ldos_app_auth.';
const q=x=>"'"+x+"'";
export function requireC14BDisposableOnly(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw new TypeError('C14B1 requires exactly --disposable-only');
  return true;
}
export function c14bGitBlob(s){
  if(typeof s!=='string')return null;
  return createHash('sha1').update('blob '+Buffer.byteLength(s,'utf8')+'\0')
    .update(s,'utf8').digest('hex');
}
export function validC14BSource(s){
  if(typeof s!=='string')return false;
  const must=[
    "current_database() <> 'ldos_c14b_disposable'",
    "current_user <> 'postgres'",
    "pg_is_in_recovery()",
    'CREATE TABLE ldos_app_auth.enrollment_reviewer_authorities',
    'CREATE TABLE ldos_app_auth.enrollment_invitations',
    'CREATE TABLE ldos_app_auth.enrollment_requests',
    'CREATE TABLE ldos_app_auth.enrollment_approvals',
    'CREATE TABLE ldos_app_auth.enrollment_audit_events',
    'CREATE FUNCTION ldos_app_auth.guard_enrollment_revision()',
    'CREATE FUNCTION ldos_app_auth.guard_enrollment_audit()',
    'REVOKE ALL ON ALL TABLES IN SCHEMA ldos_app_auth FROM PUBLIC;',
  ];
  return s.startsWith('-- STEP 40C-62D-C14B1')
    &&s.includes('DO $c14b_disposable_guard$')
    &&s.includes('END;\n$c14b_disposable_guard$;')
    &&s.trimEnd().endsWith('COMMIT;')&&must.every(x=>s.includes(x))
    &&c14bGitBlob(s)===C14B_SQL_BLOB
    &&!/^\s*(?:GRANT|CREATE ROLE|ALTER ROLE|CREATE EXTENSION|COPY)\b/im.test(s);
}
function docker(args,{input,raw=false,timeout=30000}={}){
  const p=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,
    timeout,maxBuffer:1024*1024});
  if(p.error)throw new Error('Disposable Docker unavailable');
  if(raw)return p;
  if(p.status!==0)throw new Error('Disposable Docker operation failed');
  return String(p.stdout||'').trim();
}
async function ready(name){
  for(let i=0;i<60;i++){
    const x=spawnSync('docker',['logs',name],{encoding:'utf8',
      windowsHide:true,timeout:10000,maxBuffer:1024*1024});
    if(x.status===0&&String(x.stdout+x.stderr).includes(
      'PostgreSQL init process complete; ready for start up.')){
      const p=spawnSync('docker',['exec',name,'pg_isready','-U','postgres',
        '-d',C14B_DB],{encoding:'utf8',windowsHide:true,timeout:10000});
      if(p.status===0)return;
    }
    await sleep(1000);
  }
  throw new Error('Disposable C14B postgres startup failed');
}
export async function runC14BDisposableSchemaProof(args=process.argv.slice(2)){
  requireC14BDisposableOnly(args);
  const name='ldos-c14b-review-'+randomBytes(6).toString('hex');
  const password=randomBytes(32).toString('hex');
  let created=false,stage='image preflight';
  const psql=(sql,raw=false)=>docker(['exec','-i',name,'psql','-X','-q',
    '-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d',C14B_DB],
    {input:sql,raw,timeout:50000});
  const denied=(sql,code)=>{
    const result=psql('\\set VERBOSITY verbose\n'+sql+'\n',true);
    assert.notEqual(result.status,0,'Unexpected SQL success');
    assert.match(String(result.stderr||''),new RegExp('\\b'+code+'\\b'));
  };
  const reviewer=(who,active=true)=>"INSERT INTO "+P+
    "enrollment_reviewer_authorities(reviewer_subject,authority_state,authority_scope) VALUES ("+
    q(who)+",'"+(active?'active':'revoked')+"','"+
    (active?'account_enrollment_review':'none')+"');";
  const approve=(id,purpose,digest)=>"INSERT INTO "+P+
    "enrollment_approvals(approval_id,request_id,subject,issuer,reviewer_subject,purpose,decision,approval_state,nonce_digest,expires_at) VALUES ("+
    [id,REQ,S,ISS,R,purpose].map(q).join(',')+
    ",'approve','unconsumed',"+q(digest)+",clock_timestamp()+interval '10 minutes');";
  try{
    docker(['info','--format','{{.ServerVersion}}']);
    docker(['image','inspect',C14B_IMAGE]);
    stage='new isolated PostgreSQL 17';
    docker(['run','-d','--rm','--pull','never','--network','none',
      '--name',name,'-e','POSTGRES_PASSWORD='+password,
      '-e','POSTGRES_DB='+C14B_DB,C14B_IMAGE],{timeout:120000});
    created=true;
    await ready(name);
    stage='load original ledger and disposable-only guarded enrollment schema';
    const ledger=readFileSync(new URL(
      '../../server/standalone/sql/landOsAccountAuthorityFoundation.sql',
      import.meta.url),'utf8');
    const schema=readFileSync(new URL(
      '../../server/standalone/sql/landOsEnrollmentReviewDisposable.sql',
      import.meta.url),'utf8');
    if(!validC14BSource(schema))throw new Error('Unreviewed schema');
    psql(ledger);
    psql(schema);
    assert.equal(psql('SELECT current_database();'),C14B_DB);
    assert.equal(psql("SELECT count(*) FROM information_schema.tables "+
      "WHERE table_schema='ldos_app_auth' AND table_name LIKE 'enrollment_%';"),'5');
    stage='reviewer default-revoked INSERT';
    psql("INSERT INTO "+P+"enrollment_reviewer_authorities(reviewer_subject) "+
      "VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');");
    stage='reviewer default-revoked SELECT';
    assert.equal(psql("SELECT authority_state||'|'||authority_scope||'|'||revision "+
      "FROM "+P+"enrollment_reviewer_authorities WHERE reviewer_subject="+
      q('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')+";"),'revoked|none|1');
    stage='reviewer revoked-to-active denial';
    denied("UPDATE "+P+"enrollment_reviewer_authorities SET authority_state='active' "+
      "WHERE reviewer_subject='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';",'42501');
    stage='seed distinct synthetic reviewers';
    for(const who of [I,R,S])psql(reviewer(who));
    stage='invitation and request binds';
    psql("INSERT INTO "+P+"enrollment_invitations "+
      "(invite_id,subject,issuer,issued_by,nonce_digest,invitation_state,expires_at) "+
      "VALUES ("+[INV,S,ISS,I,'a'.repeat(64)].map(q).join(',')+
      ",'pending',clock_timestamp()+interval '1 hour');");
    const reqInsert=(id,subject)=>"INSERT INTO "+P+"enrollment_requests "+
      "(request_id,invite_id,subject,issuer,expires_at) VALUES ("+
      [id,INV,subject,ISS].map(q).join(',')+",clock_timestamp()+interval '1 hour');";
    denied(reqInsert('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',R),'23503');
    psql(reqInsert(REQ,S));
    assert.equal(psql("SELECT request_state||'|'||revision FROM "+P+
      "enrollment_requests WHERE request_id="+q(REQ)+";"),'pending|1');
    denied(reqInsert('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',S),'23505');
    denied("UPDATE "+P+"enrollment_invitations SET subject="+q(R)+
      " WHERE invite_id="+q(INV)+";",'42501');
    assert.equal(psql("UPDATE "+P+"enrollment_invitations SET invitation_state='redeemed'"+
      " WHERE invite_id="+q(INV)+" RETURNING invitation_state||'|'||revision;"),
      'redeemed|2');
    assert.equal(psql("UPDATE "+P+"enrollment_requests SET request_state="+
      "'approved_for_enrollment' WHERE request_id="+q(REQ)+
      " RETURNING request_state||'|'||revision;"),'approved_for_enrollment|2');
    stage='purpose approval uniqueness, independent reviewer and no replay';
    denied("INSERT INTO "+P+"enrollment_approvals "+
      "(approval_id,request_id,subject,issuer,reviewer_subject,purpose,decision,"+
      "approval_state,nonce_digest,expires_at) VALUES ("+
      ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',REQ,S,ISS,S,
        'enroll_suspended'].map(q).join(',')+
      ",'approve','unconsumed',"+q('b'.repeat(64))+
      ",clock_timestamp()+interval '10 minutes');",'23514');
    psql(approve(ENROLL,'enroll_suspended','b'.repeat(64)));
    denied(approve('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'enroll_suspended','c'.repeat(64)),'23505');
    denied("UPDATE "+P+"enrollment_approvals SET reviewer_subject="+q(I)+
      " WHERE approval_id="+q(ENROLL)+";",'42501');
    stage='manual synthetic suspended-first and append-only audit constraints';
    assert.equal(psql("INSERT INTO "+P+"accounts(subject) VALUES ("+q(S)+
      ") RETURNING account_state||'|'||revision;"),'suspended|1');
    assert.equal(psql("UPDATE "+P+"enrollment_approvals SET approval_state='consumed',"+
      "consumed_at=clock_timestamp() WHERE approval_id="+q(ENROLL)+
      " RETURNING approval_state||'|'||revision;"),'consumed|2');
    assert.equal(psql("UPDATE "+P+"enrollment_requests SET "+
      "request_state='enrolled_suspended' WHERE request_id="+q(REQ)+
      " RETURNING request_state||'|'||revision;"),'enrolled_suspended|3');
    const audit=(id,type,rev)=>"INSERT INTO "+P+"enrollment_audit_events "+
      "(event_id,request_id,subject,reviewer_subject,event_type,account_revision) "+
      "VALUES ("+[id,REQ,S,R,type].map(q).join(',')+","+rev+");";
    psql(audit('88888888-8888-4888-8888-888888888888','enrolled_suspended',1));
    denied("UPDATE "+P+"enrollment_approvals SET approval_state='consumed'"+
      " WHERE approval_id="+q(ENROLL)+";",'42501');
    denied("UPDATE "+P+"enrollment_audit_events SET event_type='revoked';",'42501');
    denied("DELETE FROM "+P+"enrollment_audit_events;",'42501');
    denied("TRUNCATE "+P+"enrollment_audit_events;",'42501');
    stage='separate synthetic activation proof';
    psql(approve(ACTIVATE,'activate','c'.repeat(64)));
    assert.equal(psql("UPDATE "+P+"accounts SET account_state='active' "+
      "WHERE subject="+q(S)+" RETURNING account_state||'|'||revision;"),
      'active|2');
    assert.equal(psql("UPDATE "+P+"enrollment_approvals SET approval_state='consumed',"+
      "consumed_at=clock_timestamp() WHERE approval_id="+q(ACTIVATE)+
      " RETURNING approval_state||'|'||revision;"),'consumed|2');
    assert.equal(psql("UPDATE "+P+"enrollment_requests SET request_state='activated'"+
      " WHERE request_id="+q(REQ)+" RETURNING request_state||'|'||revision;"),
      'activated|4');
    psql(audit('99999999-9999-4999-8999-999999999999','activated',2));
    denied("UPDATE "+P+"enrollment_requests SET request_state='enrolled_suspended'"+
      " WHERE request_id="+q(REQ)+";",'42501');
    denied("UPDATE "+P+"accounts SET revision=50 WHERE subject="+q(S)+";",'42501');
    denied(audit('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','activated','NULL'),'23514');
    stage='synthetic rollback after invalid audit';
    denied('BEGIN; INSERT INTO '+P+"accounts(subject) VALUES ("+
      q('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')+'); '+
      audit('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','activated','NULL')+
      ' COMMIT;','23514');
    assert.equal(psql("SELECT count(*) FROM "+P+"accounts WHERE subject="+
      q('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')+";"),'0');
    assert.equal(psql("SELECT (SELECT count(*) FROM "+P+"accounts),"+
      "(SELECT count(*) FROM "+P+"enrollment_audit_events),"+
      "(SELECT count(*) FROM "+P+"sessions),"+
      "(SELECT count(*) FROM "+P+"county_grants);"),'1|2|0|0');
    assert.equal(psql("SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN "+
      "('ldos_auth_gateway_login','ldos_auth_enrollment_writer');"),'0');
    process.stdout.write(C14B_PASS+'\n');
    return true;
  }catch{
    throw new Error('C14B1 disposable enrollment schema verification failed at '+
      stage+'; no persistent database targeted');
  }finally{
    if(created){
      try{docker(['rm','--force','--volumes',name],{timeout:30000});}
      catch{process.stderr.write('WARNING: C14B1 disposable container cleanup unconfirmed\n');}
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runC14BDisposableSchemaProof().catch(e=>{
    process.stderr.write(e.message+'\n');process.exitCode=1;
  });
}
