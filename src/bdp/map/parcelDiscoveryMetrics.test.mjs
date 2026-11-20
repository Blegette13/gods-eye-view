import test from 'node:test';
import assert from 'node:assert/strict';
import { createParcelDiscoveryMetrics } from './parcelDiscoveryMetrics.js';

test('diagnostics count completed GIS calls and duration but never capture parcel details',()=>{
  let tick=100;
  const metrics=createParcelDiscoveryMetrics({now:()=>tick});
  const run=metrics.start();
  tick=129;
  assert.equal(run.finish({
    outcome:'success',sourceRequests:5,parcelCount:408,
    sourceFootprints:2,cachedWindows:3,entityCount:816,
    parcelId:'SECRET-123',coordinates:[-97.7,30.3],owner:'PERSON',
  }),true);
  assert.equal(run.finish({outcome:'error'}),false,'each request must be counted once');
  const stats=metrics.snapshot();
  assert.equal(stats.runs,1);
  assert.equal(stats.successes,1);
  assert.equal(stats.knownSourceRequests,5);
  assert.equal(stats.unknownRequestRuns,0);
  assert.equal(stats.last.durationMs,29);
  assert.equal(stats.last.parcelCount,408);
  assert.equal(stats.last.entityCount,816);
  assert.equal(stats.p95DurationMs,29);
  assert.ok(Object.isFrozen(stats) && Object.isFrozen(stats.last));
  assert.doesNotMatch(JSON.stringify(stats),/SECRET|PERSON|coordinates|owner|parcelId/);
});

test('cache hit represents ZERO network calls, not an unknown source request',()=>{
  const metrics=createParcelDiscoveryMetrics({now:()=>0});
  metrics.start().finish({outcome:'success',fromCache:true,sourceRequests:0,parcelCount:111});
  const stats=metrics.snapshot();
  assert.equal(stats.cacheHits,1);
  assert.equal(stats.knownSourceRequests,0);
  assert.equal(stats.unknownRequestRuns,0);
});

test('unreported source request counts remain UNKNOWN, never guessed as one',()=>{
  const metrics=createParcelDiscoveryMetrics();
  metrics.start().finish({outcome:'over-limit',sourceRequests:null});
  metrics.start().finish({outcome:'error'});
  metrics.start().finish({outcome:'cancelled'});
  const stats=metrics.snapshot();
  assert.equal(stats.runs,3);
  assert.equal(stats.unknownRequestRuns,3);
  assert.equal(stats.knownSourceRequests,0);
  assert.equal(stats.capped,1);
  assert.equal(stats.failures,1);
  assert.equal(stats.cancellations,1);
});

test('bounded samples and percentile diagnostics exclude unbounded per-property history',()=>{
  let tick=0;
  const metrics=createParcelDiscoveryMetrics({now:()=>tick,maxSamples:3});
  for(const duration of [10,20,30,40]){
    const handle=metrics.start();
    tick+=duration;
    handle.finish({sourceRequests:1});
  }
  const stats=metrics.snapshot();
  assert.equal(stats.runs,4);
  assert.equal(stats.sampleCount,3);
  assert.equal(stats.knownSourceRequests,4);
  assert.equal(stats.p50DurationMs,30);
  assert.equal(stats.p95DurationMs,40);
});

test('negative, invalid and excessive values cannot corrupt aggregate diagnostics',()=>{
  assert.throws(()=>createParcelDiscoveryMetrics({maxSamples:0}),/Invalid/);
  const metrics=createParcelDiscoveryMetrics({now:()=>NaN});
  assert.throws(()=>metrics.start().finish({outcome:'invented'}),/Invalid/);
  const run=metrics.start();
  run.finish({sourceRequests:-1,parcelCount:Infinity,cachedWindows:-2,entityCount:NaN});
  const stats=metrics.snapshot();
  assert.equal(stats.unknownRequestRuns,1);
  assert.equal(stats.last.parcelCount,0);
  assert.equal(stats.last.cachedWindows,0);
  assert.equal(stats.last.entityCount,null);
  assert.equal(stats.last.durationMs,null);
  assert.equal(stats.p50DurationMs,null);
});

test('metrics are session-local and snapshots never mutate after future updates',()=>{
  const metrics=createParcelDiscoveryMetrics();
  metrics.start().finish({outcome:'success',sourceRequests:1});
  const first=metrics.snapshot();
  metrics.start().finish({outcome:'error',sourceRequests:2});
  assert.equal(first.runs,1);
  assert.equal(metrics.snapshot().runs,2);
});
