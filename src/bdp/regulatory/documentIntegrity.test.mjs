import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fingerprintPrivateRegulatoryDocument,
  readPrivateRegulatoryMetadata,
  resolvePrivateRegulatoryFile,
} from './documentIntegrity.js';

async function fixture(t) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'bdp-reg-doc-'));
  await mkdir(join(projectRoot, '.bdp-private'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  return projectRoot;
}

test('hashes exact local file bytes without copying document into PostGIS', async (t) => {
  const projectRoot = await fixture(t);
  const contents = Buffer.from('Sample local-only DOCUMENT FIXTURE; not a real ordinance.\n');
  await writeFile(join(projectRoot, '.bdp-private', 'sample.pdf'), contents);
  const result = await fingerprintPrivateRegulatoryDocument(
    '.bdp-private/sample.pdf', { projectRoot },
  );
  assert.equal(result.sourceSha256, createHash('sha256').update(contents).digest('hex'));
  assert.equal(result.fileBytes, contents.length);
  assert.equal(result.documentStoredInDatabase, false);
  assert.equal(result.verificationState, 'unverified');
  assert.equal(Object.hasOwn(result, 'fullPath'), false);
  assert.equal(Object.hasOwn(result, 'bytes'), false);
});

test('rejects path traversal, outside files, empty and unsupported extensions', async (t) => {
  const projectRoot = await fixture(t);
  await writeFile(join(projectRoot, 'outside.pdf'), 'external');
  await writeFile(join(projectRoot, '.bdp-private', 'empty.pdf'), '');
  await writeFile(join(projectRoot, '.bdp-private', 'malware.exe'), 'binary');
  await writeFile(join(projectRoot, '.bdp-private', 'long.pdf'), 'too long for test');
  for (const file of [
    'outside.pdf', '.bdp-private/../outside.pdf',
    '.bdp-private/empty.pdf', '.bdp-private/malware.exe',
  ]) {
    await assert.rejects(fingerprintPrivateRegulatoryDocument(file, { projectRoot }));
  }
  await assert.rejects(fingerprintPrivateRegulatoryDocument(
    '.bdp-private/long.pdf', { projectRoot, maxBytes: 5 },
  ));
  await assert.rejects(fingerprintPrivateRegulatoryDocument(
    '/tmp/private.pdf', { projectRoot },
  ));
});

test('rejects symlinked evidence files and symlinked private root', async (t) => {
  const projectRoot = await fixture(t);
  const external = join(projectRoot, 'external.pdf');
  await writeFile(external, 'external content');
  try {
    await symlink(external, join(projectRoot, '.bdp-private', 'link.pdf'));
    await assert.rejects(fingerprintPrivateRegulatoryDocument(
      '.bdp-private/link.pdf', { projectRoot },
    ), /symlink|outside|ordinary/i);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
  }
});

test('reads bounded local-only metadata JSON without returning document file content', async (t) => {
  const projectRoot = await fixture(t);
  const input = {
    countyFips: '48453', parcelId: '302959',
    taskId: 'verify-zoning-designation', eventType: 'document-indexed',
    sourceTitle: 'Official document title', sourceUrl: 'https://www.austintexas.gov/',
    notes: 'Not a legal approval', enteredBy: 'local-operator',
  };
  await writeFile(join(projectRoot, '.bdp-private', 'document.json'),
    JSON.stringify(input), 'utf8');
  assert.deepEqual(await readPrivateRegulatoryMetadata(
    '.bdp-private/document.json', { projectRoot },
  ), input);
  await assert.rejects(resolvePrivateRegulatoryFile('document.json', { projectRoot }));
  await writeFile(join(projectRoot, '.bdp-private', 'malformed.json'), '{oops');
  await assert.rejects(readPrivateRegulatoryMetadata('.bdp-private/malformed.json', {
    projectRoot,
  }), /JSON/);
  await writeFile(join(projectRoot, '.bdp-private', 'large.json'), 'a'.repeat(17_000));
  await assert.rejects(readPrivateRegulatoryMetadata('.bdp-private/large.json', {
    projectRoot,
  }));
});
