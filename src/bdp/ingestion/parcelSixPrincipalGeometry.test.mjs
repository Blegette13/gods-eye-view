import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createPrivateSixPrincipalGeometryDependencies} from
  '../../../server/providers/bdp-parcel-six-principal-geometry-dependencies.js';
import {SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL} from
  '../../../server/providers/bdp-parcel-sealed-source-authority-db.js';
import {PRIVATE_SEALED_SOURCE_AUTHORITY_SQL} from
  '../../../server/providers/bdp-parcel-sealed-source-authority.js';
import {GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL} from
  '../../../server/providers/bdp-parcel-geometry-publication-review-db.js';
import {PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL} from
  '../../../server/providers/bdp-parcel-geometry-publication-review.js';
import {SEALED_GEOMETRY_ROLE_ATTESTATION_SQL} from
  '../../../server/providers/bdp-parcel-sealed-geometry-rpc.js';
import {PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL} from
  '../../../server/providers/bdp-parcel-policy-epoch-db.js';
import {PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL} from
  '../../../server/providers/bdp-parcel-policy-epoch-reader.js';
import {PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL} from
  '../../../server/providers/bdp-parcel-current-sealed-run-epoch-db.js';
import {PRIVATE_CURRENT_SEALED_RUN_EPOCH_SQL} from
  '../../../server/providers/bdp-parcel-current-sealed-run-epoch.js';
import {PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL} from
  '../../../server/providers/bdp-parcel-session-county-epoch-db.js';
import {PRIVATE_SESSION_COUNTY_EPOCH_SQL} from
  '../../../server/providers/bdp-parcel-session-county-epoch.js';
import {PRIVATE_SEALED_INITIAL_RPC_SQL} from './parcelSealedInitialPagePlan.js';
import {PRIVATE_PARCEL_KEYSET_RPC_SQL} from './parcelKeysetPagination.js';

const NOW=1_000_000;
const LOGINS={
  source:'ldos_parcel_authority_test',
  review:'ldos_parcel_publication_test',
  geometry:'ldos_parcel_geometry_test',
  epoch:'ldos_parcel_epoch_test',
  run:'ldos_parcel_run_epoch_test',
  sessionEpoch:'ldos_parcel_session_epoch_test',
};
const SESSION_KEY=Buffer.alloc(32,0x21);
const CURSOR_KEY=Buffer.alloc(32,0x22);
const HANDLE=Buffer.alloc(32,0x23).toString('base64url');
const DIGEST=createHmac('sha256',SESSION_KEY).update(HANDLE,'utf8').digest('hex');
const DENIED={status:'unavailable',publishAuthorized:false,
  viewportCoverage:'unknown',geometryDelivered:false};
const ROLE_PROOF=['exact_login','safe_login','no_role_memberships',
  'schema_usage','no_schema_create','no_index_table_access',
  'no_index_sequence_access','fixed_rpc_execute','no_other_index_rpc'];
const GEO_PROOF=['same_principal','safe_principal','no_schema_create',
  'no_source_table','no_run_table','no_seal_table','no_parcel_table',
  'no_coverage_table','no_rights_table','sealed_initial_allowed',
  'sealed_keyset_allowed','unsealed_snapshot_denied','metadata_source_denied',
  'metadata_viewport_denied','sealed_authority_denied',
  'publication_review_denied','exact_login','safe_login',
  'no_role_memberships','schema_usage','no_index_table_access',
  'no_index_sequence_access','no_other_index_rpc'];
const proof=fields=>Object.fromEntries(fields.map(k=>[k,true]));
const SESSION_PROOF=['exact_login','safe_login','no_role_memberships',
  'schema_usage','no_schema_create','no_private_table_access',
  'no_private_sequence_access','fixed_rpc_execute','no_other_private_rpc'];
