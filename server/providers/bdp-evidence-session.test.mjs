import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSessionBoundEvidenceService,
  requireBoundEvidenceDbSession,
  EVIDENCE_DB_SESSION_PROBE,
} from './bdp-evidence-session.js';

const scope = Object.freeze({ countyFips: '48453', parcelId: '302959' });
const login = 'bdp_operator_alice123';
const principal = Object.freeze({
  authenticated: true,
  subject: 'alice-123',
  roles: ['evidence-researcher'],
  parcelGrants: [scope],
});
const profile = Object.freeze({
  sessionUser: login,
  currentUser: login,
  isSuperuser: false,
  bypassRls: false,
  canLogin: true,
  readerRoleUsable: true,
  appenderRoleUsable: true,
});
const index = Object.freeze({
  ...scope,
  totalEvents: 0, returnedEvents: 0, truncated: false,
  events: [], verifiedTasks: 0, legalClearance: null,
  acquisitionRecommendation: null,
});
const event = Object.freeze({
  ...scope, taskId: 'verify-zoning-designation',
  eventType: 'review-note', sourceUrl: null, sourceTitle: null,
  sourceDate: null, sourceSha256: null,
  notes: 'Research note, not zoning clearance.',
  enteredBy: 'local-test',
});
const receipt = Object.freeze({
  eventId: 12, ...scope,
  taskId: event.taskId, eventType: event.eventType,
  verificationState: 'unverified',
  recordedAt: '2026-10-28T23:00:00Z',
  legalClearance: null, acquisitionRecommendation: null,
});

test('fail closed if trusted identity, role mapping or pinned connection manager is missing', () => {
  assert.throws(() => createSessionBoundEvidenceService(), /resolver/);
  assert.throws(() => createSessionBoundEvidenceService({
    resolveAuthenticatedIdentity: async () => principal,
  }), /pinned connection manager/);
  assert.match(EVIDENCE_DB_SESSION_PROBE, /session_user/);
  assert.match(EVIDENCE_DB_SESSION_PROBE, /pg_has_role/);
});

test('DB profile rejects owner, superuser, BYPASSRLS, missing privilege or wrong login', () => {
  assert.equal(requireBoundEvidenceDbSession(profile, login, 'read-index'), true);
  assert.equal(requireBoundEvidenceDbSession(profile, login, 'append-event'), true);
  for (const changed of [
    { sessionUser: 'bdp' },
    { currentUser: 'bdp_evidence_owner' },
    { sessionUser: 'postgres' },
    { isSuperuser: true },
    { bypassRls: true },
    { canLogin: false },
    { readerRoleUsable: false },
    { appenderRoleUsable: false },
  ]) {
    const op = changed.appenderRoleUsable === false ? 'append-event' : 'read-index';
    assert.throws(() => requireBoundEvidenceDbSession(
      { ...profile, ...changed }, login, op), /access denied/);
  }
  assert.throws(() => requireBoundEvidenceDbSession(profile, 'bdp', 'read-index'), /access denied/);
  assert.throws(() => requireBoundEvidenceDbSession(profile, login, 'verify-legal-clearance'), /access denied/);
  assert.throws(() => requireBoundEvidenceDbSession(null, login, 'read-index'), /access denied/);
});

test('anonymous, wrong parcel and researcher with no grant cannot open a DB connection', async () => {
  let opened = 0;
  const service = createSessionBoundEvidenceService({
    resolveAuthenticatedIdentity: async (session) =>
      session === 'verified-server-session' ? principal : null,
    resolveOperatorDbLogin: async () => login,
    withOperatorDbConnection: async () => { opened++; throw Error('must not open'); },
  });
  await assert.rejects(service.readIndex(null, scope), /access denied/);
  await assert.rejects(service.readIndex('verified-server-session', {
    countyFips: scope.countyFips, parcelId: '302960',
  }), /access denied/);
  await assert.rejects(service.appendEvent('verified-server-session', {
    ...event, countyFips: '48029',
  }), /access denied/);
  assert.equal(opened, 0);
});

