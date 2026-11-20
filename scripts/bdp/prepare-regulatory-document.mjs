/**
 * Step 44: Local document provenance for a BDP parcel due-diligence task.
 * Dry run by default; hashes original document bytes in .bdp-private.
 * No uploaded file, browser route or document approval is created.
 *
 * Usage:
 *   node scripts/bdp/prepare-regulatory-document.mjs --template
 *   node scripts/bdp/prepare-regulatory-document.mjs --document .bdp-private/ordinance.pdf --meta .bdp-private/ordinance.json
 *   node scripts/bdp/prepare-regulatory-document.mjs --document .bdp-private/ordinance.pdf --meta .bdp-private/ordinance.json --commit
 */
import { pathToFileURL } from 'node:url';
import { queryPostgisJsonStdin } from '../../server/providers/bdp-psql.js';
import {
  fingerprintPrivateRegulatoryDocument,
  readPrivateRegulatoryMetadata,
} from '../../server/providers/bdp-document-integrity.js';
import {
  prepareRegulatoryEvidenceInsert,
  validateRegulatoryEvidenceInsertResult,
} from '../../src/bdp/regulatory/evidenceIntake.js';

const TEMPLATE = Object.freeze({
  countyFips: '48453',
  parcelId: 'REPLACE_WITH_OFFICIAL_PARCEL_ID',
  taskId: 'verify-zoning-designation',
  eventType: 'document-indexed',
  sourceUrl: 'https://www.austintexas.gov/REPLACE_WITH_ORIGINAL_PUBLIC_SOURCE_URL',
  sourceTitle: 'REPLACE: exact official document title',
  sourceDate: null,
  notes: 'REPLACE: describe provenance without asserting legal clearance.',
  enteredBy: 'REPLACE_WITH_LOCAL_OPERATOR_IDENTIFIER',
});

export async function runLocalRegulatoryDocumentIntake(argv, {
  loadMetadata = readPrivateRegulatoryMetadata,
  fingerprint = fingerprintPrivateRegulatoryDocument,
  query = queryPostgisJsonStdin,
  print = console.log,
} = {}) {
  if (argv.length === 1 && argv[0] === '--template') {
    print('BDP local-only document metadata template. No database or document change.');
    print(JSON.stringify(TEMPLATE, null, 2));
    return Object.freeze({ mode: 'template' });
  }
  if (!(argv.length === 4 || argv.length === 5) ||
    argv[0] !== '--document' || argv[2] !== '--meta' ||
    (argv.length === 5 && argv[4] !== '--commit')) {
    throw new Error('Usage: --template OR --document .bdp-private/document.pdf --meta .bdp-private/metadata.json [--commit]');
  }
  const metadata = await loadMetadata(argv[3]);
  if (metadata?.eventType !== 'document-indexed' ||
    Object.hasOwn(metadata, 'sourceSha256')) {
    throw new Error('Document metadata must be document-indexed; checksum must be computed from the original file, never supplied manually');
  }
  const fingerprintResult = await fingerprint(argv[1]);
  const event = { ...metadata, sourceSha256: fingerprintResult.sourceSha256 };
  const { sql, preview } = prepareRegulatoryEvidenceInsert(event);
  const mode = argv.length === 5 ? 'commit' : 'dry-run';
  print('BDP · LOCAL document evidence · ' + mode.toUpperCase());
  print(JSON.stringify({
    ...preview,
    fileBytes: fingerprintResult.fileBytes,
    sourceSha256: fingerprintResult.sourceSha256,
    documentStoredInDatabase: false,
  }, null, 2));
  if (mode === 'dry-run') {
    print('No database changes; original document remains in .bdp-private. Document origin/effective status NOT verified.');
    return Object.freeze({ mode, preview, sourceSha256: fingerprintResult.sourceSha256 });
  }
  if (!process.env.BDP_PG_SERVICE) {
    throw new Error('BDP_PG_SERVICE is not configured in this PowerShell session');
  }
  const receipt = validateRegulatoryEvidenceInsertResult(
    await query(sql, { timeoutMs: 20_000, maxOutputBytes: 8192 }), event,
  );
  print('APPENDED · document fingerprint and metadata only · NOT legal zoning or development clearance');
  print(JSON.stringify(receipt, null, 2));
  return Object.freeze({ mode, receipt });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalRegulatoryDocumentIntake(process.argv.slice(2)).catch((error) => {
    // Never print private file paths, notes, raw SQL, source URLs or database errors.
    console.error('BDP private document intake unavailable · ' +
      (error?.code || 'INVALID_DOCUMENT_OR_LOCAL_DB') +
      '. Check the .bdp-private files, metadata, and local PostGIS settings.');
    process.exitCode = 1;
  });
}