const goodSource=()=>({
  source_id:'travis-cad',county_fips:'48453',rights_state:'approved',
  approved_caching_until_ms:NOW+300_000,run_id:'42',
  source_version:'synthetic-v1',sealed_at_ms:NOW-5_000,
  indexed_records:'4',sealed_run:true,
});
const goodReview=()=>({
  source_id:'travis-cad',county_fips:'48453',review_state:'approved',
  allow_geometry_redistribution:true,review_reference:'synthetic/review-46',
  reviewed_at_ms:NOW-10_000,expires_at_ms:NOW+200_000,
});
const goodPolicy=()=>({
  source_id:'travis-cad',county_fips:'48453',
  source_cache_epoch:'11',publication_epoch:'17',
});
const goodRun=()=>({
  source_id:'travis-cad',county_fips:'48453',run_id:'42',epoch:'23',
});
const goodSessionEpoch=()=>({
  session_digest:DIGEST,county_fips:'48453',epoch:'3',
});
const goodSession=()=>({
  sessionDigest:DIGEST,subject:'synthetic-operator',accountStatus:'active',
  mfaVerified:true,revokedAtMs:null,issuedAtMs:NOW-100_000,
  lastSeenAtMs:NOW-1_000,expiresAtMs:NOW+300_000,
  countyGrants:[{countyFips:'48453',allowParcelDiscovery:true}],
});
const geo=()=>({
  type:'MultiPolygon',
  coordinates:[[[[-97.75,30.25],[-97.74,30.25],[-97.74,30.26],
    [-97.75,30.26],[-97.75,30.25]]]],
});
const row=(id,num,geom=geo())=>({
  parcel_version_id:num,source_parcel_id:id,
  source_version:'synthetic-v1',source_geometry_sha256:'b'.repeat(64),
  ingest_run_id:'42',source_id:'travis-cad',county_fips:'48453',
  geometry_vertices:5,geometry_memory_bytes:240,geometry:geom,
});
const page=()=>[row('P-001','1'),row('P-002','2'),row('P-003','3',null)];
const call=(extra={})=>({
  sessionHandle:HANDLE,
  request:{countyFips:'48453',
    bounds:{west:-97.76,south:30.24,east:-97.73,north:30.27},limit:2},
  cursorToken:null,signal:new AbortController().signal,...extra,
});

