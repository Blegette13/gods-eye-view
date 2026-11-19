import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {
  C14B_DB,C14B_IMAGE,validC14BSource,
} from './app-auth-enrollment-schema-disposable-smoke.mjs';
import {
  verifyC14B2ASource,
} from './app-auth-enrollment-atomic-disposable-plan.mjs';

/**
 * Step 40C-62D-C14B2B — SYNTHETIC ATOMIC SQL REHEARSAL.
 * No real Supabase subjects, PG credentials, or app role; no host networking,
 * ports, mounts, external storage, or persistent auth-dev connections.
 * This executes the prototype under the disposable superuser. It does NOT
 * prove real independent operator approval or a restricted writer.
 */
export const C14B2B_PASS=
  'PASS: C14B2B isolated PostgreSQL 17 serializable synthetic enrollment and activation, separate approval, audit-in-transaction, replay denial and rollback verified; no persistent databases touched.';

const ISS='https://abcdefghijabcdefghij.supabase.co/auth/v1';
const S1='11111111-1111-4111-8111-111111111111';
const S2='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVITER='22222222-2222-4222-8222-222222222222';
const REVIEWER='33333333-3333-4333-8333-333333333333';
const INV1='44444444-4444-4444-8444-444444444444';
const REQ1='55555555-5555-4555-8555-555555555555';
const APPROVE_ENROLL='66666666-6666-4666-8666-666666666666';
const APPROVE_ACTIVE='77777777-7777-4777-8777-777777777777';
const AUDIT1='88888888-8888-4888-8888-888888888888';
const AUDIT2='99999999-9999-4999-8999-999999999999';
const INV2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQ2='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const APPROVE_2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const P='ldos_app_auth.';
const quote=value=>"'"+value+"'";
const TABLES=[
  'accounts','sessions','county_grants','enrollment_requests',
  'enrollment_approvals','enrollment_audit_events',
];

