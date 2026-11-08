import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {
  EPOCH_CONCURRENT_SMOKE_PASS,
  requireEpochConcurrentDisposableOptIn,
  runEpochConcurrentDisposableSmoke,
  createDisposableEpochSqlWorker,
  createDisposableEpochWorkerHandle,
} from '../../../scripts/bdp/parcel-epoch-concurrency-disposable-smoke.mjs';

const src=readFileSync(new URL(
  '../../../scripts/bdp/parcel-epoch-concurrency-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('40C44 requires exactly one --disposable-only flag',()=>{
  assert.equal(requireEpochConcurrentDisposableOptIn(['--disposable-only']),true);
  for(const args of [
    null,[],['--prod'],['--local'],
    ['--disposable-only','--reuse'],
    ['--disposable-only','--disposable-only'],
  ])assert.throws(()=>requireEpochConcurrentDisposableOptIn(args),
    /Refusing concurrent epoch SQL smoke/);
});

test('invalid opt-in refuses before any Docker action',async()=>{
  await assert.rejects(runEpochConcurrentDisposableSmoke(['--production']),
    /Refusing concurrent epoch SQL smoke/);
});

test('worker accepts only a freshly named disposable container',()=>{
  for(const invalid of [
    null,undefined,'postgres','bdp-postgis',
    'ldos-epoch-concurrency-not-hex',
    'ldos-epoch-concurrency-a',
    'ldos-epoch-concurrency-aaaaaaaaaaaa; DROP',
  ])assert.throws(()=>createDisposableEpochSqlWorker(invalid),TypeError);
});

