/**
 * Read-only PostGIS test of actual TCAD parcel 302959 against Austin zoning
 * and ETOD candidate polygons. Requires existing BDP_PG_SERVICE and
 * PGSERVICEFILE in the shell. Never establishes legal zoning or land use.
 *
 * node scripts/bdp/diagnose-austin-overlap.mjs 302959
 */
import { travisCadAdapter } from '../../src/bdp/cad/travisAdapter.js';
import {
  buildAustinParcelCandidateQueryUrl,
  validateAustinCandidateCollection,
} from '../../src/bdp/entitlement/austinSourceContract.js';
import {
  buildAustinOverlapSql,
  summarizeAustinOverlapQuery,
} from '../../src/bdp/entitlement/austinParcelOverlap.js';
import { queryPostgisJsonStdin } from '../../server/providers/bdp-psql.js';

const propertyId = process.argv[2] || '302959';
if (!/^\d{1,18}$/.test(propertyId)) throw new Error('Provide a numeric Travis TCAD parcel ID');
console.log('BDP · Austin parcel/zoning GIS overlap · READ ONLY · legal status UNKNOWN');

async function fetchCollection(url, name) {
  const response = await fetch(url, {
    headers: { accept: 'application/geo+json,application/json' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 8_000_000) throw new Error(name + ': response exceeds budget');
  let collection;
  try { collection = JSON.parse(raw); }
  catch { throw new Error(name + ': invalid JSON'); }
  validateAustinCandidateCollection(name, collection);
  return collection;
}

if (!process.env.BDP_PG_SERVICE) {
  console.log('UNAVAILABLE · BDP_PG_SERVICE is missing in this PowerShell session.');
  console.log('Run this in the session previously configured for local PostGIS.');
  process.exit(0);
}

try {
  const parcel = await travisCadAdapter.fetchParcel(propertyId, {
    signal: AbortSignal.timeout(25_000),
  });
  if (!parcel?.property?.geometry) throw new Error('Travis parcel geometry not available');
  console.log('PARCEL ' + JSON.stringify({
    county: parcel.county,
    parcelId: parcel.parcelId,
    boundarySource: 'Travis County GIS / TCAD · no boundary survey',
    sourceRecordCurrency: parcel.source.recordCurrency,
  }));

  const [zoning, etodOverlay] = await Promise.all([
    fetchCollection(buildAustinParcelCandidateQueryUrl('zoning', parcel.property.geometry), 'zoning'),
    fetchCollection(buildAustinParcelCandidateQueryUrl('etodOverlay', parcel.property.geometry), 'etodOverlay'),
  ]);
  console.log('UPSTREAM ' + JSON.stringify({
    zoningCandidateCount: zoning.features.length,
    etodCandidateCount: etodOverlay.features.length,
    sourceQueryComplete: true,
  }));

  // PostGIS performs actual polygon intersections (not envelope or centroid).
  // The SQL streams over stdin, avoiding Windows command-length restrictions.
  const sql = buildAustinOverlapSql(parcel.property.geometry, { zoning, etodOverlay });
  const metrics = await queryPostgisJsonStdin(sql, {
    timeoutMs: 45_000,
    maxOutputBytes: 2_000_000,
  });
  const summary = summarizeAustinOverlapQuery(metrics);
  console.log('POSTGIS ' + JSON.stringify({
    status: summary.status,
    parcelAreaM2: summary.parcelAreaM2,
    overlaps: summary.observations.map((item) => ({
      source: item.sourceName,
      attributes: item.attributes,
      touchesOrIntersectsParcel: item.intersectsParcel,
      intersectAreaM2: Number(item.areaM2.toFixed(2)),
      percentOfParcel: Number(item.parcelPercent.toFixed(2)),
    })),
    sourceTotalsNotSummed: summary.sourceTotalsNotSummed,
    legalZoningVerified: summary.legalZoningVerified,
    legalJurisdictionVerified: summary.legalJurisdictionVerified,
    sourceCurrencyVerified: summary.sourceCurrencyVerified,
    acquisitionRecommendation: summary.acquisitionRecommendation,
  }, null, 2));
  console.log('DONE · Preliminary GIS geometry evidence only. No legal zoning/ETOD/permit determination.');
} catch (error) {
  console.log('UNAVAILABLE ' + JSON.stringify({
    code: String(error.code || 'GIS_OR_DATABASE_ERROR'),
    reason: String(error.message || error).slice(0, 250),
    // Do not print connection strings or credentials. For psql failures,
    // a generic code is sufficient for the first troubleshooting step.
    legalZoningVerified: false,
    acquisitionRecommendation: null,
  }));
  process.exitCode = 1;
}
