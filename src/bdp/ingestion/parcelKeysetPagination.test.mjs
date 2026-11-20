import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import {
  createPrivateParcelKeysetPagination,
  PRIVATE_PARCEL_KEYSET_RPC_SQL,
  MAX_PRIVATE_CURSOR_AGE_MS,
  MAX_PRIVATE_CURSOR_CHARS,
} from './parcelKeysetPagination.js';

const KEY = Buffer.alloc(32, 0x41);
const NOW = 1_000_000;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const pagePlan = () => parseBoundedParcelPageRequest({
  countyFips: '48453',
  bounds: { west: -97.76, south: 30.24, east: -97.73, north: 30.27 },
  limit: 2,
});
const context = () => ({
  plan: pagePlan(), trustedSourceId: 'travis-cad', trustedRunId: 42,
  sessionDigest: SHA_A, publicationRevision: SHA_B,
});
const accepted = () => ({
  status: 'validated-private', featureCount: 2, overflow: true,
  viewportCoverage: 'unknown', publishAuthorized: false,
});
const rows = () => [
  { source_parcel_id: 'PARCEL-001', parcel_version_id: '1', geometry: { type: 'MultiPolygon' } },
  { source_parcel_id: 'PARCEL-002', parcel_version_id: '2', geometry: { type: 'MultiPolygon' } },
  { source_parcel_id: 'PARCEL-003', parcel_version_id: '3', geometry: null },
];
const make = (clock = () => NOW) => createPrivateParcelKeysetPagination({
  hmacKey: KEY, now: clock, ttlMs: 60_000,
});
const issue = (codec, overrides = {}) => codec.issueContinuation({
  context: context(), rows: rows(), validatedPage: accepted(), ...overrides,
});

test('requires a true server-owned 32+ byte secret and strict short cursor TTL', () => {
  for (const hmacKey of [undefined, 'weak-key', Buffer.alloc(16), Uint8Array.from([1,2,3])]) {
    assert.throws(() => createPrivateParcelKeysetPagination({ hmacKey }), TypeError);
  }
  for (const ttlMs of [0, 999, MAX_PRIVATE_CURSOR_AGE_MS + 1, '60000', 1.5]) {
    assert.throws(() => createPrivateParcelKeysetPagination({ hmacKey: KEY, ttlMs }), TypeError);
  }
  assert.equal(MAX_PRIVATE_CURSOR_AGE_MS, 120_000);
});

test('valid private overflow yields a bounded signed token and fixed 10-param keyset SQL', () => {
  const codec = make();
  const token = issue(codec);
  assert.equal(typeof token, 'string');
  assert.ok(token.length < MAX_PRIVATE_CURSOR_CHARS);
  assert.equal(token.split('.').length, 2);
  assert.ok(!token.includes(SHA_A));
  assert.ok(!token.includes(SHA_B));
  assert.ok(!token.includes('travis-cad'));
  const statement = codec.planContinuation({ context: context(), token });
  assert.equal(statement.text, PRIVATE_PARCEL_KEYSET_RPC_SQL);
  assert.deepEqual(statement.values, [
    '48453', 'travis-cad', 42, -97.76, 30.24, -97.73, 30.27, 3,
    'PARCEL-002', '2',
  ]);
  assert.equal(statement.publishAuthorized, false);
  assert.equal(statement.viewportCoverage, 'unknown');
  assert.ok(Object.isFrozen(statement));
  assert.ok(Object.isFrozen(statement.values));
  assert.doesNotMatch(statement.text, /\b(?:parcel_versions|source_registry|INSERT|COPY|GRANT)\b/i);
});

test('tokens bind to session digest, source, run, county, bounds, limit and review revision', () => {
  const codec = make();
  const token = issue(codec);
  const current = context();
  const mismatch = [
    { ...current, sessionDigest: 'c'.repeat(64) },
    { ...current, publicationRevision: 'd'.repeat(64) },
    { ...current, trustedSourceId: 'other-cad' },
    { ...current, trustedRunId: 43 },
    { ...current, plan: { ...current.plan, countyFips: '48029' } },
    { ...current, plan: { ...current.plan, bounds: {
      ...current.plan.bounds, east: -97.72,
    } } },
    { ...current, plan: { ...current.plan, limit: 1, probeLimit: 2 } },
  ];
  for (const candidate of mismatch) {
    assert.equal(codec.planContinuation({ context: candidate, token }), null);
  }
  assert.ok(codec.planContinuation({ context: current, token }));
});

test('client-provided source/rights and invented coverage fields cannot become context authority', () => {
  const codec = make();
  const token = issue(codec);
  for (const extra of [
    { sourceId: 'other-source' }, { role: 'admin' }, { viewportCoverage: 'complete' },
    { publicationAllowed: true },
  ]) {
    assert.equal(codec.planContinuation({
      context: { ...context(), ...extra }, token,
    }), null);
  }
  assert.equal(codec.planContinuation({
    context: { ...context(), plan: { ...pagePlan(), cursor: 'arbitrary' } }, token,
  }), null);
  assert.equal(codec.issueContinuation({
    context: { ...context(), sessionDigest: 'bad' },
    rows: rows(), validatedPage: accepted(),
  }), null);
});

