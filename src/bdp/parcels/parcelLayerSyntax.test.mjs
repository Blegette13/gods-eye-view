import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

// Syntax-only check for all shared county parcel layer modules. No Cesium
// viewer, network credentials or GIS provider access is necessary.
const directory = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(directory)
  .filter((name) => name.endsWith('.js'))
  .sort();

test('every shared county parcel map module parses as JavaScript before bundling', () => {
  assert.ok(sources.includes('bexarParcelLayer.js'));
  assert.ok(sources.includes('parcelSelectionStyle.js'));
  for (const filename of sources) {
    const result = spawnSync(process.execPath, ['--check', join(directory, filename)], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(
      result.status,
      0,
      `${filename} must parse before Vite/Rollup build:\n${result.stderr || result.error || ''}`,
    );
  }
});
