import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createTrustedParcelCountySessionVerifier } from '../../../server/providers/bdp-parcel-county-session.js';
import { createAuthorizedParcelSourceResolver } from '../../../server/providers/bdp-parcel-source-resolver.js';
import { createPrivateParcelGeometryService } from '../../../server/providers/bdp-parcel-private-geometry-service.js';

const NOW = 1_000_000;
const handle = randomBytes(32).toString('base64url');
const request = () => ({
  countyFips: '48453',
  bounds: { west: -97.76, south: 30.24, east: -97.73, north: 30.27 },
  limit: 2,
});
const source = () => ({
  sourceId: 'travis-cad', countyFips: '48453', rightsState: 'approved',
  approvedCachingUntilMs: NOW + 400_000, runId: 42,
});
const publication = () => ({
  sourceId: 'travis-cad', countyFips: '48453', reviewState: 'approved',
  allowGeometryRedistribution: true, reviewReference: 'synthetic/review-001',
  reviewedAtMs: NOW - 20_000, expiresAtMs: NOW + 250_000,
});
const polygon = () => ({
  type: 'MultiPolygon',
  coordinates: [[[[-97.75, 30.25], [-97.74, 30.25],
    [-97.74, 30.26], [-97.75, 30.26], [-97.75, 30.25]]]],
});
const row = (id = 'SYNTHETIC-001', geometry = polygon()) => ({
  parcel_version_id: '1', source_parcel_id: id, source_version: 'v1',
  source_geometry_sha256: 'a'.repeat(64), ingest_run_id: '42',
  source_id: 'travis-cad', county_fips: '48453',
  geometry_vertices: 5, geometry_memory_bytes: 240, geometry,
});
const SUCCESS = { status: 'validated-private', viewportCoverage: 'unknown',
  publishAuthorized: false };
const denied = { status: 'denied', viewportCoverage: 'unknown', publishAuthorized: false };
const unavailable = { status: 'unavailable', viewportCoverage: 'unknown', publishAuthorized: false };
const busy = { status: 'busy', viewportCoverage: 'unknown', publishAuthorized: false };
const cancelled = { status: 'cancelled', viewportCoverage: 'unknown', publishAuthorized: false };

function setup({
  resolve = async () => source(),
  review = async () => publication(),
  read = async () => ({ rows: [row()], publishAuthorized: false, viewportCoverage: 'unknown' }),
  quota = async () => true, clock = () => NOW, maxConcurrent = 2,
} = {}) {
  const calls = { quota: 0, resolve: 0, review: 0, read: 0 };
  const service = createPrivateParcelGeometryService({
    now: clock, maxConcurrent,
    resolveAuthorizedSource: async (context) => { calls.resolve++; return resolve(context); },
    readPublicationReview: async (context) => { calls.review++; return review(context); },
    readSnapshot: async (context, opts) => { calls.read++; return read(context, opts); },
    consumeQuota: async (context) => { calls.quota++; return quota(context); },
  });
  return { calls, service };
}
const invoke = (service, options = {}) => service({
  sessionHandle: handle, request: request(), ...options,
});

test('service constructor requires separate trusted session, rights, geometry and quota dependencies', () => {
  assert.throws(() => createPrivateParcelGeometryService(), TypeError);
  assert.throws(() => createPrivateParcelGeometryService({
    resolveAuthorizedSource: async () => source(),
    readSnapshot: async () => ({}), consumeQuota: async () => true,
  }), TypeError);
  assert.throws(() => createPrivateParcelGeometryService({
    resolveAuthorizedSource: async () => source(),
    readPublicationReview: async () => publication(),
    readSnapshot: async () => ({}), consumeQuota: async () => true,
    maxConcurrent: 200,
  }), TypeError);
});

