import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNormalizeSql,
  parseOgrLayerNames,
} from '../../../scripts/bdp/tceq-water-import.mjs';

test('TCEQ importer parses XLSX worksheet names from ogrinfo output', () => {
  const output = `
INFO: Open of \`wractive.xlsx'
      using driver \`XLSX' successful.
1: Water Rights (None)
2: Notes (None)
`;
  assert.deepEqual(parseOgrLayerNames(output), ['Water Rights', 'Notes']);
});

test('TCEQ importer SQL maps verified fields and leaves county unresolved', () => {
  const sql = buildNormalizeSql({
    dataset: 'active',
    table: 'bdp_tceq_water_active_stage',
    manifest: {
      filename: 'wractive.xlsx',
      url: 'https://example.test/wractive.xlsx',
      lastModified: '2026-09-15T00:00:00Z',
      checksumSha256: 'abc123',
    },
  });

  assert.match(sql, /wr_no/);
  assert.match(sql, /owners/);
  assert.match(sql, /divert_amt/);
  assert.match(sql, /prio_dt/);
  assert.match(sql, /tceq-water-rights/);
  assert.match(sql, /abc123/);
  assert.match(sql, /\n\s+NULL,\n\s+/); // county is not inferred from holder or basin data
});
