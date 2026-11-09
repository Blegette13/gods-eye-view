import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  discoverLandTestFiles, landTestArgs,
} from '../../../scripts/bdp/run-land-tests.mjs';

test('focused runner discovers ALL recursively nested BDP tests in stable order only', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'land-tests-'));
  try {
    const bdp = path.join(root, 'src', 'bdp');
    mkdirSync(path.join(bdp, 'ingestion'), { recursive: true });
    mkdirSync(path.join(root, 'src', 'overlays'), { recursive: true });
    writeFileSync(path.join(bdp, 'z.test.mjs'), '');
    writeFileSync(path.join(bdp, 'ingestion', 'a.test.mjs'), '');
    writeFileSync(path.join(bdp, 'ingestion', 'not-a-test.mjs.bak'), '');
    writeFileSync(path.join(root, 'src', 'overlays', 'legacy.test.mjs'), '');
    assert.deepEqual(discoverLandTestFiles(root), [
      'src/bdp/ingestion/a.test.mjs',
      'src/bdp/z.test.mjs',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('test args preserve the passed set and cap file-level concurrency without disabling checks', () => {
  const files = ['src/bdp/ingestion/a.test.mjs', 'src/bdp/parcels/b.test.mjs'];
  assert.deepEqual(landTestArgs(files), ['--test', '--test-concurrency=2', ...files]);
  assert.deepEqual(files, ['src/bdp/ingestion/a.test.mjs', 'src/bdp/parcels/b.test.mjs']);
});

test('rejects empty, forged, or non-land file paths', () => {
  for (const files of [
    [], null,
    ['src/overlays/worldOverlayAllocation.test.mjs'],
    ['src/bdp/../overlays/slow.test.mjs'],
    ['src/bdp/a.test.mjs', '--test-skip-pattern=critical'],
    ['/tmp/custom.test.mjs'],
    ['src/bdp/test.js'],
  ]) assert.throws(() => landTestArgs(files), TypeError);
});

test('current repository land suite includes dedicated internal metadata HTTP tests', () => {
  const files = discoverLandTestFiles();
  assert.ok(files.includes('src/bdp/ingestion/parcelInternalMetadataHttp.test.mjs'));
  assert.ok(files.includes('src/bdp/ingestion/parcelPgDriverSmoke.test.mjs'));
  assert.ok(files.includes('src/bdp/ingestion/parcelLandTestRunner.test.mjs'));
  assert.ok(!files.some((file) => file.includes('worldOverlayAllocation')));
  assert.equal(new Set(files).size, files.length);
});
