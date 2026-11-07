import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runTceqMswDownload } from '../../../scripts/bdp/tceq-msw-download.mjs';
import { validateMswCache } from '../../../scripts/bdp/tceq-msw-import.mjs';
import { getTceqMswDataset } from './tceqMswCatalog.js';

test('MSW cache repairs corruption, revalidates 304s and verifies import provenance', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'bdp-msw-'));
  const spec = getTceqMswDataset('facilities');
  const sourcePath = path.join(cacheDir, spec.filename);
  const bytes = new Uint8Array([1, 2, 3]);
  let requests = 0;
  const fetchImpl = async (_url, { headers }) => {
    requests += 1;
    if (requests === 2) {
      assert.equal(headers['if-none-match'], 'test-etag');
      return new Response(null, { status: 304 });
    }
    assert.equal(headers['if-none-match'], undefined);
    return new Response(bytes, { headers: { etag: 'test-etag' } });
  };
  const options = { cacheDir, datasets: ['facilities'], fetchImpl };
  try {
    assert.equal((await runTceqMswDownload(options))[0].status, 'downloaded');
    assert.equal((await runTceqMswDownload(options))[0].status, 'skipped-unchanged');
    await writeFile(sourcePath, 'corrupted');
    assert.equal((await runTceqMswDownload(options))[0].status, 'downloaded');
    assert.deepEqual(new Uint8Array(await readFile(sourcePath)), bytes);
    const manifest = JSON.parse(await readFile(`${sourcePath}.json`, 'utf8'));
    await validateMswCache({ spec, sourcePath, manifest });
    await assert.rejects(validateMswCache({ spec, sourcePath, manifest: { ...manifest, dataset: 'closed' } }), /official dataset/);
    await assert.rejects(validateMswCache({ spec, sourcePath, manifest: { ...manifest, checksumSha256: 'a'.repeat(64) } }), /checksum/);
    await assert.rejects(validateMswCache({ spec, sourcePath, manifest, now: Date.parse(manifest.checkedAt) + 15 * 86400000 }), /expired/);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});
