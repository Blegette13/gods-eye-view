/**
 * SERVER / LOCAL-OPERATOR ONLY: document fingerprinting for regulatory research.
 *
 * Intentionally outside browser-built src/ because this module requires Node\u0027s\n * crypto, filesystem and path APIs. Never import from browser entrypoints.\n * No document bytes, file path, or reviewer notes are written to PostGIS.
 * An SHA-256 fingerprint proves which local bytes were indexed; it does NOT
 * authenticate an ordinance, its effective date, or any development right.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, extname } from 'node:path';

export const MAX_REGULATORY_DOCUMENT_BYTES = 32 * 1024 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
const DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.txt', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.docx',
]);

function inside(parent, child) {
  const diff = relative(parent, child);
  return diff !== '' && diff !== '..' &&
    !diff.startsWith('..' + sep) && !isAbsolute(diff);
}

export async function resolvePrivateRegulatoryFile(filePath, {
  projectRoot = process.cwd(),
  maxBytes = MAX_REGULATORY_DOCUMENT_BYTES,
  allowedExtensions = DOCUMENT_EXTENSIONS,
} = {}) {
  if (typeof filePath !== 'string' || filePath !== filePath.trim()
    || !filePath || filePath.includes('\0') || isAbsolute(filePath)) {
    throw new Error('Document must use a relative file path inside .bdp-private');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
    maxBytes > MAX_REGULATORY_DOCUMENT_BYTES) {
    throw new Error('Invalid document size limit');
  }
  const folder = resolve(projectRoot, '.bdp-private');
  const fullPath = resolve(projectRoot, filePath);
  if (!inside(folder, fullPath)) {
    throw new Error('Document must be inside the project .bdp-private directory');
  }
  const rootStat = await lstat(folder);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Private evidence folder must be a real directory, not a link');
  }
  const fileStat = await lstat(fullPath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error('Document must be an ordinary file, not a symlink');
  }
  const realFolder = await realpath(folder);
  const realFile = await realpath(fullPath);
  if (!inside(realFolder, realFile)) {
    throw new Error('Document path resolves outside private evidence directory');
  }
  if (!allowedExtensions.has(extname(realFile).toLowerCase())) {
    throw new Error('Unsupported document extension for local research intake');
  }
  if (fileStat.size < 1 || fileStat.size > maxBytes) {
    throw new Error('Document is empty or exceeds the permitted size');
  }
  return Object.freeze({ fullPath: realFile, size: fileStat.size });
}

export async function fingerprintPrivateRegulatoryDocument(filePath, options = {}) {
  const { fullPath } = await resolvePrivateRegulatoryFile(filePath, options);
  const limit = options.maxBytes ?? MAX_REGULATORY_DOCUMENT_BYTES;
  const handle = await open(fullPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > limit) {
      throw new Error('Document is not a bounded regular file');
    }
    const hash = createHash('sha256');
    let fileBytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      fileBytes += chunk.length;
      if (fileBytes > limit) throw new Error('Document size limit exceeded during read');
      hash.update(chunk);
    }
    const after = await handle.stat();
    if (fileBytes !== before.size || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new Error('Document changed while computing its fingerprint');
    }
    return Object.freeze({
      sourceSha256: hash.digest('hex'),
      fileBytes,
      documentStoredInDatabase: false,
      verificationState: 'unverified',
    });
  } finally {
    await handle.close();
  }
}

export async function readPrivateRegulatoryMetadata(filePath, options = {}) {
  const info = await resolvePrivateRegulatoryFile(filePath, {
    ...options,
    maxBytes: MAX_METADATA_BYTES,
    allowedExtensions: new Set(['.json']),
  });
  const text = await readFile(info.fullPath, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > MAX_METADATA_BYTES) {
    throw new Error('Research metadata exceeds maximum size');
  }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('Research metadata must be valid UTF-8 JSON'); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Research metadata must be a JSON object');
  }
  return parsed;
}
