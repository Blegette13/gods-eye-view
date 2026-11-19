import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {C14B_DB,C14B_IMAGE,validC14BSource} from './app-auth-enrollment-schema-disposable-smoke.mjs';
import {verifyC14B2ASource,c14b2aGitBlob} from './app-auth-enrollment-atomic-disposable-plan.mjs';
import {exactRoleSql} from './app-auth-enrollment-roles-disposable-smoke.mjs';

/**
 * C14B2C2B: synthetic owner-only review issuance / approval rollback proof.
 * NEVER run against persistent auth-dev. A real reviewer is NOT authenticated
 * here; no function EXECUTE privilege is granted to either synthetic LOGIN.
 */
export const C14B2C2B_SQL_BLOB='__PIN_SQL_GIT_BLOB__';
export const C14B2C2B_PASS='PASS: C14B2C2B isolated PG17 synthetic reviewer issuance, purpose-specific approval, atomic reviewed audit, denied replay and audit rollback, suspended enrollment and separate activation; no real reviewer authentication or persistent auth-dev writes.';

const P='ldos_app_auth.';
const ISS='https://abcdefghijabcdefghij.supabase.co/auth/v1';
const S1='11111111-1111-4111-8111-111111111111';
const S2='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVITER='22222222-2222-4222-8222-222222222222';
const REVIEWER='33333333-3333-4333-8333-333333333333';
const INV1='44444444-4444-4444-8444-444444444444';
const REQ1='55555555-5555-4555-8555-555555555555';
const APPR1='66666666-6666-4666-8666-666666666666';
const APPR2='77777777-7777-4777-8777-777777777777';
const AUD1='88888888-8888-4888-8888-888888888888';
const AUD2='99999999-9999-4999-8999-999999999999';
const INV2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQ2='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const APPR3='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const AUD3='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const AUD4='ffffffff-ffff-4fff-8fff-ffffffffffff';
const q=v=>"'"+v+"'";