test('private success uses independently reviewed rights before and after query and never authorizes publication', async () => {
  const { service, calls } = setup({
    resolve: async (ctx) => {
      assert.equal(ctx.sessionHandle, handle);
      assert.equal(ctx.countyFips, '48453');
      return source();
    },
    review: async (ctx) => {
      assert.deepEqual(Object.keys(ctx), ['sourceId', 'countyFips', 'signal']);
      assert.equal(ctx.sourceId, 'travis-cad');
      return publication();
    },
    read: async (ctx, options) => {
      assert.equal(ctx.trustedSourceId, 'travis-cad');
      assert.equal(ctx.trustedRunId, 42);
      assert.equal(ctx.plan.probeLimit, 3);
      assert.equal(options.statementTimeoutMs, 1000);
      return { rows: [row()], publishAuthorized: false, viewportCoverage: 'unknown' };
    },
  });
  const result = await invoke(service);
  assert.equal(result.status, SUCCESS.status);
  assert.equal(result.publishAuthorized, false);
  assert.equal(result.viewportCoverage, 'unknown');
  assert.equal(result.featureCount, 1);
  assert.equal(result.overflow, false);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(calls, { quota: 1, resolve: 2, review: 2, read: 1 });
  assert.deepEqual(JSON.parse(result.privateCandidateGeoJson).features[0].properties,
    { sourceParcelId: 'SYNTHETIC-001' });
  // Accidental serialization of this internal status must NOT expose polygons.
  assert.equal(Object.keys(result).includes('privateCandidateGeoJson'), false);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC-001'), false);
});

test('unauthorized requests, invalid handles and browser-injected source IDs never query', async () => {
  const { service, calls } = setup();
  assert.deepEqual(await invoke(service, {
    request: { ...request(), sourceId: 'travis-cad' },
  }), { status: 'invalid-request', viewportCoverage: 'unknown', publishAuthorized: false });
  assert.deepEqual(await invoke(service, { sessionHandle: 'admin-cookie' }), denied);
  assert.deepEqual(await invoke(service, { request: {
    ...request(), bounds: { ...request().bounds, east: -97.1 },
  } }), { status: 'invalid-request', viewportCoverage: 'unknown', publishAuthorized: false });
  assert.deepEqual(calls, { quota: 0, resolve: 0, review: 0, read: 0 });
});

test('real distributed quota must approve before any resolver or geometry read', async () => {
  const { service, calls } = setup({ quota: async () => false });
  assert.deepEqual(await invoke(service), busy);
  assert.deepEqual(calls, { quota: 1, resolve: 0, review: 0, read: 0 });
});

test('unapproved, expired or missing independent redistribution rights deny before query', async () => {
  for (const rights of [
    null, { ...publication(), reviewState: 'unreviewed' },
    { ...publication(), allowGeometryRedistribution: false },
    { ...publication(), expiresAtMs: NOW },
    { ...publication(), countyFips: '48029' },
  ]) {
    const { service, calls } = setup({ review: async () => rights });
    assert.deepEqual(await invoke(service), denied);
    assert.equal(calls.read, 0);
  }
});

test('revoked session, rotated run or renewed policy AFTER SQL all deny private output', async () => {
  for (const scenario of [
    { resolve: (n) => n === 1 ? source() : null },
    { resolve: (n) => n === 1 ? source() : { ...source(), runId: 43 } },
    { review: (n) => n === 1 ? publication() : { ...publication(), reviewReference: 'synthetic/review-002' } },
    { review: (n) => n === 1 ? publication() : { ...publication(), allowGeometryRedistribution: false } },
  ]) {
    let resolves = 0, reviews = 0;
    const { service, calls } = setup({
      resolve: async () => scenario.resolve ? scenario.resolve(++resolves) : source(),
      review: async () => scenario.review ? scenario.review(++reviews) : publication(),
    });
    assert.deepEqual(await invoke(service), denied);
    assert.equal(calls.read, 1);
  }
});

test('source rights can expire while in flight without private data escaping', async () => {
  let current = NOW;
  const { service, calls } = setup({
    clock: () => current,
    read: async () => {
      current = NOW + 400_000;
      return { rows: [row()], publishAuthorized: false, viewportCoverage: 'unknown' };
    },
  });
  assert.deepEqual(await invoke(service), denied);
  assert.equal(calls.read, 1);
});

test('empty pages and +1 overflow never imply complete coverage', async () => {
  const zero = setup({ read: async () => ({
    rows: [], viewportCoverage: 'unknown', publishAuthorized: false,
  }) });
  const empty = await invoke(zero.service);
  assert.equal(empty.status, 'validated-private');
  assert.equal(empty.featureCount, 0);
  assert.equal(empty.viewportCoverage, 'unknown');

  const overflow = setup({ read: async () => ({
    rows: [row('001'), row('002'), row('003', null)],
    viewportCoverage: 'unknown', publishAuthorized: false,
  }) });
  const answer = await invoke(overflow.service);
  assert.equal(answer.status, 'validated-private');
  assert.equal(answer.overflow, true);
  assert.equal(answer.featureCount, 2);
  assert.ok(!answer.privateCandidateGeoJson.includes('003'));
  assert.equal(answer.publishAuthorized, false);
});