test('new PostGIS container has no host ports, network or local data mounts',()=>{
  assert.match(src,/docker\(\['run','-d','--name',container,'--network','none'/);
  assert.doesNotMatch(src,/'-p'|'-P'|'--mount'|'--volume'|'--privileged'/);
  assert.match(src,/docker\(\['rm','--force','--volumes',container\]/);
  assert.match(src,/randomBytes\(6\)\.toString\('hex'\)/);
  assert.doesNotMatch(src,/bdp-postgis|connectionString|new Pool\(/);
});

test('two live psql BACKENDS are spawned, not a single combined SQL transaction',()=>{
  assert.match(src,/import \{spawn,spawnSync\} from 'node:child_process'/);
  assert.match(src,/const child=spawn\('docker'/);
  assert.match(src,/'exec','-i',container,'psql'/);
  assert.match(src,/const first=createDisposableEpochSqlWorker\(container\)/);
  assert.match(src,/const second=createDisposableEpochSqlWorker\(container\)/);
  assert.match(src,/const secondPid=await second\.pid\(\)/);
  assert.match(src,/await first\.pid\(\)/);
});

test('actual Postgres lock wait is observed from independent pg_stat_activity',()=>{
  assert.match(src,/pg_catalog\.pg_stat_activity WHERE pid=/);
  assert.match(src,/if\(waiting==='Lock'\)return/);
  assert.match(src,/await lockWait\(secondPid,second,label\)/);
  assert.doesNotMatch(src,/pg_sleep\s*\(/i);
  assert.match(src,/SECOND_WRITTEN_/);
  assert.match(src,/FIRST_WRITTEN_/);
});

test('first transaction stays uncommitted until second is proven blocked',()=>{
  const block=src.indexOf('await lockWait(secondPid,second,label)');
  const commit=src.indexOf('first.send((rollbackFirst?');
  assert.ok(block>0&&commit>block);
  assert.match(src,/Uncommitted epoch leaked/);
  assert.match(src,/Uncommitted rights change leaked/);
  assert.match(src,/Waiting second writer leaked epoch/);
  assert.match(src,/Waiting writer leaked rights change/);
});

test('first commit and second commit are separated by observable epoch check',()=>{
  assert.match(src,/await first\.until\('FIRST_FINISHED_'\+label\)/);
  assert.match(src,/await second\.until\('SECOND_WRITTEN_'\+label\)/);
  assert.match(src,/Uncommitted second bump visible before its COMMIT/);
  assert.match(src,/second\.send\('COMMIT;/);
  assert.match(src,/await second\.until\('SECOND_FINISHED_'\+label\)/);
  assert.match(src,/Concurrent updates must serialize the committed epoch/);
});

test('ABAs are checked independently for session grant, publication and run',()=>{
  for(const key of [
    "id:'SESSION'","id:'PUBLICATION'","id:'RUN'",
    'session_county_epochs','parcel_policy_epochs','parcel_run_selection_epochs',
    'allow_discovery=FALSE','allow_discovery=TRUE',
    "review_state='revoked'","review_state='unreviewed'",
    "source_notes='concurrent-change'","source_notes=NULL",
  ])assert.ok(src.includes(key),key);
  assert.match(src,/for\(const item of cases\)await concurrentChange\(item\)/);
  assert.match(src,/A→B→A returns identical facts but NOT the original version/);
});

test('rollback contender test consumes only one committed epoch increment',()=>{
  assert.match(src,/await concurrentChange\(cases\[0\],true\)/);
  assert.match(src,/rollbackFirst\?'ROLLBACK;':'COMMIT;'/);
  assert.match(src,/initial\+\(rollbackFirst\?1n:2n\)/);
  assert.match(src,/initial\+\(rollbackFirst\?0n:1n\)/);
});

test('all source and account records come from synthetic fixtures and draft SQL',()=>{
  for(const item of [
    'SYNTHETIC_DRIVER_FIXTURE_SQL',
    'parcelIndexFoundation.sql',
    'parcelRestrictedRpcFoundation.sql',
    'parcelGeometryPublicationRightsFoundation.sql',
    'parcelRunSealFoundation.sql',
    'parcelPolicyEpochFoundation.sql',
    'parcelSessionCountyEpochFoundation.sql',
    'parcelRunSelectionEpochFoundation.sql',
    'step40c13-synthetic',
  ])assert.ok(src.includes(item),item);
  assert.doesNotMatch(src,/DROP SCHEMA|CREATE ROLE|GRANT EXECUTE/);
});

test('Docker and psql resources are cleaned up even when concurrent tests fail',()=>{
  assert.match(src,/finally\{\s*for\(const worker of workers\)/);
  assert.match(src,/worker\.close\(\)/);
  assert.match(src,/docker\(\['rm','--force','--volumes',container\]/);
  assert.match(src,/replaceAll\(password,'\[redacted\]'\)/);
  assert.match(src,/SET LOCAL lock_timeout='25s'/);
});

test('concurrent smoke is NOT a real browser release gate or GIS license proof',()=>{
  assert.match(EPOCH_CONCURRENT_SMOKE_PASS,
    /^PASS: disposable PostGIS concurrent epoch writers serialize/);
  assert.match(src,/NOT a real identity provider/);
  assert.match(src,/NOT a real identity provider, licensed county/);
  assert.doesNotMatch(src,/createServer\(|\.listen\(|app\.get\(|ST_AsGeoJSON/);
});

test('status marker waits for a full backend PID instead of a partial packet',()=>{
  assert.match(src,/LDO_PID_READY/);
  assert.match(src,/await until\('LDO_PID_READY'\)/);
  assert.match(src,/LDO_PID=\(\[1-9\]\[0-9\]\*\)/);
  assert.match(src,/get output\(\)\{return output;\}/);
});


function fakePsqlChild(){
  const child=new EventEmitter();
  child.stdin=new PassThrough();
  child.stdout=new PassThrough();
  child.stderr=new PassThrough();
  child.kill=()=>true;
  return child;
}

test('cleanup is idempotent even when happy path and finally both close psql',async()=>{
  const child=fakePsqlChild();
  let ends=0;
  const end=child.stdin.end.bind(child.stdin);
  child.stdin.end=(...args)=>{ends++;return end(...args);};
  const worker=createDisposableEpochWorkerHandle(child);
  worker.send('SELECT 1;');
  const first=worker.close();
  const second=worker.close();
  assert.strictEqual(first,second,'double close must return the same promise');
  assert.equal(ends,1,'stdin.end must be called exactly once');
  assert.throws(()=>worker.send('ROLLBACK;'),/unavailable/i);
  child.emit('close',0);
  await first;
  assert.strictEqual(worker.close(),first);
  assert.equal(ends,1);
});

test('write-after-end stream error during intentional cleanup is handled',async()=>{
  const child=fakePsqlChild();
  const worker=createDisposableEpochWorkerHandle(child);
  const finished=worker.close();
  assert.doesNotThrow(()=>child.stdin.emit('error',Object.assign(
    new Error('write after end'),{code:'ERR_STREAM_WRITE_AFTER_END'},
  )));
  child.emit('close',0);
  await finished;
  // A successful psql close should not be converted into an unhandled
  // Node EventEmitter "error" after the printed database PASS.
  assert.equal(worker.close(),finished);
});

test('unexpected stream write failure rejects an in-flight psql marker wait',async()=>{
  const child=fakePsqlChild();
  const worker=createDisposableEpochWorkerHandle(child);
  const marker=worker.until('NEVER_FINISHED');
  child.stdin.emit('error',Object.assign(new Error('broken pipe'),{code:'EPIPE'}));
  await assert.rejects(marker,/input failed/);
  assert.throws(()=>worker.send('COMMIT;'),/unavailable/);
  const finished=worker.close();
  child.emit('close',0);
  await finished;
});

test('nonzero child exit after cleanup cannot be reported as a clean PASS',async()=>{
  const child=fakePsqlChild();
  const worker=createDisposableEpochWorkerHandle(child);
  const closing=worker.close();
  child.emit('close',1);
  await assert.rejects(closing,/closed abnormally/);
  await assert.rejects(worker.close(),/closed abnormally/);
});

test('smoke waits for child exit and never writes ROLLBACK after stdin.end',()=>{
  assert.match(src,/if\(closePromise\)return closePromise/);
  assert.match(src,/if\(closing\|\|exited\|\|streamFailed\|\|child\.stdin\.destroyed/);
  assert.match(src,/child\.stdin\.on\('error'/);
  assert.match(src,/if\(!child\.stdin\.destroyed&&!child\.stdin\.writableEnded\)child\.stdin\.end\(\)/);
  assert.match(src,/await Promise\.all\(\[first\.close\(\),second\.close\(\)\]\)/);
  assert.match(src,/for\(const worker of workers\)try\{await worker\.close\(\)/);
  assert.doesNotMatch(src,/child\.stdin\.write\('ROLLBACK;/);
});