function setup({
  runRows=()=>[goodRun()],
  runRole=()=>proof(ROLE_PROOF),
  sourceRows=()=>[goodSource()],
  reviewRows=()=>[goodReview()],
  policyRows=()=>[goodPolicy()],
  geometryRows=()=>page(),
  sessionRows=()=>goodSession(),
  sessionEpochRows=()=>[goodSessionEpoch()],
  sessionEpochRole=()=>proof(SESSION_PROOF),
  quota=async()=>true,
}={}){
  const counts={sessions:0,sources:0,reviews:0,policies:0,
    runs:0,geometry:0,sessionEpochs:0,quota:0};
  const events=[];
  const connector=kind=>async()=>({
    async query(stmt){
      if(typeof stmt==='string'){events.push(kind+':'+stmt);return {rows:[]};}
      const a=kind==='source'&&stmt.text===SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL;
      const p=kind==='review'&&stmt.text===GEOMETRY_PUBLICATION_ROLE_ATTESTATION_SQL;
      const e=kind==='epoch'&&stmt.text===PRIVATE_POLICY_EPOCH_ROLE_ATTESTATION_SQL;
      const r=kind==='run'&&stmt.text===PRIVATE_CURRENT_RUN_EPOCH_ROLE_ATTESTATION_SQL;
      const g=kind==='geometry'&&stmt.text===SEALED_GEOMETRY_ROLE_ATTESTATION_SQL;
      const s=kind==='sessionEpoch'&&
        stmt.text===PRIVATE_SESSION_COUNTY_EPOCH_ROLE_ATTESTATION_SQL;
      if(a||p||e||r||g||s){
        assert.deepEqual(stmt.values,[LOGINS[kind]]);
        events.push(kind+':attest');
        return {rows:[s?sessionEpochRole():r?runRole():proof(g?GEO_PROOF:ROLE_PROOF)]};
      }
      if(kind==='source'&&stmt.text===PRIVATE_SEALED_SOURCE_AUTHORITY_SQL){
        assert.deepEqual(stmt.values,['48453']);
        counts.sources++;events.push('source:rpc');
        return {rows:await sourceRows(counts.sources)};
      }
      if(kind==='review'&&stmt.text===PRIVATE_GEOMETRY_PUBLICATION_REVIEW_SQL){
        assert.deepEqual(stmt.values,['48453','travis-cad']);
        counts.reviews++;events.push('review:rpc');
        return {rows:await reviewRows(counts.reviews)};
      }
      if(kind==='epoch'&&stmt.text===PRIVATE_POLICY_EPOCH_SNAPSHOT_SQL){
        assert.deepEqual(stmt.values,['48453','travis-cad']);
        counts.policies++;events.push('epoch:rpc');
        return {rows:await policyRows(counts.policies)};
      }
      if(kind==='sessionEpoch'&&stmt.text===PRIVATE_SESSION_COUNTY_EPOCH_SQL){
        assert.deepEqual(stmt.values,[DIGEST,'48453']);
        counts.sessionEpochs++;events.push('sessionEpoch:rpc');
        return {rows:await sessionEpochRows(counts.sessionEpochs)};
      }
      if(kind==='run'&&stmt.text===PRIVATE_CURRENT_SEALED_RUN_EPOCH_SQL){
        assert.deepEqual(stmt.values,['48453','travis-cad','42']);
        counts.runs++;events.push('run:rpc');
        return {rows:await runRows(counts.runs)};
      }
      if(kind==='geometry'&&[
        PRIVATE_SEALED_INITIAL_RPC_SQL,PRIVATE_PARCEL_KEYSET_RPC_SQL,
      ].includes(stmt.text)){
        counts.geometry++;events.push('geometry:rpc');
        return {rows:await geometryRows(counts.geometry,stmt)};
      }
      throw Error('Unexpected private SQL for '+kind);
    },
    release(err){events.push(kind+(err?':discard':':release'));},
  });
  const config={
    sessionHmacKey:SESSION_KEY,cursorHmacKey:CURSOR_KEY,
    findSessionByDigest:async()=>{
      counts.sessions++;events.push('session');
      return sessionRows(counts.sessions);
    },
    consumeQuota:async()=>{
      counts.quota++;events.push('quota');
      return quota(counts.quota);
    },
    connectSourceAuthority:connector('source'),sourceAuthorityLogin:LOGINS.source,
    connectPublicationReview:connector('review'),publicationReviewLogin:LOGINS.review,
    connectSealedGeometry:connector('geometry'),geometryLogin:LOGINS.geometry,
    connectPolicyEpoch:connector('epoch'),policyEpochLogin:LOGINS.epoch,
    connectRunEpoch:connector('run'),runEpochLogin:LOGINS.run,
    connectSessionEpoch:connector('sessionEpoch'),
    sessionEpochLogin:LOGINS.sessionEpoch,
    now:()=>NOW,
  };
  return {runtime:createPrivateSixPrincipalGeometryDependencies(config),
    config,counts,events};
}

test('48 strict five-principal factory refuses missing or unknown dependencies',()=>{
  assert.throws(()=>createPrivateSixPrincipalGeometryDependencies(),TypeError);
  const {config}=setup();
  for(const key of [
    'connectSourceAuthority','connectPublicationReview','connectSealedGeometry',
    'connectPolicyEpoch','connectRunEpoch','runEpochLogin',
    'connectSessionEpoch','sessionEpochLogin',
  ]){
    const copy={...config};delete copy[key];
    assert.throws(()=>createPrivateSixPrincipalGeometryDependencies(copy),TypeError);
  }
  assert.throws(()=>createPrivateSixPrincipalGeometryDependencies({
    ...config,readSealedRunEpoch:async()=>goodRun(),
  }),TypeError,'Run epoch must come only from fixed SQL');
  assert.throws(()=>createPrivateSixPrincipalGeometryDependencies({
    ...config,readSessionCountyEpoch:async()=>goodSessionEpoch(),
  }),TypeError,'Session epoch must come only from fixed SQL');
  assert.throws(()=>createPrivateSixPrincipalGeometryDependencies({
    ...config,allowPublicGeometry:true,
  }),TypeError);
});

