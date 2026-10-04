import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNormalizeSql,
  parseOgrLayerNames,
} from '../../../scripts/bdp/tceq-msw-import.mjs';

test('parses GDAL worksheet names for TCEQ MSW spreadsheets', () => {
  const layers = parseOgrLayerNames('1: Facilities\n2: Notes');
  assert.deepEqual(layers, ['Facilities', 'Notes']);
});

test('current MSW normalize SQL maps TCEQ location/status fields', () => {
  const sql = buildNormalizeSql({
    dataset: 'facilities',
    table: 'stage',
    manifest: {
      filename: 'msw-facilities-texas.xls',
      url: 'https://example.test/msw.xls',
      checksumSha256: 'abc',
      lastModified: null,
    },
  });
  assert.match(sql, /physical_site_status/);
  assert.match(sql, /additional_id/);
  assert.match(sql, /ST_MakePoint/);
  assert.match(sql, /'facilities'/);
});

test('historical unnumbered normalize SQL preserves unauthorized and hazardous-history fields', () => {
  const sql = buildNormalizeSql({
    dataset: 'unnumbered',
    table: 'stage',
    manifest: {
      filename: 'msw-unum-texas.xlsx',
      url: 'https://example.test/unum.xlsx',
      checksumSha256: 'abc',
      lastModified: null,
    },
  });
  assert.match(sql, /unauthor/);
  assert.match(sql, /haz_cert/);
  assert.match(sql, /haz_prob/);
  assert.match(sql, /size_acres/);
});
