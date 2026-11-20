import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { sha256Hex } from '../../src/bdp/ingestion/rrcDownloader.js';
import { createTceqWaterRightsIngestionPlan } from '../../src/bdp/water/tceqWaterRightsCatalog.js';

function parseArgs(argv) {
  const options = {
    datasets: ['active', 'inactive'],
    cacheDir: '.gev-cache/bdp/tceq-water',
  };

  for (const argument of argv) {
    if (argument.startsWith('--dataset=')) {
      const value = argument.slice('--dataset='.length).trim().toLowerCase();
      options.datasets = value === 'all' ? ['active', 'inactive'] : [value];
    } else if (argument.startsWith('--cache=')) {
      options.cacheDir = argument.slice('--cache='.length);
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function usage() {
  return [
    'BDP TCEQ surface-water-rights downloader',
    '',
    'Usage:',
    '  node scripts/bdp/tceq-water-download.mjs [--dataset=all|active|inactive]',
    '',
    'Files are cached under .gev-cache/bdp/tceq-water by default.',
  ].join('\n');
}

async function fileExists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(filename) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch {
    return null;
  }
}

function conditionalHeaders(manifest) {
  const headers = { accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*' };
  if (manifest?.etag) headers['if-none-match'] = manifest.etag;
  if (manifest?.lastModified) headers['if-modified-since'] = manifest.lastModified;
  return headers;
}

async function downloadDataset(entry, cacheDir, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  await mkdir(cacheDir, { recursive: true });
  const archivePath = path.resolve(cacheDir, entry.filename);
  const manifestPath = `${archivePath}.json`;
  const previous = await readManifest(manifestPath);
  const exists = await fileExists(archivePath);

  const response = await fetchImpl(entry.url, {
    headers: conditionalHeaders(previous),
    redirect: 'follow',
  });

  if (response.status === 304 && exists && previous) {
    return { dataset: entry.dataset, filename: entry.filename, status: 'skipped-unchanged' };
  }
  if (!response.ok) {
    throw new Error(`TCEQ ${entry.dataset} water-right download failed (${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const checksumSha256 = await sha256Hex(bytes);
  const unchanged = exists && previous?.checksumSha256 === checksumSha256;

  if (!unchanged) await writeFile(archivePath, bytes);

  const manifest = {
    sourceId: entry.sourceId,
    dataset: entry.dataset,
    status: entry.status,
    filename: entry.filename,
    url: entry.url,
    sourcePageUrl: entry.sourcePageUrl,
    viewerUrl: entry.viewerUrl,
    viewerItemId: entry.viewerItemId,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    contentLength: Number(response.headers.get('content-length')) || bytes.byteLength,
    checksumSha256,
    checkedAt: new Date().toISOString(),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    dataset: entry.dataset,
    filename: entry.filename,
    status: unchanged ? 'skipped-unchanged' : 'downloaded',
    bytes: bytes.byteLength,
  };
}

export async function runTceqWaterDownload(options = {}) {
  const plan = createTceqWaterRightsIngestionPlan({ datasets: options.datasets });
  const cacheDir = path.resolve(options.cacheDir || '.gev-cache/bdp/tceq-water');
  const results = [];
  for (const entry of plan) results.push(await downloadDataset(entry, cacheDir, options.fetchImpl));
  return results;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
} else {
  try {
    const results = await runTceqWaterDownload(options);
    for (const result of results) {
      console.log(`[BDP:TCEQ] ${result.status} ${result.filename}`);
    }
  } catch (error) {
    console.error(`[BDP:TCEQ] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