test('48 five SQL connections must be distinct and no account can be reused',()=>{
  const {config}=setup();
  const keys=['connectSourceAuthority','connectPublicationReview',
    'connectSealedGeometry','connectPolicyEpoch','connectRunEpoch',
    'connectSessionEpoch'];
  for(let i=0;i<keys.length;i++)for(let j=0;j<i;j++){
    assert.throws(()=>createPrivateSixPrincipalGeometryDependencies({
      ...config,[keys[i]]:config[keys[j]],
    }),TypeError);
  }
  assert.throws(()=>createPrivateSixPrincipalGeometryDependencies({
    ...config,runEpochLogin:config.policyEpochLogin,
  }),TypeError);
  assert.throws(()=>createPrivateSixPrincipalGeometryDependencies({
    ...config,sessionEpochLogin:config.runEpochLogin,
  }),TypeError);
  assert.throws(()=>createPrivateSixPrincipalGeometryDependencies({
    ...config,runEpochLogin:'postgres',
  }),TypeError);
});

test('48 valid private page attests five SQL principals twice and returns no polygons',async()=>{
  const ctx=setup();
  const result=await ctx.runtime.readPrivatePage(call());
  assert.equal(result.status,'validated-private');
  assert.equal(result.featureCount,2);
  assert.equal(result.publishAuthorized,false);
  assert.equal(result.geometryDelivered,false);
  assert.equal(result.viewportCoverage,'unknown');
  assert.equal(typeof result.nextPrivateCursor,'string');
  assert.deepEqual(ctx.counts,{
    sessions:2,sources:2,reviews:2,policies:2,runs:2,
    geometry:1,sessionEpochs:2,quota:1,
  });
  for(const kind of ['source','review','epoch','run','geometry','sessionEpoch'])
    assert.ok(ctx.events.includes(kind+':attest'));
  assert.deepEqual(Object.keys(ctx.runtime),['readPrivatePage']);
  for(const value of ['coordinates','travis-cad',HANDLE,DIGEST,
    'source_cache_epoch','publication_epoch','run_id','epoch'])
    assert.ok(!JSON.stringify(result).includes(value),value);
});

test('48 current run deleted after private SQL read fails second attested proof',async()=>{
  const ctx=setup({runRows:n=>n===1?[goodRun()]:[]});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
  assert.equal(ctx.counts.geometry,1);
  assert.equal(ctx.counts.runs,2);
});

test('48 run epoch ABA change after geometry query invalidates output',async()=>{
  const ctx=setup({runRows:n=>[n===1?goodRun():{
    ...goodRun(),epoch:'25',
  }]});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
  assert.equal(ctx.counts.geometry,1);
});

test('48 stale unsealed run ID cannot pass before geometry SQL',async()=>{
  const ctx=setup({runRows:()=>[{...goodRun(),run_id:'43'}]});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
  assert.equal(ctx.counts.runs,1);
  assert.equal(ctx.counts.geometry,0);
});

test('48 missing, ambiguous, forged or malformed current-run evidence is denied',async()=>{
  for(const rows of [
    [],[goodRun(),goodRun()],
    [{...goodRun(),source_id:'other-source'}],
    [{...goodRun(),county_fips:'48029'}],
    [{...goodRun(),epoch:'0'}],
    [{...goodRun(),epoch:'9223372036854775808'}],
    [{...goodRun(),extra:true}],
  ]){
    const ctx=setup({runRows:()=>rows});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
    assert.equal(ctx.counts.geometry,0);
  }
});

