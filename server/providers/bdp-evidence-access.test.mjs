import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createScopedRegulatoryEvidenceService,
} from './bdp-evidence-access.js';

const scope = { countyFips: '48453', parcelId: '302959' };
const principal = {
  authenticated: true,
  subject: 'operator-1',
  roles: ['evidence-researcher'],
  parcelGrants: [scope],
};
const input = {
  ...scope, taskId: 'verify-zoning-designation',
  eventType: 'review-note', sourceUrl: null, sourceTitle: null,
  sourceDate: null, sourceSha256: null,
  notes: 'Evidence remains unverified.', enteredBy: 'operator-1',
};
const emptyIndex = {
  ...scope, totalEvents: 0, returnedEvents: 0, truncated: false, events: [],
  verifiedTasks: 0, legalClearance: null, acquisitionRecommendation: null,
};
const receipt = {
  eventId: 11, ...scope, taskId: input.taskId,
  eventType: 'review-note', verificationState: 'unverified',
  recordedAt: '2026-10-28T15:30:00Z',
  legalClearance: null, acquisitionRecommendation: null,
};

test('no trust resolver means no evidence service can be constructed', () => {
  assert.throws(() => createScopedRegulatoryEvidenceService(), /resolver/);
  assert.throws(() => createScopedRegulatoryEvidenceService({
    resolveAuthenticatedIdentity: async () => null,
    query: 'not a database adapter',
  }), /query adapter/);
});

test('unauthorized and cross-parcel reads cannot touch PostgreSQL', async () => {
  let calls = 0;
  const service = createScopedRegulatoryEvidenceService({
    resolveAuthenticatedIdentity: async (session) =>
      session === 'valid-server-session' ? principal : null,
    query: async () => { calls++; return emptyIndex; },
  });
  await assert.rejects(service.readIndex(null, scope), /access denied/);
  await assert.rejects(service.readIndex('valid-server-session', {
    countyFips: '48029', parcelId: scope.parcelId,
  }), /access denied/);
  await assert.rejects(service.readIndex('valid-server-session', {
    countyFips: scope.countyFips, parcelId: '302958',
  }), /access denied/);
  assert.equal(calls, 0);
});

test('authorized read returns validated metadata and never inferred clearance', async () => {
  let calls = 0;
  const service = createScopedRegulatoryEvidenceService({
    resolveAuthenticatedIdentity: async () => principal,
    query: async (sql, opts) => {
      calls++;
      assert.match(sql, /county_fips = '48453' AND parcel_id = '302959'/);
      assert.doesNotMatch(sql, /source_url|entered_by|notes/);
      assert.equal(opts.maxOutputBytes, 200_000);
      return emptyIndex;
    },
  });
  const result = await service.readIndex('session', scope);
  assert.equal(calls, 1);
  assert.equal(result.verifiedTasks, 0);
  assert.equal(result.legalClearance, null);
  assert.equal(result.acquisitionRecommendation, null);
});

test('reader cannot append; researcher can insert only an unverified, scoped note', async () => {
  let calls = 0;
  const service = createScopedRegulatoryEvidenceService({
    resolveAuthenticatedIdentity: async (session) =>
      session === 'reader' ? { ...principal, roles: ['evidence-reader'] } : principal,
    query: async (sql, opts) => {
      calls++;
      assert.match(sql, /INSERT INTO bdp_regulatory_evidence_events/);
      assert.doesNotMatch(sql, /Evidence remains unverified/);
      assert.equal(opts.maxOutputBytes, 8192);
      return receipt;
    },
  });
  await assert.rejects(service.appendEvent('reader', input), /access denied/);
  await assert.rejects(service.appendEvent('researcher', {
    ...input, parcelId: '99999',
  }), /access denied/);
  assert.equal(calls, 0);
  const appended = await service.appendEvent('researcher', input);
  assert.equal(calls, 1);
  assert.equal(appended.verificationState, 'unverified');
  assert.equal(appended.acquisitionRecommendation, null);
});

test('untrusted approval fields fail without contacting the database', async () => {
  let calls = 0;
  const service = createScopedRegulatoryEvidenceService({
    resolveAuthenticatedIdentity: async () => principal,
    query: async () => { calls++; return receipt; },
  });
  for (const patch of [
    { legalClearance: true },
    { verificationState: 'verified' },
    { acquisitionRecommendation: 'BUY' },
    { countyFips: '48453; SELECT 1' },
  ]) {
    await assert.rejects(service.appendEvent('researcher', { ...input, ...patch }));
  }
  assert.equal(calls, 0);
});

test('appending snapshots event fields before awaited identity resolution', async () => {
  let releaseIdentity;
  const service = createScopedRegulatoryEvidenceService({
    resolveAuthenticatedIdentity: () => new Promise((resolve) => {
      releaseIdentity = resolve;
    }),
    query: async (sql) => {
      assert.match(sql, /INSERT INTO bdp_regulatory_evidence_events/);
      return receipt;
    },
  });
  const mutable = { ...input };
  const pending = service.appendEvent('researcher', mutable);
  mutable.parcelId = 'wrong-parcel';
  releaseIdentity(principal);
  const result = await pending;
  assert.equal(result.parcelId, scope.parcelId);
});

test('malformed database read/append receipts are rejected without claiming approval', async () => {
  const service = createScopedRegulatoryEvidenceService({
    resolveAuthenticatedIdentity: async () => principal,
    query: async (sql) => sql.includes('INSERT INTO')
      ? { ...receipt, verificationState: 'verified' }
      : { ...emptyIndex, legalClearance: true },
  });
  await assert.rejects(service.readIndex('researcher', scope), /Malformed/);
  await assert.rejects(service.appendEvent('researcher', input), /failed parcel\/provenance/);
});
