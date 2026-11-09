import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runLocalRegulatoryEvidenceIntake,
} from './prepare-regulatory-evidence.mjs';

const input = {
  countyFips: '48453', parcelId: '302959',
  taskId: 'verify-zoning-designation', eventType: 'review-note',
  notes: 'Sample research note; no parcel zoning rights verified.',
  enteredBy: 'local-operator',
  sourceUrl: null, sourceTitle: null, sourceDate: null, sourceSha256: null,
};
const printed = () => {
  const lines = [];
  return { lines, print: (message) => lines.push(String(message)) };
};

test('default intake mode validates only, never queries or inserts into PostGIS', async () => {
  const log = printed();
  const result = await runLocalRegulatoryEvidenceIntake(['--file','evidence.json'], {
    load: async () => input,
    query: async () => { throw new Error('DB should not be contacted'); },
    print: log.print,
  });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.preview.verificationState, 'unverified');
  assert.equal(result.preview.acquisitionRecommendation, null);
  assert.ok(log.lines.join(' ').includes('No database changes'));
  assert.ok(!log.lines.join(' ').includes(input.notes));
});

test('explicit --commit uses one SQL stdin request and reports safe append receipt', async () => {
  const original = process.env.BDP_PG_SERVICE;
  process.env.BDP_PG_SERVICE = 'bdp';
  const receipt = {
    eventId: 13, countyFips: '48453', parcelId: '302959',
    taskId: 'verify-zoning-designation', eventType: 'review-note',
    verificationState: 'unverified', recordedAt: '2026-10-28T12:34:56Z',
    legalClearance: null, acquisitionRecommendation: null,
  };
  const log = printed();
  let times = 0;
  try {
    const result = await runLocalRegulatoryEvidenceIntake(['--file','evidence.json','--commit'], {
      load: async () => input,
      query: async (sql, options) => {
        times++;
        assert.match(sql, /INSERT INTO bdp_regulatory_evidence_events/);
        assert.equal(options.maxOutputBytes, 8192);
        assert.ok(!sql.includes(input.notes));
        return receipt;
      },
      print: log.print,
    });
    assert.equal(result.mode, 'commit');
    assert.equal(result.result.verificationState, 'unverified');
    assert.equal(times, 1);
    assert.ok(log.lines.join(' ').includes('NOT a verified land-use or legal determination'));
  } finally {
    if (original === undefined) delete process.env.BDP_PG_SERVICE;
    else process.env.BDP_PG_SERVICE = original;
  }
});

test('remote/write calls cannot be triggered without explicit local commit option', async () => {
  const failLoad = async () => { throw new Error('must not load'); };
  const failDb = async () => { throw new Error('must not write'); };
  for (const args of [
    [], ['--commit'], ['--file','a.json','--force'], ['--file','a.json','--commit','extra'],
  ]) {
    await assert.rejects(runLocalRegulatoryEvidenceIntake(args, {
      load: failLoad, query: failDb, print: () => {},
    }), /Usage/);
  }
});

test('template output is local-only and cannot write to the database', async () => {
  const log = printed();
  const result = await runLocalRegulatoryEvidenceIntake(['--template'], {
    load: async () => { throw new Error('should not load'); },
    query: async () => { throw new Error('should not write'); },
    print: log.print,
  });
  assert.equal(result.mode, 'template');
  assert.ok(log.lines.join(' ').includes('REPLACE_WITH_OFFICIAL_PARCEL_ID'));
});
