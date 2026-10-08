import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadPuctSewerArchive, importPuctSewerArchive, PUCT_SEWER_ARCHIVE_URL } from './puct-sewer-import.mjs';

test('official PUCT sewer archive is checksum verified, cached and conditionally rechecked', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'bdp-puct-sewer-'));
  const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(1100, 5)]);
  try {
    const fetchImpl = async (url) => {
      assert.equal(url, PUCT_SEWER_ARCHIVE_URL);
      return { ok: true, status: 200, headers: new Headers({ etag: '"abc"', 'last-modified': 'Mon, 05 Oct 2026 13:41:59 GMT' }),
        arrayBuffer: async () => bytes };
    };
    const first = await downloadPuctSewerArchive({ cacheDir, fetchImpl });
    assert.equal(first.changed, true);
    assert.equal(first.manifest.checksumSha256.length, 64);
    assert.deepEqual(await readFile(first.filename), bytes);
    const second = await downloadPuctSewerArchive({ cacheDir, fetchImpl: async (_url, options) => {
      assert.equal(options.headers['if-none-match'], '"abc"');
      return { status: 304 };
    } });
    assert.equal(second.changed, false);
    await assert.rejects(importPuctSewerArchive({ filename: first.filename,
      manifest: { checksumSha256: '0'.repeat(64) } }), /checksum changed/);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test('HTML or truncated archive cannot replace a verified snapshot', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'bdp-puct-sewer-'));
  try {
    await assert.rejects(downloadPuctSewerArchive({ cacheDir,
      fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(),
        arrayBuffer: async () => Buffer.alloc(1100, 1) }) }), /not a bounded ZIP/);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});
