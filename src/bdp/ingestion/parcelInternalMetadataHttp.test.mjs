import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  createInternalParcelMetadataHandler,
  INTERNAL_PARCEL_METADATA_PATH,
  INTERNAL_PARCEL_METADATA_MAX_BODY_BYTES,
} from '../../../server/providers/bdp-parcel-internal-metadata-http.js';

const ORIGIN = 'http://127.0.0.1:19001';
const handle = randomBytes(32).toString('base64url');
const request = () => ({
  countyFips: '48453',
  bounds: { west: -97.75, south: 30.25, east: -97.74, north: 30.26 },
  limit: 10,
});
const good = () => ({
  status: 'ok', parcelCount: 1, overflow: false,
  viewportCoverage: 'unknown', geometryDelivered: false,
});
function setup({
  session = async (req) => req.headers.cookie === 'ldos=' + handle ? handle : null,
  quota = async () => true,
  read = async () => good(),
  expectedOrigin = ORIGIN,
} = {}) {
  const calls = { session: 0, quota: 0, read: 0 };
  const handler = createInternalParcelMetadataHandler({
    expectedOrigin,
    readOpaqueSession: async (...args) => { calls.session++; return session(...args); },
    consumeQuota: async (...args) => { calls.quota++; return quota(...args); },
    readViewportMetadata: async (...args) => { calls.read++; return read(...args); },
  });
  return { handler, calls };
}
async function send(handler, { method = 'POST', origin = ORIGIN,
  path = INTERNAL_PARCEL_METADATA_PATH, cookie = 'ldos=' + handle,
  body = request(), headers = {},
} = {}) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => { res.statusCode = 500; res.end(); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const httpHeaders = { 'content-type': 'application/json', origin,
      'sec-fetch-site': 'same-origin', cookie, ...headers };
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
      method, headers: httpHeaders, ...(method === 'POST'
        ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      headers: response.headers,
      data: await response.json(),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('handler requires a reviewed origin and all three trusted dependencies', () => {
  const deps = { readOpaqueSession: () => handle,
    consumeQuota: () => true, readViewportMetadata: () => good() };
  for (const expectedOrigin of [
    undefined, 'https://app.example.com/path', 'https://user:pass@app.example.com',
    'http://app.example.com', 'https://app.example.com/', 'null',
  ]) {
    assert.throws(() => createInternalParcelMetadataHandler({
      ...deps, expectedOrigin,
    }), TypeError);
  }
  assert.throws(() => createInternalParcelMetadataHandler({
    expectedOrigin: ORIGIN, readViewportMetadata: () => good(),
  }), TypeError);
  assert.equal(INTERNAL_PARCEL_METADATA_MAX_BODY_BYTES, 1024);
});

test('real loopback HTTP request returns bounded metadata and privacy headers only', async () => {
  const { handler, calls } = setup({
    session: async (req) => {
      assert.equal(req.headers.cookie, 'ldos=' + handle);
      return handle;
    },
    quota: async (ctx) => {
      assert.equal(ctx.sessionHandle, handle);
      assert.equal(ctx.countyFips, '48453');
      assert.ok(ctx.signal instanceof AbortSignal);
      return true;
    },
    read: async (args) => {
      assert.equal(args.sessionHandle, handle);
      assert.deepEqual(args.request, request());
      return { ...good(), sourceParcelId: 'PRIVATE-ID',
        ownerName: 'NEVER LEAK', sql: 'PRIVATE SQL', session: handle };
    },
  });
  const result = await send(handler);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, good());
  assert.deepEqual(calls, { session: 1, quota: 1, read: 1 });
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(result.headers.get('access-control-allow-origin'), null);
  assert.ok(!JSON.stringify(result.data).includes('PRIVATE'));
});

test('wrong path, method, query and cross-origin requests fail before touching session store', async () => {
  const { handler, calls } = setup();
  for (const options of [
    { path: '/public/parcel/viewport-metadata' },
    { path: INTERNAL_PARCEL_METADATA_PATH + '?debug=1' },
    { method: 'GET' },
    { origin: 'https://evil.example.com' },
    { headers: { 'sec-fetch-site': 'cross-site' } },
  ]) {
    const r = await send(handler, options);
    assert.ok([400, 403].includes(r.status));
    assert.equal(r.data.viewportCoverage, 'unknown');
  }
  assert.deepEqual(calls, { session: 0, quota: 0, read: 0 });
});

test('refuses invalid, oversized or extra-authority JSON before cookie handling', async () => {
  const { handler, calls } = setup();
  for (const body of [
    '{bad JSON', '{}', '{"countyFips":"48453","role":"admin"}',
    { ...request(), sourceId: 'unapproved-cad' },
    { ...request(), sessionHandle: handle },
    { ...request(), bounds: { ...request().bounds, east: -97.4 } },
    ' '.repeat(INTERNAL_PARCEL_METADATA_MAX_BODY_BYTES + 1),
  ]) {
    const response = await send(handler, { body });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { status: 'invalid-request', viewportCoverage: 'unknown' });
  }
  assert.deepEqual(calls, { session: 0, quota: 0, read: 0 });
});