test('48 extra run-epoch table SELECT or SQL privilege drift denies before geometry',async()=>{
  for(const role of [
    {...proof(ROLE_PROOF),no_index_table_access:false},
    {...proof(ROLE_PROOF),no_other_index_rpc:false},
    {...proof(ROLE_PROOF),exact_login:false},
    {...proof(ROLE_PROOF),fixed_rpc_execute:false},
    {...proof(ROLE_PROOF),extra:true},
  ]){
    const ctx=setup({runRole:()=>role});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
    assert.equal(ctx.counts.runs,0);
    assert.equal(ctx.counts.geometry,0);
    assert.ok(ctx.events.includes('run:discard'));
  }
});

test('48 stale signed private keyset cursor denies after run-selection epoch changes',async()=>{
  const ctx=setup({
    runRows:n=>[n<3?goodRun():{...goodRun(),epoch:'24'}],
  });
  const first=await ctx.runtime.readPrivatePage(call());
  assert.equal(first.status,'validated-private');
  const second=await ctx.runtime.readPrivatePage(call({
    cursorToken:first.nextPrivateCursor,
  }));
  assert.deepEqual(second,DENIED);
  assert.equal(ctx.counts.geometry,1,'No keyset SQL executed on a stale cursor');
});

test('48 stable current run epoch allows the next signed private page',async()=>{
  const ctx=setup({geometryRows:(_,stmt)=>{
    if(stmt.text===PRIVATE_SEALED_INITIAL_RPC_SQL)return page();
    assert.equal(stmt.text,PRIVATE_PARCEL_KEYSET_RPC_SQL);
    assert.deepEqual(stmt.values.slice(-2),['P-002','2']);
    return [row('P-003','3'),row('P-004','4')];
  }});
  const first=await ctx.runtime.readPrivatePage(call());
  assert.equal(first.status,'validated-private');
  const second=await ctx.runtime.readPrivatePage(call({
    cursorToken:first.nextPrivateCursor,
  }));
  assert.equal(second.status,'validated-private');
  assert.equal(second.featureCount,2);
  assert.equal(second.nextPrivateCursor,null);
  assert.equal(ctx.counts.runs,4);
  assert.equal(ctx.counts.geometry,2);
});

test('48 invalid review/rights and account revocation preempt run epoch geometry',async()=>{
  const revokedReview=setup({reviewRows:()=>[{
    ...goodReview(),review_state:'revoked',
  }]});
  assert.deepEqual(await revokedReview.runtime.readPrivatePage(call()),DENIED);
  assert.equal(revokedReview.counts.runs,0);
  assert.equal(revokedReview.counts.geometry,0);
  const revokedSession=setup({sessionRows:()=>({
    ...goodSession(),revokedAtMs:NOW-1,
  })});
  assert.deepEqual(await revokedSession.runtime.readPrivatePage(call()),DENIED);
  assert.equal(revokedSession.counts.runs,0);
});

test('48 missing session epoch or denied quota never becomes run authorization',async()=>{
  const missingEpoch=setup({sessionEpochRows:()=>[]});
  assert.deepEqual(await missingEpoch.runtime.readPrivatePage(call()),DENIED);
  assert.equal(missingEpoch.counts.runs,0);
  const quotaDenied=setup({quota:async()=>false});
  assert.deepEqual(await quotaDenied.runtime.readPrivatePage(call()),DENIED);
  assert.equal(quotaDenied.counts.geometry,0);
});

test('48 cancelled request does not contact SQL or return credentials',async()=>{
  const ctx=setup();
  const abort=new AbortController();abort.abort();
  const result=await ctx.runtime.readPrivatePage(call({
    signal:abort.signal,
  }));
  assert.equal(result.status,'cancelled');
  assert.equal(ctx.counts.runs,0);
  assert.equal(ctx.counts.geometry,0);
});

