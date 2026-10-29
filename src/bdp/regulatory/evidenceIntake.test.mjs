import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareRegulatoryEvidenceInsert,
  validateRegulatoryEvidenceInsertResult,
} from './evidenceIntake.js';

const input = {
  countyFips: '48453',
  parcelId: '302959',
  taskId: 'verify-zoning-designation',
  eventType: 'review-note',
  sourceUrl: null,
  sourceTitle: null,
  sourceDate: null,
  sourceSha256: null,
  notes: "Review only: A'B ; DROP TABLE research;\nNothing verified.",
  enteredBy: 'local-operator',
};

test('local research event SQL safely transports all free text as UTF-8 hex JSON', () => {
  const { sql, preview } = prepareRegulatoryEvidenceInsert(input);
  assert.match(sql, /INSERT INTO bdp_regulatory_evidence_events/);
  assert.match(sql, /convert_from\(decode\('[0-9a-f]+', 'hex'\), 'UTF8'\)::jsonb/);
  assert.doesNotMatch(sql, /DROP TABLE research/);
  assert.doesNotMatch(sql, /Review only/);
  const hex = sql.match(/decode\('([0-9a-f]+)', 'hex'\)/)[1];
  const parsed = JSON.parse(Buffer.from(hex, 'hex').toString('utf8'));
  assert.deepEqual(parsed, input);
  assert.equal(preview.verificationState, 'unverified');
  assert.equal(preview.acquisitionRecommendation, null);
  assert.equal(preview.legalClearance, null);
  assert.equal(JSON.stringify(preview).includes(input.notes), false);
  assert.ok(!sql.includes('UPDATE '));
  assert.ok(!sql.includes('DELETE '));
});

test('unknown fields including verification or acquired rights are rejected', () => {
  for (const change of [
    { verificationState: 'verified' }, { legalClearance: true },
    { acquisitionRecommendation: 'BUY' }, { extra: 'unrecognized' },
  ]) {
    assert.throws(() => prepareRegulatoryEvidenceInsert({ ...input, ...change }),
      /Unexpected regulatory evidence input fields/);
  }
});

test('invalid URL, bad reviewer field, injection in IDs or forged status are rejected', () => {
  for (const change of [
    { countyFips: "48453';SELECT" }, { taskId: 'DROP TABLE' },
    { notes: '' }, { enteredBy: '' },
    { sourceUrl: 'http://example.com' },
    { eventType: 'verified' },
  ]) {
    assert.throws(() => prepareRegulatoryEvidenceInsert({ ...input, ...change }));
  }
});

test('database insert receipt must match exact parcel and unverified state', () => {
  const receipt = {
    eventId: 1, countyFips: '48453', parcelId: '302959',
    taskId: 'verify-zoning-designation', eventType: 'review-note',
    verificationState: 'unverified', recordedAt: '2026-10-28T12:34:56Z',
    legalClearance: null, acquisitionRecommendation: null,
  };
  assert.deepEqual(validateRegulatoryEvidenceInsertResult(receipt, input), receipt);
  for (const bad of [
    { eventId: 0 }, { countyFips: '48029' }, { parcelId: 'other' },
    { taskId: 'wrong' }, { verificationState: 'verified' },
    { legalClearance: true }, { acquisitionRecommendation: 'BUY' },
    { recordedAt: 'not a timestamp' },
  ]) {
    assert.throws(() => validateRegulatoryEvidenceInsertResult({ ...receipt, ...bad }, input));
  }
});