test('missing or forged cookie denies before distributed quota and metadata reads', async () => {
  const { handler, calls } = setup();
  for (const cookie of ['', 'ldos=admin', 'x-role=admin']) {
    const r = await send(handler, { cookie });
    assert.equal(r.status, 403);
    assert.deepEqual(r.data, { status: 'denied', viewportCoverage: 'unknown' });
  }
  assert.deepEqual(calls, { session: 3, quota: 0, read: 0 });
});

test('fail-closed distributed quota denies work with 429 and no-cache', async () => {
  const { handler, calls } = setup({ quota: async () => false });
  const r = await send(handler);
  assert.equal(r.status, 429);
  assert.deepEqual(r.data, { status: 'busy', viewportCoverage: 'unknown' });
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(calls, { session: 1, quota: 1, read: 0 });
});

test('quota errors fail closed with generic unavailable instead of leaking internals', async () => {
  const { handler, calls } = setup({ quota: async () => {
    throw Error('PRIVATE RATE-LIMIT DATABASE DETAILS');
  } });
  const r = await send(handler);
  assert.equal(r.status, 503);
  assert.deepEqual(r.data, { status: 'unavailable', viewportCoverage: 'unknown' });
  assert.deepEqual(calls, { session: 1, quota: 1, read: 0 });
});

test('partial-page remains explicitly unknown; invalid service shape becomes unavailable', async () => {
  const partial = setup({ read: async () => ({
    status: 'partial-page', parcelCount: 10, overflow: true,
    viewportCoverage: 'unknown', geometryDelivered: false,
    details: 'NO',
  }) });
  const result = await send(partial.handler);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, {
    status: 'partial-page', parcelCount: 10, overflow: true,
    viewportCoverage: 'unknown', geometryDelivered: false,
  });
  const malformed = setup({ read: async () => ({
    status: 'ok', parcelCount: 100000, overflow: false,
    viewportCoverage: 'complete', geometryDelivered: true,
  }) });
  const invalidResult = await send(malformed.handler);
  assert.equal(invalidResult.status, 503);
  assert.deepEqual(invalidResult.data, { status: 'unavailable', viewportCoverage: 'unknown' });
});

test('metadata runtime errors return only generic unavailable', async () => {
  const { handler } = setup({ read: async () => {
    throw Error('private SQL and session detail');
  } });
  const result = await send(handler);
  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result.data).includes('private'), false);
});

test('non-JSON or encoded request bodies are refused without authentication attempts', async () => {
  const { handler, calls } = setup();
  for (const headers of [
    { 'content-type': 'text/plain' },
    { 'content-encoding': 'gzip' },
  ]) {
    const r = await send(handler, { headers });
    assert.equal(r.status, 400);
  }
  assert.deepEqual(calls, { session: 0, quota: 0, read: 0 });
});