test('48 private-only source never mounts HTTP, creates pools or publishes polygons',()=>{
  const file=readFileSync(new URL(
    '../../../server/providers/bdp-parcel-six-principal-geometry-dependencies.js',
    import.meta.url),'utf8');
  assert.match(file,/UNROUTED/);
  assert.match(file,/NOT real authentication/);
  assert.match(file,/not an atomic response release gate/i);
  assert.doesNotMatch(file,/new Pool\(|createServer\(|app\.get\(|\.listen\(/);
  assert.doesNotMatch(file,/ST_AsGeoJSON|GRANT EXECUTE|CREATE ROLE/);
});

test('48 missing or multiple synthetic session/county epoch rows fail before geometry',async()=>{
  for(const rows of [[],[goodSessionEpoch(),goodSessionEpoch()]]) {
    const ctx=setup({sessionEpochRows:()=>rows});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
    assert.equal(ctx.counts.geometry,0);
    assert.equal(ctx.counts.runs,0);
  }
});

test('48 synthetic session/county epoch wrong digest, county or overflow fails closed',async()=>{
  for(const bad of [
    {...goodSessionEpoch(),session_digest:'e'.repeat(64)},
    {...goodSessionEpoch(),county_fips:'48029'},
    {...goodSessionEpoch(),epoch:'0'},
    {...goodSessionEpoch(),epoch:'9223372036854775808'},
    {...goodSessionEpoch(),unverified:true},
  ]){
    const ctx=setup({sessionEpochRows:()=>[bad]});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
    assert.equal(ctx.counts.geometry,0);
  }
});

test('48 session epoch SQL privilege drift denies before run and geometry',async()=>{
  for(const proofRow of [
    {...proof(SESSION_PROOF),no_private_table_access:false},
    {...proof(SESSION_PROOF),no_other_private_rpc:false},
    {...proof(SESSION_PROOF),exact_login:false},
    {...proof(SESSION_PROOF),fixed_rpc_execute:false},
    {...proof(SESSION_PROOF),unexpected:'grant'},
  ]){
    const ctx=setup({sessionEpochRole:()=>proofRow});
    assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
    assert.equal(ctx.counts.geometry,0);
    assert.equal(ctx.counts.sessionEpochs,0);
    assert.ok(ctx.events.includes('sessionEpoch:discard'));
  }
});

test('48 session grant version ABA changes after geometry invalidate the private result',async()=>{
  const ctx=setup({sessionEpochRows:n=>[{
    ...goodSessionEpoch(),epoch:n===1?'3':'5',
  }]});
  assert.deepEqual(await ctx.runtime.readPrivatePage(call()),DENIED);
  assert.equal(ctx.counts.geometry,1);
  assert.equal(ctx.counts.sessionEpochs,2);
});

test('48 stale signed keyset cursor is denied before geometry on grant epoch change',async()=>{
  const ctx=setup({sessionEpochRows:n=>[{
    ...goodSessionEpoch(),epoch:n<=2?'3':'6',
  }]});
  const first=await ctx.runtime.readPrivatePage(call());
  assert.equal(first.status,'validated-private');
  const second=await ctx.runtime.readPrivatePage(call({
    cursorToken:first.nextPrivateCursor,
  }));
  assert.deepEqual(second,DENIED);
  assert.equal(ctx.counts.geometry,1,'No stale keyset geometry SQL');
});

test('48 six SQL principal integration remains synthetic and unrouted',()=>{
  const source=readFileSync(new URL(
    '../../../server/providers/bdp-parcel-six-principal-geometry-dependencies.js',
    import.meta.url),'utf8');
  assert.match(source,/SIX independently attested SQL principals/);
  assert.match(source,/NOT an account issuer/);
  assert.match(source,/not production-ready/);
  assert.match(source,/createPinnedPrivateSessionCountyEpochRpcExecutor/);
  assert.match(source,/createPrivateFivePrincipalGeometryDependencies/);
  assert.doesNotMatch(source,/new Pool\\(|createServer\\(|app\\.get\\(|\\.listen\\(/);
  assert.doesNotMatch(source,/GRANT EXECUTE|CREATE ROLE|ST_AsGeoJSON/);
});
