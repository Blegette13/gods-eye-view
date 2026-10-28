import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegulatoryEvidenceEvent, summarizeRegulatoryEvidence } from './evidenceLedger.js';

const valid = {
  countyFips: '48453', parcelId: '302959',
  taskId: 'verify-zoning-designation',
  eventType: 'document-indexed',
  sourceUrl: 'https://www.austintexas.gov/development-services/zoning-verification',
  sourceTitle: 'Austin zoning verification guidance (reference only)',
  sourceDate: null,
  sourceSha256: null,
  notes: 'Link captured as a research starting point; NOT a parcel zoning letter.',
  enteredBy: 'local-researcher',
};

test('indexing an official website is an unverified record, not a closed task or approval', () => {
  const e = createRegulatoryEvidenceEvent(valid);
  assert.equal(e.countyFips, '48453');
  assert.equal(e.sourceDate, null);
  assert.equal(e.verificationState, 'unverified');
  assert.equal(e.legalClearance, null);
  assert.equal(e.developmentRights, null);
  assert.equal(e.acquisitionRecommendation, null);
  assert.ok(Object.isFrozen(e));
  const status = summarizeRegulatoryEvidence([e]);
  assert.equal(status.indexedRecords, 1);
  assert.equal(status.taskEventCounts['verify-zoning-designation'], 1);
  assert.equal(status.verifiedTasks, 0);
  assert.equal(status.regulatoryClearance, null);
  assert.equal(status.acquisitionRecommendation, null);
});

test('document events need a title and URL; review notes may omit both', () => {
  assert.throws(() => createRegulatoryEvidenceEvent({
    ...valid, sourceTitle: null,
  }), /require source URL and source title/);
  assert.throws(() => createRegulatoryEvidenceEvent({
    ...valid, sourceUrl: null,
  }), /require source URL and source title/);
  const note = createRegulatoryEvidenceEvent({
    ...valid, eventType: 'review-note', sourceTitle: null, sourceUrl: null,
    notes: 'Not yet verified against property-specific source records.',
  });
  assert.equal(note.verificationState, 'unverified');
  assert.equal(note.sourceUrl, null);
  assert.equal(note.sourceTitle, null);
});

test('reject invalid identity, unsafe links, fabricated dates and hashes', () => {
  const invalid = [
    { countyFips: '480' },
    { countyFips: '06037' },
    { parcelId: '123;DROP' },
    { taskId: '../wrong-task' },
    { eventType: 'officially-verified' },
    { sourceUrl: 'http://www.austintexas.gov/' },
    { sourceUrl: 'https://username:password@www.austintexas.gov/' },
    { sourceUrl: 'https://www.austintexas.gov/#section' },
    { sourceDate: '2026-02-30' },
    { sourceDate: 'today' },
    { sourceSha256: '123456' },
    { notes: '' },
    { enteredBy: '   ' },
  ];
  for (const change of invalid) {
    assert.throws(() => createRegulatoryEvidenceEvent({
      ...valid, ...change,
    }), undefined, JSON.stringify(change));
  }
});

test('the evidence index rejects unknown approval states and does not infer GIS clearance', () => {
  const first = createRegulatoryEvidenceEvent(valid);
  const next = createRegulatoryEvidenceEvent({
    ...valid, eventType: 'correction-note', notes: 'Recheck the official ordinance revision.',
  });
  const indexed = summarizeRegulatoryEvidence([first, next]);
  assert.equal(indexed.taskEventCounts['verify-zoning-designation'], 2);
  assert.equal(indexed.verifiedTasks, 0);
  assert.throws(() => summarizeRegulatoryEvidence([{ ...first, verificationState: 'verified' }]),
    /Unrecognized evidence record/);
  assert.deepEqual(Object.keys(summarizeRegulatoryEvidence().taskEventCounts), []);
});