test('trusted subject-to-DB-login resolver rejects missing and privileged DB identities', async () => {
  for (const output of [null, '', 'bdp', 'postgres', 'bdp_operator_!bad', 'bdp_operator_a']) {
    let opened = 0;
    const service = createSessionBoundEvidenceService({
      resolveAuthenticatedIdentity: async () => principal,
      resolveOperatorDbLogin: async ({ subject }) => {
        assert.equal(subject, principal.subject);
        return output;
      },
      withOperatorDbConnection: async () => { opened++; throw Error('must not open'); },
    });
    await assert.rejects(service.readIndex('verified-server-session', scope), /access denied/);
    assert.equal(opened, 0);
  }
});

test('authorized read probes AND queries through same pinned DB callback', async () => {
  let opens = 0;
  const calls = [];
  const service = createSessionBoundEvidenceService({
    resolveAuthenticatedIdentity: async () => principal,
    resolveOperatorDbLogin: async ({ subject }) => {
      assert.equal(subject, principal.subject);
      return login;
    },
    withOperatorDbConnection: async (context, work) => {
      opens++;
      assert.deepEqual(context, {
        login, operation: 'read-index', mustPinConnection: true,
      });
      const query = async (sql, opts) => {
        calls.push({ sql, opts });
        return calls.length === 1 ? profile : index;
      };
      return work({ query });
    },
  });
  const result = await service.readIndex('verified-server-session', scope);
  assert.equal(opens, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sql, EVIDENCE_DB_SESSION_PROBE);
  assert.match(calls[1].sql, /parcel_id = '302959'/);
  assert.equal(result.legalClearance, null);
  assert.equal(result.acquisitionRecommendation, null);
});

test('mismatched authenticated Postgres login fails before any parcel SQL', async () => {
  let commands = 0;
  const service = createSessionBoundEvidenceService({
    resolveAuthenticatedIdentity: async () => principal,
    resolveOperatorDbLogin: async () => login,
    withOperatorDbConnection: async (_context, work) => work({
      query: async (sql) => {
        commands++;
        assert.equal(sql, EVIDENCE_DB_SESSION_PROBE);
        return { ...profile, sessionUser: 'bdp_operator_someoneelse' };
      },
    }),
  });
  await assert.rejects(service.readIndex('verified-server-session', scope), /access denied/);
  assert.equal(commands, 1);
});

test('authorized append uses restricted RPC on bound session; cannot claim verified legal facts', async () => {
  const commands = [];
  const service = createSessionBoundEvidenceService({
    resolveAuthenticatedIdentity: async () => principal,
    resolveOperatorDbLogin: async () => login,
    withOperatorDbConnection: async (context, work) => {
      assert.equal(context.operation, 'append-event');
      return work({
        query: async (sql) => {
          commands.push(sql);
          return commands.length === 1 ? profile : receipt;
        },
      });
    },
  });
  const result = await service.appendEvent('verified-server-session', event);
  assert.equal(commands.length, 2);
  assert.match(commands[1], /SELECT public\.bdp_evidence_append_unverified\(/);
  assert.doesNotMatch(commands[1], /INSERT INTO|UPDATE .* SET/);
  assert.equal(result.verificationState, 'unverified');
  assert.equal(result.legalClearance, null);
  await assert.rejects(service.appendEvent('verified-server-session', {
    ...event, verificationState: 'verified',
  }), /Unexpected regulatory evidence input fields/);
  assert.equal(commands.length, 2);
});

test('a reader-only database session cannot append and malformed results never clear a parcel', async () => {
  let commands = 0;
  const service = createSessionBoundEvidenceService({
    resolveAuthenticatedIdentity: async () => principal,
    resolveOperatorDbLogin: async () => login,
    withOperatorDbConnection: async (_context, work) => work({
      query: async (sql) => {
        commands++;
        return sql === EVIDENCE_DB_SESSION_PROBE ?
          { ...profile, appenderRoleUsable: false } : receipt;
      },
    }),
  });
  await assert.rejects(service.appendEvent('verified-server-session', event), /access denied/);
  assert.equal(commands, 1);
});
