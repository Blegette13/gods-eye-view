/**
 * BDP local, operator-controlled evidence journal intake.
 *
 * Usage:
 *   node scripts/bdp/prepare-regulatory-evidence.mjs --template
 *   node scripts/bdp/prepare-regulatory-evidence.mjs --file .\\my-evidence.json
 *   node scripts/bdp/prepare-regulatory-evidence.mjs --file .\\my-evidence.json --commit
 *
 * Dry run by default. --commit is an explicit local INSERT into an
 * unverified, append-only research journal, not a task approval.
 * NEVER expose this CLI as an unauthenticated web endpoint.
 */
import { readFile } from 'node:fs/promises';
import { queryPostgisJsonStdin } from '../../server/providers/bdp-psql.js';
import {
  prepareRegulatoryEvidenceInsert,
  validateRegulatoryEvidenceInsertResult,
} from '../../src/bdp/regulatory/evidenceIntake.js';

const MAX_INPUT_BYTES = 16_384;
const TEMPLATE = Object.freeze({
  countyFips: '48453',
  parcelId: 'REPLACE_WITH_OFFICIAL_PARCEL_ID',
  taskId: 'verify-zoning-designation',
  eventType: 'review-note',
  sourceUrl: null,
  sourceTitle: null,
  sourceDate: null,
  sourceSha256: null,
  notes: 'REPLACE: research observation; never assert legal clearance.',
  enteredBy: 'REPLACE_WITH_LOCAL_OPERATOR_IDENTIFIER',
});

export async function readLocalResearchEvent(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.startsWith('-')) {
    throw new Error('Provide one local JSON file after --file');
  }
  const bytes = await readFile(filePath);
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error('Local evidence input exceeds 16 KiB maximum');
  }
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Local evidence input must be valid UTF-8 JSON'); }
  return parsed;
}

export async function runLocalRegulatoryEvidenceIntake(argv, {
  query = queryPostgisJsonStdin,
  load = readLocalResearchEvent,
  print = console.log,
} = {}) {
  if (argv.length === 1 && argv[0] === '--template') {
    print('Local-only template: replace all placeholders and use your own research notes. No database change.');
    print(JSON.stringify(TEMPLATE, null, 2));
    return Object.freeze({ mode: 'template' });
  }
  if (!((argv.length === 2 || argv.length === 3)
    && argv[0] === '--file' && (argv.length === 2 || argv[2] === '--commit'))) {
    throw new Error('Usage: --template OR --file path.json [--commit]');
  }
  const input = await load(argv[1]);
  const { sql, preview } = prepareRegulatoryEvidenceInsert(input);
  const mode = argv.length === 3 ? 'commit' : 'dry-run';
  print('BDP · LOCAL regulatory evidence intake · ' + mode.toUpperCase());
  print(JSON.stringify(preview, null, 2));
  if (mode === 'dry-run') {
    print('No database changes. To append an UNVERIFIED research note, repeat with --commit.');
    return Object.freeze({ mode, preview });
  }
  if (!process.env.BDP_PG_SERVICE) {
    throw new Error('BDP_PG_SERVICE must be configured in this local PowerShell session');
  }
  const result = validateRegulatoryEvidenceInsertResult(
    await query(sql, { timeoutMs: 20_000, maxOutputBytes: 8192 }), input,
  );
  print('APPENDED · research record only · NOT a verified land-use or legal determination');
  print(JSON.stringify(result, null, 2));
  return Object.freeze({ mode, result });
}

if (process.argv[1] && import.meta.url === new URL('file://' +
    process.argv[1].replaceAll('\\', '/')).href) {
  runLocalRegulatoryEvidenceIntake(process.argv.slice(2)).catch((error) => {
    // Do not leak SQL, notes, source URLs, psql stderr or credentials.
    console.error('BDP local evidence intake unavailable · ' +
      (error?.code || 'REVIEW_INPUT_OR_POSTGIS_CONFIG') +
      '. Check local JSON, database connection and ledger migration.');
    process.exitCode = 1;
  });
}
