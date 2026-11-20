import assert from 'node:assert/strict';
import test from 'node:test';
import { runLocalRegulatoryDocumentIntake } from './prepare-regulatory-document.mjs';

const SHA = 'a'.repeat(64);
const metadata = Object.freeze({
  countyFips: '48453',
  parcelId: '302959',
  taskId: 'verify-zoning-designation',
  eventType: 'document-indexed',
  sourceUrl: 'https://www.austintexas.gov/development-services/zoning-verification',
  sourceTitle: 'Official verification document example',
  sourceDate: null,
  notes: 'Link is research only; authority, currency and contents unverified.',
  enteredBy: 'local-operator',
});
const args = ['--document', '.bdp-private/sample.pdf', '--meta', '.bdp-private/sample.json'];
const noop = () => {};
const fingerprint = async () => ({
  sourceSha256: SHA, fileBytes: 19,
  documentStoredInDatabase: false,
  verificationState: 'unverified',
});

test('document template is read-only and contains no fabricated parcel clearance', async () => {
  const lines = [];
  const result = await runLocalRegulatoryDocumentIntake(['--template'], {
    loadMetadata: async () => { throw Error('should not read file'); },
    fingerprint: async () => { throw Error('should not hash file'); },
    query: async () => { throw Error('should not open DB'); },
    print: (text) => lines.push(text),
  });
  assert.equal(result.mode, 'template');
  assert.ok(lines.join(' ').includes('REPLACE_WITH_OFFICIAL_PARCEL_ID'));
  assert.ok(!lines.join(' ').includes('"sourceSha256"'));
});

test('default document intake mode only hashes and previews, never writes to database', async () => {
  const lines = [];
  let calls = 0;
  const outcome = await runLocalRegulatoryDocumentIntake(args, {
    loadMetadata: async () => metadata,
    fingerprint,
    query: async () => { calls++; throw Error('should not write'); },
    print: (text) => lines.push(text),
  });
  assert.equal(outcome.mode, 'dry-run');
  assert.equal(calls, 0);
  assert.equal(outcome.sourceSha256, SHA);
  assert.equal(outcome.preview.verificationState, 'unverified');
  assert.equal(outcome.preview.acquisitionRecommendation, null);
  const display = lines.join(' ');
  assert.ok(display.includes('"documentStoredInDatabase": false'));
  assert.ok(display.includes('No database changes'));
  assert.ok(!display.includes(metadata.notes));
  assert.ok(!display.includes(metadata.sourceUrl));
});

test('forged document checksum and verification fields are rejected before any file hash', async () => {
  for (const patch of [
    { sourceSha256: SHA },
    { eventType: 'review-note' },
    { legalClearance: true },
    { acquisitionRecommendation: 'BUY' },
  ]) {
    let hashes = 0;
    await assert.rejects(runLocalRegulatoryDocumentIntake(args, {
      loadMetadata: async () => ({ ...metadata, ...patch }),
      fingerprint: async () => { hashes++; return fingerprint(); },
      query: async () => { throw Error('must not write'); },
      print: noop,
    }));
    if ('sourceSha256' in patch || 'eventType' in patch) {
      assert.equal(hashes, 0);
    }
  }
});

test('explicit commit appends only a validated unverified fingerprint record', async () => {
  const previous = process.env.BDP_PG_SERVICE;
  process.env.BDP_PG_SERVICE = 'bdp';
  let queries = 0;
  const lines = [];
  try {
    const outcome = await runLocalRegulatoryDocumentIntake([...args, '--commit'], {
      loadMetadata: async () => metadata,
      fingerprint,
      query: async (sql, opts) => {
        queries++;
        assert.equal(opts.maxOutputBytes, 8192);
        assert.match(sql, /INSERT INTO bdp_regulatory_evidence_events/);
        assert.ok(!sql.includes(metadata.notes));
        assert.ok(!sql.includes(metadata.sourceUrl));
        return {
          eventId: 3, countyFips: '48453', parcelId: '302959',
          taskId: 'verify-zoning-designation', eventType: 'document-indexed',
          verificationState: 'unverified',
          recordedAt: '2026-10-28T18:00:00.000Z',
          legalClearance: null, acquisitionRecommendation: null,
        };
      },
      print: (text) => lines.push(text),
    });
    assert.equal(queries, 1);
    assert.equal(outcome.receipt.eventId, 3);
    assert.equal(outcome.receipt.verificationState, 'unverified');
    assert.ok(lines.join(' ').includes('NOT legal zoning or development clearance'));
  } finally {
    if (previous === undefined) delete process.env.BDP_PG_SERVICE;
    else process.env.BDP_PG_SERVICE = previous;
  }
});

test('unsupported commands cannot trigger hashing or database writes', async () => {
  const invalid = [
    [], ['--commit'], ['--document', 'file.pdf'],
    [...args, '--force'], [...args, '--commit', 'extra'],
  ];
  for (const argv of invalid) {
    await assert.rejects(runLocalRegulatoryDocumentIntake(argv, {
      loadMetadata: async () => { throw Error('must not read metadata'); },
      fingerprint: async () => { throw Error('must not hash'); },
      query: async () => { throw Error('must not query'); },
      print: noop,
    }), /Usage/);
  }
});
