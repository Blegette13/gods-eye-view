/**
 * Local operator-only, read-only query of indexed regulatory research.
 *
 * Usage:
 *   node scripts/bdp/inspect-regulatory-evidence.mjs 48453 302959
 *
 * Requires working BDP_PG_SERVICE and PGSERVICEFILE/PGPASSWORD in THIS shell.
 * No HTTP endpoint; no arbitrary SQL; no source URLs, free-text notes or
 * reviewer names printed. This is not legal or zoning clearance.
 */
import { queryPostgisJsonStdin } from '../../server/providers/bdp-psql.js';
import {
  buildRegulatoryEvidenceIndexSql,
  validateRegulatoryEvidenceIndexResult,
  validateRegulatoryLedgerScope,
} from '../../src/bdp/regulatory/evidenceIndex.js';

async function main() {
  const [countyFips, parcelId, extra] = process.argv.slice(2);
  if (extra || !countyFips || !parcelId) {
    throw new Error('Usage: node scripts/bdp/inspect-regulatory-evidence.mjs 48453 302959');
  }
  const scope = validateRegulatoryLedgerScope({ countyFips, parcelId });
  if (!process.env.BDP_PG_SERVICE) {
    throw new Error('BDP_PG_SERVICE is not configured in this PowerShell session');
  }
  const sql = buildRegulatoryEvidenceIndexSql(scope);
  const raw = await queryPostgisJsonStdin(sql, {
    timeoutMs: 20_000, maxOutputBytes: 200_000,
  });
  const result = validateRegulatoryEvidenceIndexResult(raw, scope);
  console.log('BDP · local regulatory evidence index · READ ONLY');
  console.log(JSON.stringify(result, null, 2));
  console.log('Research entries never verify zoning, jurisdiction, permits, buildability, or acquisition suitability.');
  console.log('No document ingestion or public API is enabled.');
}

main().catch((error) => {
  // No raw SQL, psql environment, connection strings, notes or credentials.
  console.error('UNAVAILABLE · ' + (error?.code || 'BDP_EVIDENCE_INDEX_ERROR') +
    ' · verify local PostGIS and the ledger migration / query permissions.');
  process.exitCode = 1;
});