export function requireC14B2C2BOnly(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw new Error('Only --disposable-only is supported');
  return true;
}
export function verifyC14B2C2BSource(source){
  if(typeof source!=='string'||c14b2aGitBlob(source)!==C14B2C2B_SQL_BLOB)
    throw new Error('Unreviewed C14B2C2B SQL');
  if(!source.includes("current_database()<>'ldos_c14b_disposable'")
    ||!source.includes("current_user<>'postgres'")
    ||!source.includes("current_setting('transaction_isolation')<>'serializable'")
    ||!source.includes('SECURITY INVOKER')
    ||!source.includes('REVOKE ALL ON FUNCTION ldos_app_auth.disposable_issue_enrollment_review(')
    ||!source.trimEnd().endsWith('COMMIT;'))
    throw new Error('C14B2C2B SQL trust boundary changed');
  return true;
}
export function syntheticReviewRequest({subject,invitation,request,digest}){
  if(![subject,invitation,request].every(v=>
    typeof v==='string'&&/^[0-9a-f-]{36}$/.test(v))
    ||typeof digest!=='string'||!/^[0-9a-f]{64}$/.test(digest))
    throw new TypeError('Only synthetic UUID and lowercase digest fixtures');
  return [
    'INSERT INTO '+P+'enrollment_invitations '+
      '(invite_id,subject,issuer,issued_by,nonce_digest,invitation_state,expires_at) VALUES ('+
      [invitation,subject,ISS,INVITER,digest].map(q).join(',')+
      ",'pending',clock_timestamp()+interval '1 hour');",
    'INSERT INTO '+P+'enrollment_requests '+
      '(request_id,invite_id,subject,issuer,expires_at) VALUES ('+
      [request,invitation,subject,ISS].map(q).join(',')+
      ",clock_timestamp()+interval '1 hour');",
    'UPDATE '+P+"enrollment_invitations SET invitation_state='redeemed' "+
      'WHERE invite_id='+q(invitation)+';',
  ].join('\n');
}
export function syntheticIssue({phase,subject,request,reviewer,approval,digest,audit,revision=null}){
  if(!['enroll_suspended','activate'].includes(phase)
    ||![subject,request,reviewer,approval,audit].every(v=>
      typeof v==='string'&&/^[0-9a-f-]{36}$/.test(v))
    ||typeof digest!=='string'||!/^[0-9a-f]{64}$/.test(digest)
    ||(revision!==null&&revision!==1&&revision!==99))
    throw new TypeError('Bad synthetic issuance fixture');
  const fields=[phase,subject,ISS,request,reviewer,approval,digest,audit]
    .map(q).join(',');
  return 'SELECT '+P+'disposable_issue_enrollment_review('+
    fields+','+(revision===null?'NULL':String(revision))+');';
}
function docker(args,{input,raw=false,timeout=30000}={}){
  const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,
    timeout,maxBuffer:1024*1024});
  if(r.error)throw new Error('C14B2C2B Docker unavailable');
  if(raw)return r;
  if(r.status!==0)throw new Error('C14B2C2B isolated Docker operation failed');
  return String(r.stdout||'').trim();
}
async function ready(name){
  for(let i=0;i<60;i++){
    const r=spawnSync('docker',['logs',name],{
      encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024,
    });
    if(r.status===0&&String(r.stdout+r.stderr).includes(
      'PostgreSQL init process complete; ready for start up.')){
      const ping=spawnSync('docker',['exec',name,'pg_isready','-U','postgres',
        '-d',C14B_DB],{encoding:'utf8',windowsHide:true,timeout:10000});
      if(ping.status===0)return;
    }
    await sleep(1000);
  }
  throw new Error('C14B2C2B isolated PostgreSQL unavailable');
}
export async function runC14B2C2BProof(args=process.argv.slice(2)){
  requireC14B2C2BOnly(args);
  const name='ldos-c14b2c2b-issuer-'+randomBytes(6).toString('hex');
  const root=randomBytes(32).toString('hex');
  const executor=randomBytes(32).toString('hex');
  const issuer=randomBytes(32).toString('hex');
  let created=false,stage='local PG17 preflight';
  const psql=(statement,raw=false)=>docker([
    'exec','-i',name,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1',
    '-U','postgres','-d',C14B_DB,
  ],{input:statement,raw,timeout:50000});
  const denied=(sql,state)=>{
    const response=psql('\\set VERBOSITY verbose\n'+sql+'\n',true);
    assert.notEqual(response.status,0,'Unexpected synthetic SQL success');
    assert.match(String(response.stderr||''),new RegExp('\\b'+state+'\\b'));
  };
  const tx=s=>'BEGIN ISOLATION LEVEL SERIALIZABLE;\n'+s+'\nCOMMIT;';
  const exec=({phase,subject,request,approval,audit,revision=null})=>
    'SELECT '+P+'disposable_enrollment_transition('+
      [phase,subject,ISS,request,approval,audit].map(q).join(',')+
      ','+(revision===null?'NULL':String(revision))+');';
  const count=(name)=>psql('SELECT count(*) FROM '+P+name+';');
  const status=(table,field,idField,id)=>
    psql('SELECT '+field+' FROM '+P+table+' WHERE '+idField+'='+q(id)+';');
  try{
    docker(['info','--format','{{.ServerVersion}}']);
    docker(['image','inspect',C14B_IMAGE]);
    stage='create isolated networkless PG17 synthetic database';
    docker(['run','-d','--rm','--pull','never','--network','none',
      '--name',name,'-e','POSTGRES_PASSWORD='+root,
      '-e','POSTGRES_DB='+C14B_DB,C14B_IMAGE],{timeout:120000});
    created=true;
    await ready(name);

    stage='load pinned original ledger, enrollment, transition and issuance SQL';
    const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
    const ledger=read('../../server/standalone/sql/landOsAccountAuthorityFoundation.sql');
    const enrollment=read('../../server/standalone/sql/landOsEnrollmentReviewDisposable.sql');
    const atomic=read('../../server/standalone/sql/landOsEnrollmentAtomicDisposable.sql');
    const issuance=read('../../server/standalone/sql/landOsReviewIssuanceAtomicDisposable.sql');
    const roles=read('../../server/standalone/sql/landOsEnrollmentRolesDisposable.sql');
    if(!validC14BSource(enrollment)||!verifyC14B2ASource(atomic)
      ||!verifyC14B2C2BSource(issuance))
      throw new Error('Synthetic SQL review signature changed');
    psql(ledger);psql(enrollment);psql(atomic);psql(issuance);
    psql(exactRoleSql(roles,executor,issuer));
    assert.equal(psql('SELECT current_database();'),C14B_DB);

    stage='verify synthetic app login has no approval issuance EXECUTE';
    const call="ldos_app_auth.disposable_issue_enrollment_review(text,uuid,text,uuid,uuid,uuid,text,uuid,bigint)";
    assert.equal(psql("SELECT has_function_privilege("+
      "'ldos_auth_review_issuer_login','"+call+"','EXECUTE');"),'f');
    assert.equal(psql("SELECT has_function_privilege("+
      "'ldos_auth_enrollment_executor_login','"+call+"','EXECUTE');"),'f');
    const as=(role,secret,statement,raw=false)=>docker([
      'exec','-i','-e','PGPASSWORD='+secret,name,'psql','-X','-q','-A','-t',
      '-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U',role,'-d',C14B_DB,
    ],{input:statement,raw,timeout:30000});
    for(const [role,secret] of [
      ['ldos_auth_review_issuer_login',issuer],
      ['ldos_auth_enrollment_executor_login',executor],
    ]){
      assert.equal(as(role,secret,'SELECT current_user;'),role);
      const d=as(role,secret,'\\set VERBOSITY verbose\n'+
        'SELECT '+P+'disposable_issue_enrollment_review('+
        'NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);\n',true);
      assert.notEqual(d.status,0);
      assert.match(String(d.stderr||''),/\b42501\b/);
    }

    stage='seed three-party synthetic reviewer authority and pending request';
    for(const who of [INVITER,REVIEWER]){
      psql('INSERT INTO '+P+'enrollment_reviewer_authorities '+
        '(reviewer_subject,authority_state,authority_scope) VALUES ('+
        q(who)+",'active','account_enrollment_review');");
    }
    psql(syntheticReviewRequest({
      subject:S1,invitation:INV1,request:REQ1,digest:'a'.repeat(64),
    }));
    const enroll={phase:'enroll_suspended',subject:S1,request:REQ1,
      reviewer:REVIEWER,approval:APPR1,digest:'b'.repeat(64),audit:AUD1};
    denied(syntheticIssue(enroll),'42501'); // nonserializable
    denied(tx(syntheticIssue({...enroll,reviewer:INVITER})),'42501');
    denied(tx(syntheticIssue({...enroll,reviewer:S1})),'42501');

    stage='atomic issuance of enrollment approval with reviewed audit';
    assert.equal(psql(tx(syntheticIssue(enroll))),'1');
    assert.equal(status('enrollment_requests','request_state','request_id',REQ1),
      'approved_for_enrollment');
    assert.equal(status('enrollment_approvals','approval_state','approval_id',APPR1),
      'unconsumed');
    assert.equal(status('enrollment_audit_events','event_type','event_id',AUD1),
      'reviewed');
    assert.equal(count('accounts'),'0');
    assert.equal(count('enrollment_audit_events'),'1');
    stage='deny same-purpose replay before any account mutation';
    denied(tx(syntheticIssue({...enroll,approval:APPR3,audit:AUD3})),'42501');
    assert.equal(count('enrollment_approvals'),'1');
    assert.equal(count('enrollment_audit_events'),'1');

    stage='consume independently issued enrollment approval';
    assert.equal(psql(tx(exec({phase:'enroll_suspended',subject:S1,
      request:REQ1,approval:APPR1,audit:AUD2}))),'1');
    assert.equal(status('accounts',"account_state||'|'||revision",'subject',S1),
      'suspended|1');
    assert.equal(status('enrollment_approvals','approval_state','approval_id',APPR1),
      'consumed');
    assert.equal(count('enrollment_audit_events'),'2');

    stage='separately issue activation-purpose approval';
    const activate={phase:'activate',subject:S1,request:REQ1,
      reviewer:REVIEWER,approval:APPR2,digest:'c'.repeat(64),
      audit:AUD3,revision:1};
    denied(tx(syntheticIssue({...activate,revision:99})),'42501');
    assert.equal(psql(tx(syntheticIssue(activate))),'1');
    assert.equal(status('enrollment_requests','request_state','request_id',REQ1),
      'enrolled_suspended');
    assert.equal(count('enrollment_audit_events'),'3');
    stage='consume independent activation approval and verify revision';
    assert.equal(psql(tx(exec({phase:'activate',subject:S1,request:REQ1,
      approval:APPR2,audit:AUD4,revision:1}))),'2');
    assert.equal(status('accounts',"account_state||'|'||revision",'subject',S1),
      'active|2');
    assert.equal(count('enrollment_audit_events'),'4');
    denied(tx(syntheticIssue({...activate,approval:APPR3,audit:AUD4})),'42501');
    assert.equal(count('enrollment_audit_events'),'4');

    stage='verify mandatory audit conflict aborts approval issuance';
    psql(syntheticReviewRequest({subject:S2,invitation:INV2,request:REQ2,
      digest:'d'.repeat(64)}));
    const second={phase:'enroll_suspended',subject:S2,request:REQ2,
      reviewer:REVIEWER,approval:APPR3,digest:'e'.repeat(64),audit:AUD1};
    denied(tx(syntheticIssue(second)),'23505'); // duplicate audit id
    assert.equal(status('enrollment_requests','request_state','request_id',REQ2),
      'pending');
    assert.equal(status('enrollment_approvals','approval_state','approval_id',APPR3),
      '');
    assert.equal(count('enrollment_approvals'),'2');
    assert.equal(count('enrollment_audit_events'),'4');
    assert.equal(count('sessions'),'0');
    assert.equal(count('county_grants'),'0');

    process.stdout.write(C14B2C2B_PASS+'\n');
    return true;
  }catch{
    throw new Error('C14B2C2B isolated synthetic review issuance failed at '+
      stage+'; no persistent database targeted');
  }finally{
    if(created){
      try{docker(['rm','--force','--volumes',name],{timeout:30000});}
      catch{process.stderr.write('WARNING: C14B2C2B disposable cleanup unconfirmed\n');}
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runC14B2C2BProof().catch(e=>{
    process.stderr.write(e.message+'\n');process.exitCode=1;
  });
}