test('tampered, unsigned and malformed continuation tokens fail closed', () => {
  const codec = make();
  const token = issue(codec);
  const [body, signature] = token.split('.');
  const modified = JSON.parse(Buffer.from(body, 'base64url').toString());
  modified.k = 'PARCEL-999';
  const forged = Buffer.from(JSON.stringify(modified)).toString('base64url') + '.' + signature;
  const failures = [
    forged,
    body + '.' + Buffer.alloc(32, 0).toString('base64url'),
    body + '.' + signature.slice(1),
    token + '.extra',
    token + '/',
    'not-signed',
    'a'.repeat(MAX_PRIVATE_CURSOR_CHARS + 1),
    '',
    undefined,
  ];
  for (const bad of failures) assert.equal(codec.planContinuation({
    context: context(), token: bad,
  }), null);
});

test('tokens expire at exact deadline and future-issued tokens cannot be replayed before issuance', () => {
  let time = NOW;
  const codec = make(() => time);
  const token = issue(codec);
  time = NOW + 59_999;
  assert.ok(codec.planContinuation({ context: context(), token }));
  time = NOW + 60_000;
  assert.equal(codec.planContinuation({ context: context(), token }), null);
  time = NOW - 1;
  assert.equal(codec.planContinuation({ context: context(), token }), null);
});

test('pagination keys are the last accepted parcel, never the extra overflow sentinel', () => {
  const codec = make();
  const token = issue(codec);
  const args = codec.planContinuation({ context: context(), token });
  assert.deepEqual(args.values.slice(-2), ['PARCEL-002', '2']);
  assert.deepEqual(args.values.slice(0,8), [
    '48453','travis-cad',42,-97.76,30.24,-97.73,30.27,3,
  ]);
});

test('no next cursor without an independently validated, overflowing private page', () => {
  const codec = make();
  for (const candidate of [
    { ...accepted(), overflow: false },
    { ...accepted(), featureCount: 1 },
    { ...accepted(), publishAuthorized: true },
    { ...accepted(), viewportCoverage: 'complete' },
    { ...accepted(), status: 'ok' },
    null,
  ]) assert.equal(issue(codec, { validatedPage: candidate }), null);
  assert.equal(issue(codec, { rows: rows().slice(0,2) }), null);
  assert.equal(issue(codec, { rows: [...rows(), rows()[2]] }), null);
});

test('unordered, repeated or malformed parcel IDs and bigint positions cannot mint a cursor', () => {
  const codec = make();
  for (const badRows of [
    [rows()[1], rows()[0], rows()[2]],
    [rows()[0], rows()[0], rows()[2]],
    [rows()[0], { ...rows()[1], source_parcel_id: 'a b' }, rows()[2]],
    [rows()[0], { ...rows()[1], parcel_version_id: '1e2' }, rows()[2]],
    [rows()[0], { ...rows()[1], parcel_version_id: '9223372036854775808' }, rows()[2]],
    [rows()[0], rows()[1], { ...rows()[2], geometry: { type: 'Polygon' } }],
  ]) assert.equal(issue(codec, { rows: badRows }), null);
});

test('same parcel name is ordered by PostgreSQL bigint identity, not lexicographic text', () => {
  const codec = make();
  const original = rows();
  const repeatedParcel = [
    { ...original[0], parcel_version_id: '9' },
    { ...original[1], source_parcel_id: 'PARCEL-001', parcel_version_id: '10' },
    { ...original[2], source_parcel_id: 'PARCEL-002' },
  ];
  const token = issue(codec, { rows: repeatedParcel });
  assert.ok(token);
  assert.deepEqual(codec.planContinuation({
    context: context(), token,
  }).values.slice(-2), ['PARCEL-001', '10']);
});

test('private data is never returned, serialized as geometry, or declared complete', () => {
  const codec = make();
  const token = issue(codec);
  const planned = codec.planContinuation({ context: context(), token });
  assert.equal(planned.viewportCoverage, 'unknown');
  assert.equal(planned.publishAuthorized, false);
  assert.equal(Object.hasOwn(planned, 'rows'), false);
  assert.equal(Object.hasOwn(planned, 'geometry'), false);
  assert.equal(JSON.stringify(planned).includes('MultiPolygon'), false);
});

test('cursor logic is unrouted and does not install a reader or modify Cesium', () => {
  const code = readFileSync(new URL('./parcelKeysetPagination.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /createServer\(|\.listen\(|new Pool\(|fetch\(/);
  assert.match(code, /parcel_geometry_keyset_rpc/);
  assert.doesNotMatch(code, /\b(?:CREATE ROLE|GRANT EXECUTE|CREATE FUNCTION)\b/);
});
