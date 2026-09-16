import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNormalizeSql,
  parseOgrLayerNames,
} from './tceq-water-import.mjs';

test('parses XLSX worksheet names from ogrinfo output', () => {
  const output = `
INFO: Open of \`wractive.xlsx'
      using driver \`XLSX' successful.
1: Water Rights (None)
2: Notes (None)
`;
  assert.deepEqual(parseOgrLayerNames(output), ['Water Rights', 'Notes']);
});

test('normalization SQL maps TCEQ dictionary fields without inventing county ownership', () => {
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

  assert.match(sql, /'active'/);
  assert.match(sql, /wr_no/);
  assert.match(sql, /owners/);
  assert.match(sql, /divert_amt/);
  assert.match(sql, /prio_dt/);
  assert.match(sql, /NULL,/); // county remains unknown until spatial/record evidence provides it
  assert.match(sql, /tceq-water-rights/);
  assert.match(sql, /abc123/);
});
