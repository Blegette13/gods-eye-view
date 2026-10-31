import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRegulatoryEvidenceGate,
} from './evidenceAccessPolicy.js';

const scope = Object.freeze({ countyFips: '48453', parcelId: '302959' });
const grant = Object.freeze({ ...scope });
const reader = Object.freeze({
  authenticated: true, subject: 'operator-1',
  roles: ['evidence-reader'], parcelGrants: [grant],
});
const researcher = Object.freeze({
  ...reader, roles: ['evidence-researcher'],
});
const gateWith = (identity) => createRegulatoryEvidenceGate(async (session) =>
  session === 'trusted-server-session' ? identity : null);
const allow = async (gate, action, s = scope) =>
  gate('trusted-server-session', action, s);

test('valid trusted reader can inspect only explicitly granted parcel', async () => {
  const gate = gateWith(reader);
  const decision = await allow(gate, 'read-index');
  assert.equal(decision.operation, 'read-index');
  assert.equal(decision.parcelId, '302959');
  assert.equal(decision.legalClearance, null);
  assert.equal(decision.acquisitionRecommendation, null);
  assert.ok(Object.isFrozen(decision));
  await assert.rejects(allow(gate, 'read-index', {
    countyFips: '48453', parcelId: '302958',
  }), /access denied/);
  await assert.rejects(allow(gate, 'read-index', {
    countyFips: '48029', parcelId: '302959',
  }), /access denied/);
});

test('no session, unverified identity and client-supplied role claims never grant access', async () => {
  const gate = gateWith(researcher);
  await assert.rejects(gate(null, 'read-index', scope), /access denied/);
  await assert.rejects(gate({
    authenticated: true, roles: ['evidence-researcher'],
    parcelGrants: [scope],
  }, 'read-index', scope), /access denied/);
  for (const id of [null, undefined, {}, {
    subject: 'operator-1', roles: ['evidence-researcher'], parcelGrants: [scope],
  }, {
    authenticated: true, subject: 'operator-1',
    roles: ['evidence-researcher'], parcelGrants: [],
  }]) {
    await assert.rejects(allow(gateWith(id), 'read-index'), /access denied/);
  }
});

test('reader cannot append and no role can verify, delete, amend or clear property', async () => {
  await assert.rejects(allow(gateWith(reader), 'append-note'), /access denied/);
  await assert.rejects(allow(gateWith(reader), 'append-document'), /access denied/);
  for (const operation of ['verify', 'approve', 'delete', 'update', 'grant-clearance',
    'bulk-read', 'acquisition-recommendation']) {
    await assert.rejects(allow(gateWith(researcher), operation), /access denied/);
  }
  assert.equal((await allow(gateWith(researcher), 'append-note')).operation, 'append-note');
  assert.equal((await allow(gateWith(researcher), 'append-document')).operation, 'append-document');
});

test('wildcards, malformed parcel IDs, generic admin labels, and county grants are denied', async () => {
  const broad = { ...researcher, parcelGrants: [
    { countyFips: '48453', parcelId: '*' },
    { countyFips: '48453' },
  ] };
  await assert.rejects(allow(gateWith(broad), 'read-index'), /access denied/);
  const admin = { ...reader, roles: ['admin'] };
  await assert.rejects(allow(gateWith(admin), 'read-index'), /access denied/);
  for (const invalid of [
    { countyFips: '48453', parcelId: '302959; DROP' },
    { countyFips: '*', parcelId: '302959' },
    { countyFips: '48453', parcelId: '*' },
  ]) {
    await assert.rejects(allow(gateWith(researcher), 'read-index', invalid), /access denied/);
  }
});

test('resolver failure is safely denied, not treated as anonymous access', async () => {
  const gate = createRegulatoryEvidenceGate(async () => {
    throw new Error('Sensitive session store details');
  });
  await assert.rejects(allow(gate, 'read-index'), (err) =>
    err.code === 'BDP_EVIDENCE_ACCESS_DENIED' &&
    !err.message.includes('Sensitive'));
  assert.throws(() => createRegulatoryEvidenceGate(null), /resolver/);
});