export function requireC14B2BDisposableOnly(args){
  if(!Array.isArray(args)||args.length!==1||args[0]!=='--disposable-only')
    throw new Error('C14B2B requires exactly --disposable-only');
  return true;
}
export function syntheticReviewFixture({subject,invite,request,approval,digest,approvalDigest}){
  if(![subject,invite,request,approval].every(x=>
    typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x))
    ||typeof digest!=='string'||!/^[0-9a-f]{64}$/.test(digest)
    ||typeof approvalDigest!=='string'||!/^[0-9a-f]{64}$/.test(approvalDigest)
    ||approvalDigest===digest)
    throw new TypeError('Only fixed synthetic review fixtures accepted');
  return [
    "INSERT INTO "+P+"enrollment_invitations "+
      "(invite_id,subject,issuer,issued_by,nonce_digest,invitation_state,expires_at) "+
      "VALUES ("+[invite,subject,ISS,INVITER,digest].map(quote).join(',')+
      ",'pending',clock_timestamp()+interval '1 hour');",
    "INSERT INTO "+P+"enrollment_requests "+
      "(request_id,invite_id,subject,issuer,expires_at) "+
      "VALUES ("+[request,invite,subject,ISS].map(quote).join(',')+
      ",clock_timestamp()+interval '1 hour');",
    "UPDATE "+P+"enrollment_invitations SET invitation_state='redeemed' "+
      "WHERE invite_id="+quote(invite)+";",
    "UPDATE "+P+"enrollment_requests SET request_state='approved_for_enrollment' "+
      "WHERE request_id="+quote(request)+";",
    "INSERT INTO "+P+"enrollment_approvals "+
      "(approval_id,request_id,subject,issuer,reviewer_subject,purpose,"+
      "decision,approval_state,nonce_digest,expires_at) VALUES ("+
      [approval,request,subject,ISS,REVIEWER,'enroll_suspended'].map(quote).join(',')+
      ",'approve','unconsumed',"+quote(approvalDigest)+
      ",clock_timestamp()+interval '10 minutes');",
  ].join('\n');
}
export function syntheticTransition({phase,subject,request,approval,audit,revision=null}){
  if(!['enroll_suspended','activate'].includes(phase)
    ||![subject,request,approval,audit].every(x=>
      typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x))
    ||(revision!==null&&revision!==1&&revision!==999))
    throw new TypeError('Only fixed synthetic transition shape accepted');
  return 'SELECT '+P+'disposable_enrollment_transition('+
    [phase,subject,ISS,request,approval,audit].map(quote).join(',')+
    ','+(revision===null?'NULL':String(revision))+');';
}
function docker(args,{input,raw=false,timeout=40000}={}){
  const x=spawnSync('docker',args,{
    encoding:'utf8',input,windowsHide:true,timeout,maxBuffer:1024*1024,
  });
  if(x.error)throw new Error('C14B2B Docker unavailable');
  if(raw)return x;
  if(x.status!==0)throw new Error('C14B2B disposable Docker operation failed');
  return String(x.stdout||'').trim();
}
async function ready(name){
  for(let i=0;i<60;i++){
    const logs=spawnSync('docker',['logs',name],{
      encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024,
    });
    if(logs.status===0&&String(logs.stdout+logs.stderr).includes(
      'PostgreSQL init process complete; ready for start up.')){
      const ping=spawnSync('docker',['exec',name,'pg_isready','-U','postgres',
        '-d',C14B_DB],{encoding:'utf8',windowsHide:true,timeout:10000});
      if(ping.status===0)return;
    }
    await sleep(1000);
  }
  throw new Error('C14B2B synthetic PG17 did not become ready');
}
export async function runC14B2BDisposableProof(args=process.argv.slice(2)){
  requireC14B2BDisposableOnly(args);
  const container='ldos-c14b2b-atomic-'+randomBytes(6).toString('hex');
  const disposableRootPassword=randomBytes(32).toString('hex');
  let created=false;
  let stage='image preflight';
  const psql=(statement,{raw=false}={})=>docker([
    'exec','-i',container,'psql','-X','-q','-A','-t',
    '-v','ON_ERROR_STOP=1','-U','postgres','-d',C14B_DB,
  ],{input:statement,raw,timeout:50000});
  const rejected=(statement,sqlstate)=>{
    const result=psql('\\set VERBOSITY verbose\n'+statement+'\n',{raw:true});
    assert.notEqual(result.status,0,'Unexpected synthetic SQL success');
    assert.match(String(result.stderr||''),new RegExp('\\b'+sqlstate+'\\b'));
  };
  const tx=(body,isolation='SERIALIZABLE')=>
    'BEGIN ISOLATION LEVEL '+isolation+';\n'+body+'\nCOMMIT;';
  const totals=()=>psql('SELECT '+
    TABLES.map(name=>'(SELECT count(*) FROM '+P+name+')').join(',')+';');
  const state=()=>psql('SELECT account_state||'+quote('|')+
    '||revision FROM '+P+'accounts WHERE subject='+quote(S1)+';');
  const acceptance=({phase,subject,request,approval,audit,revision=null})=>
    tx(syntheticTransition({phase,subject,request,approval,audit,revision}));
  try{
    docker(['info','--format','{{.ServerVersion}}']);
    docker(['image','inspect',C14B_IMAGE]);
    stage='create fresh network-isolated PG17';
    docker(['run','-d','--rm','--pull','never','--network','none',
      '--name',container,'-e','POSTGRES_PASSWORD='+disposableRootPassword,
      '-e','POSTGRES_DB='+C14B_DB,C14B_IMAGE],{timeout:120000});
    created=true;
    await ready(container);

    stage='load exact reviewed synthetic ledger/schema/atomic prototype';
    const ledger=readFileSync(new URL(
      '../../server/standalone/sql/landOsAccountAuthorityFoundation.sql',
      import.meta.url),'utf8');
    const schema=readFileSync(new URL(
      '../../server/standalone/sql/landOsEnrollmentReviewDisposable.sql',
      import.meta.url),'utf8');
    const atomic=readFileSync(new URL(
      '../../server/standalone/sql/landOsEnrollmentAtomicDisposable.sql',
      import.meta.url),'utf8');
    if(!validC14BSource(schema)||!verifyC14B2ASource(atomic))
      throw new Error('Reviewed synthetic schema/prototype changed');
    psql(ledger);
    psql(schema);
    psql(atomic);
    assert.equal(psql('SELECT current_database();'),C14B_DB);
    assert.equal(totals(),'0|0|0|0|0|0');

    stage='seed only synthetic independent reviewer and inviter';
    for(const who of [INVITER,REVIEWER]){
      psql('INSERT INTO '+P+'enrollment_reviewer_authorities '+
        '(reviewer_subject,authority_state,authority_scope) VALUES ('+
        quote(who)+",'active','account_enrollment_review');");
    }
    stage='seed synthetic first approval and validate transaction gate';
    psql(syntheticReviewFixture({
      subject:S1,invite:INV1,request:REQ1,approval:APPROVE_ENROLL,
      digest:'a'.repeat(64),approvalDigest:'f'.repeat(64),
    }));
    const enroll={phase:'enroll_suspended',subject:S1,request:REQ1,
      approval:APPROVE_ENROLL,audit:AUDIT1};

    rejected(syntheticTransition(enroll),'42501'); // nonserializable
    assert.equal(totals(),'0|0|0|1|1|0');
    rejected(acceptance({...enroll,subject:S2}),'42501'); // mismatch
    assert.equal(totals(),'0|0|0|1|1|0');

    stage='atomic suspended-first enrollment';
    assert.equal(psql(acceptance(enroll)),'1');
    assert.equal(state(),'suspended|1');
    assert.equal(totals(),'1|0|0|1|1|1');
    assert.equal(psql('SELECT approval_state||'+quote('|')+
      '||revision FROM '+P+'enrollment_approvals WHERE approval_id='+
      quote(APPROVE_ENROLL)+';'),'consumed|2');
    assert.equal(psql('SELECT request_state||'+quote('|')+
      '||revision FROM '+P+'enrollment_requests WHERE request_id='+
      quote(REQ1)+';'),'enrolled_suspended|3');
    stage='deny enrollment replay and preserve existing suspended account';
    rejected(acceptance({...enroll,audit:AUDIT2}),'42501');
    assert.equal(state(),'suspended|1');
    assert.equal(totals(),'1|0|0|1|1|1');

    stage='seed independently purposed activation approval';
    psql('INSERT INTO '+P+'enrollment_approvals '+
      '(approval_id,request_id,subject,issuer,reviewer_subject,purpose,'+
      'decision,approval_state,nonce_digest,expires_at) VALUES ('+
      [APPROVE_ACTIVE,REQ1,S1,ISS,REVIEWER,'activate'].map(quote).join(',')+
      ",'approve','unconsumed',"+quote('b'.repeat(64))+
      ",clock_timestamp()+interval '10 minutes');");
    const activate={phase:'activate',subject:S1,request:REQ1,
      approval:APPROVE_ACTIVE,audit:AUDIT2,revision:1};
    rejected(acceptance({...activate,revision:999}),'42501');
    assert.equal(state(),'suspended|1');
    assert.equal(totals(),'1|0|0|1|2|1');

    stage='atomic separate activation with revision bump and mandatory audit';
    assert.equal(psql(acceptance(activate)),'2');
    assert.equal(state(),'active|2');
    assert.equal(totals(),'1|0|0|1|2|2');
    assert.equal(psql('SELECT string_agg(event_type,'+quote('|')+
      ' ORDER BY account_revision) FROM '+P+
      'enrollment_audit_events WHERE request_id='+quote(REQ1)+';'),
      'enrolled_suspended|activated');
    rejected(acceptance({...activate,audit:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}),'42501');
    assert.equal(state(),'active|2');

    stage='test required audit insertion failure rolls entire enrollment back';
    psql(syntheticReviewFixture({
      subject:S2,invite:INV2,request:REQ2,approval:APPROVE_2,
      digest:'c'.repeat(64),approvalDigest:'e'.repeat(64),
    }));
    const second={phase:'enroll_suspended',subject:S2,
      request:REQ2,approval:APPROVE_2,audit:AUDIT1};
    rejected(acceptance(second),'23505'); // duplicated audit PK
    assert.equal(psql('SELECT count(*) FROM '+P+'accounts WHERE subject='+
      quote(S2)+';'),'0');
    assert.equal(psql('SELECT approval_state FROM '+P+
      'enrollment_approvals WHERE approval_id='+quote(APPROVE_2)+';'),
      'unconsumed');
    assert.equal(psql('SELECT request_state FROM '+P+
      'enrollment_requests WHERE request_id='+quote(REQ2)+';'),
      'approved_for_enrollment');
    assert.equal(totals(),'1|0|0|2|3|2');
    assert.equal(psql('SELECT count(*) FROM pg_catalog.pg_roles '+
      "WHERE rolname IN ('ldos_auth_gateway_login',"+
      "'ldos_auth_enrollment_writer');"),'0');

    process.stdout.write(C14B2B_PASS+'\n');
    return true;
  }catch{
    throw new Error('C14B2B isolated PostgreSQL proof failed at '+stage+
      '; no persistent database targeted');
  }finally{
    if(created){
      try{docker(['rm','--force','--volumes',container],{timeout:30000});}
      catch{process.stderr.write(
        'WARNING: C14B2B isolated container cleanup unconfirmed\n');}
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runC14B2BDisposableProof().catch(e=>{
    process.stderr.write(e.message+'\n');process.exitCode=1;
  });
}
