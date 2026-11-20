import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractRrcArchiveHref,
  getRrcMftFolderUrl,
  resolveRrcCountyArchive,
  sha256Hex,
} from './rrcDownloader.js';

test('uses official RRC HTTPS folders for wells and pipelines', () => {
  assert.match(getRrcMftFolderUrl('wells'), /^https:\/\/mft\.rrc\.texas\.gov\/link\//);
  assert.match(getRrcMftFolderUrl('pipelines'), /^https:\/\/mft\.rrc\.texas\.gov\/link\//);
});

test('extracts a matching archive link from an RRC folder page', () => {
  const base = 'https://mft.rrc.texas.gov/link/example';
  const html = `
    <html><body>
      <a href="/download?id=1">pipeline027.zip</a>
      <a href="/download?id=2&amp;name=pipeline029.zip">pipeline029.zip</a>
    </body></html>
  `;

  assert.equal(
    extractRrcArchiveHref(html, 'pipeline029.zip', base),
    'https://mft.rrc.texas.gov/download?id=2&name=pipeline029.zip',
  );
});

test('resolves Bexar pipeline metadata without hard-coding the generated file link', async () => {
  const folderUrl = getRrcMftFolderUrl('pipelines');
  const fetchImpl = async (url) => {
    assert.equal(url, folderUrl);
    return {
      ok: true,
      status: 200,
      async text() {
        return '<a href="/download?file=pipeline029.zip">pipeline029.zip</a>';
      },
    };
  };

  const result = await resolveRrcCountyArchive({
    dataset: 'pipelines',
    countyFips: '48029',
    fetchImpl,
  });

  assert.equal(result.countyFips, '029');
  assert.equal(result.filename, 'pipeline029.zip');
  assert.equal(result.downloadUrl, 'https://mft.rrc.texas.gov/download?file=pipeline029.zip');
});

test('produces a stable SHA-256 checksum', async () => {
  const bytes = new TextEncoder().encode('BDP');
  assert.equal(
    await sha256Hex(bytes),
    '76841b510b45a384ccf9ffa1d52f742f9b5e7bd82107eeb64d83c2bf9ea689c7',
  );
});
