import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  resolveRrcCountyArchive,
  sha256Hex,
} from '../../src/bdp/ingestion/rrcDownloader.js';

function parseArgs(argv) {
  const options = {
    county: '029',
    datasets: ['wells', 'pipelines'],
    outDir: '.gev-cache/bdp/rrc',
  };

  for (const argument of argv) {
    if (argument.startsWith('--county=')) {
      options.county = argument.slice('--county='.length);
    } else if (argument.startsWith('--dataset=')) {
      const value = argument.slice('--dataset='.length).trim().toLowerCase();
      options.datasets = value === 'all' ? ['wells', 'pipelines'] : [value];
    } else if (argument.startsWith('--out=')) {
      options.outDir = argument.slice('--out='.length);
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
    'BDP RRC downloader',
    '',
    'Usage:',
    '  node scripts/bdp/rrc-download.mjs [--county=029] [--dataset=all|wells|pipelines] [--out=.gev-cache/bdp/rrc]',
    '',
    'Examples:',
    '  node scripts/bdp/rrc-download.mjs --county=029',
    '  node scripts/bdp/rrc-download.mjs --county=48029 --dataset=pipelines',
  ].join('\n');
}

async function readManifest(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function conditionalHeaders(manifest) {
  const headers = {
    accept: 'application/zip,application/octet-stream,*/*',
    'user-agent': 'BDP-Land-Intelligence/0.1 (+official-public-data-ingestion)',
  };
  if (manifest?.etag) headers['if-none-match'] = manifest.etag;
  if (manifest?.lastModified) headers['if-modified-since'] = manifest.lastModified;
  return headers;
}

async function downloadDataset({ dataset, county, outDir, fetchImpl = globalThis.fetch }) {
  const resolved = await resolveRrcCountyArchive({
    dataset,
    countyFips: county,
    fetchImpl,
  });

  const countyDir = path.resolve(outDir, resolved.countyFips);
  await mkdir(countyDir, { recursive: true });
  const archivePath = path.join(countyDir, resolved.filename);
  const manifestPath = `${archivePath}.json`;
  const previous = await readManifest(manifestPath);

  const response = await fetchImpl(resolved.downloadUrl, {
    headers: conditionalHeaders(previous),
    redirect: 'follow',
  });

  if (response.status === 304) {
    return {
      status: 'skipped-unchanged',
      archivePath,
      manifestPath,
      filename: resolved.filename,
      checksumSha256: previous?.checksumSha256 || null,
    };
  }

  if (!response.ok) {
    throw new Error(`RRC archive download failed (${response.status}) for ${resolved.filename}`);
  }

  const bytes = await response.arrayBuffer();
  const checksumSha256 = await sha256Hex(bytes);
  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  const unchanged = previous?.checksumSha256 === checksumSha256;

  if (!unchanged) await writeFile(archivePath, new Uint8Array(bytes));

  const manifest = {
    source: 'Railroad Commission of Texas',
    dataset: resolved.dataset,
    countyFips: resolved.countyFips,
    filename: resolved.filename,
    folderUrl: resolved.folderUrl,
    resolvedDownloadUrl: response.url || resolved.downloadUrl,
    etag,
    lastModified,
    contentLength: Number(response.headers.get('content-length')) || bytes.byteLength,
    checksumSha256,
    checkedAt: new Date().toISOString(),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    status: unchanged ? 'skipped-unchanged' : 'downloaded',
    archivePath,
    manifestPath,
    filename: resolved.filename,
    checksumSha256,
  };
}

export async function runRrcDownload(options = {}) {
  const county = options.county || '029';
  const datasets = options.datasets || ['wells', 'pipelines'];
  const outDir = options.outDir || '.gev-cache/bdp/rrc';
  const results = [];

  for (const dataset of datasets) {
    results.push(await downloadDataset({ dataset, county, outDir }));
  }

  return results;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
} else {
  try {
    const results = await runRrcDownload(options);
    for (const result of results) {
      console.log(`[BDP:RRC] ${result.status} ${result.filename} -> ${result.archivePath}`);
    }
  } catch (error) {
    console.error(`[BDP:RRC] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