test('malformed, oversized or publication-claiming DB results are unavailable', async () => {
  for (const result of [
    null,
    { rows: [row()], publishAuthorized: true, viewportCoverage: 'unknown' },
    { rows: [row()], publishAuthorized: false, viewportCoverage: 'complete' },
    { rows: [row('001'), row('002'), row('003'), row('004')], publishAuthorized: false, viewportCoverage: 'unknown' },
    { rows: [{ ...row(), geometry: { type: 'Point', coordinates: [-97.7,30.2] } }], publishAuthorized: false, viewportCoverage: 'unknown' },
  ]) {
    const { service } = setup({ read: async () => result });
    assert.deepEqual(await invoke(service), unavailable);
  }
});

test('failed injected dependencies and cancellation are generic and fail closed', async () => {
  const failure = setup({ read: async () => { throw new Error('private SQL credentials'); } });
  assert.deepEqual(await invoke(failure.service), unavailable);
  const abort = new AbortController(); abort.abort();
  const f = setup();
  assert.deepEqual(await invoke(f.service, { signal: abort.signal }), cancelled);
  assert.deepEqual(f.calls, { quota: 0, resolve: 0, review: 0, read: 0 });
  const delayed = new AbortController();
  const after = setup({ read: async () => {
    delayed.abort();
    return { rows: [row()], viewportCoverage: 'unknown', publishAuthorized: false };
  } });
  assert.deepEqual(await invoke(after.service, { signal: delayed.signal }), cancelled);
  assert.equal(after.calls.read, 1);
});

test('in-process concurrency limit also rejects extra live requests before database work', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { service, calls } = setup({
    maxConcurrent: 1, read: async () => {
      await gate;
      return { rows: [row()], viewportCoverage: 'unknown', publishAuthorized: false };
    },
  });
  const first = service({ sessionHandle: handle, request: request() });
  // Let promise-based quota, source and rights lookups complete.
  for (let i = 0; i < 10 && calls.read === 0; i++) await Promise.resolve();
  assert.equal(calls.read, 1);
  assert.deepEqual(await invoke(service), busy);
  assert.equal(calls.read, 1);
  release();
  assert.equal((await first).status, 'validated-private');
});

test('real HMAC county verifier and approved-source resolver are rechecked after the private query', async () => {
  const key = randomBytes(48);
  const signedHandle = randomBytes(32).toString('base64url');
  const digest = createHmac('sha256', key).update(signedHandle).digest('hex');
  let revoked = false;
  let sessionLookups = 0;
  let sourceReads = 0;
  let geometryReads = 0;
  const verifier = createTrustedParcelCountySessionVerifier({
    sessionHmacKey: key, now: () => NOW,
    findSessionByDigest: async (lookup) => {
      sessionLookups++;
      assert.equal(lookup, digest);
      return {
        sessionDigest: digest, subject: 'fixture-subject', accountStatus: 'active',
        mfaVerified: true, revokedAtMs: revoked ? NOW : null,
        issuedAtMs: NOW - 20_000, lastSeenAtMs: NOW - 1000,
        expiresAtMs: NOW + 100_000,
        countyGrants: [{ countyFips: '48453', allowParcelDiscovery: true }],
      };
    },
  });
  const resolver = createAuthorizedParcelSourceResolver({
    verifyCountySession: verifier, now: () => NOW,
    readApprovedSources: async () => {
      sourceReads++;
      return { rows: [{
        source_id: 'travis-cad', county_fips: '48453', rights_state: 'approved',
        approved_caching_until_ms: NOW + 400_000, run_id: '42',
      }] };
    },
  });
  const service = createPrivateParcelGeometryService({
    resolveAuthorizedSource: resolver,
    readPublicationReview: async () => publication(),
    consumeQuota: async () => true,
    readSnapshot: async () => {
      geometryReads++;
      revoked = true; // Simulates logout during an in-flight query.
      return { rows: [row()], viewportCoverage: 'unknown', publishAuthorized: false };
    },
    now: () => NOW,
  });
  assert.deepEqual(await service({
    sessionHandle: signedHandle, request: request(),
  }), denied);
  assert.equal(geometryReads, 1);
  assert.equal(sessionLookups, 2);
  assert.equal(sourceReads, 1, 'revoked session must deny before source registry re-read');
});
