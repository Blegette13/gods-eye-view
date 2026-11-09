/**
 * Optional Travis County / City of Austin GIS intersection preview.
 *
 * This is one supplemental response inside the UNIFIED parcel screening.
 * It is never a San Antonio zoning replacement and never influences the
 * acquisition score, legal entitlement, or the 13 core source coverage count.
 */
import {
  buildAustinParcelCandidateQueryUrl,
  validateAustinCandidateCollection,
} from '../../src/bdp/entitlement/austinSourceContract.js';
import {
  buildAustinOverlapSql,
  summarizeAustinOverlapQuery,
} from '../../src/bdp/entitlement/austinParcelOverlap.js';
import { queryPostgisJsonStdin } from './bdp-psql.js';

const SOURCE_TIMEOUT_MS = 25_000;
const MAX_SOURCE_BYTES = 8_000_000;

async function fetchCandidates(url, name, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/geo+json,application/json' },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`Austin ${name} request failed (HTTP ${response.status})`);
    error.code = 'AUSTIN_GIS_UPSTREAM_FAILED';
    throw error;
  }
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
    throw new Error(`Austin ${name} response exceeded the size limit`);
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_SOURCE_BYTES) {
    throw new Error(`Austin ${name} response exceeded the size limit`);
  }
  let geojson;
  try { geojson = JSON.parse(raw); }
  catch { throw new Error(`Austin ${name} returned invalid JSON`); }
  validateAustinCandidateCollection(name, geojson);
  return geojson;
}

export async function screenBdpParcelAustinZoning(input, {
  fetchImpl = globalThis.fetch,
  querySql = queryPostgisJsonStdin,
} = {}) {
  if (!input?.geometry) throw new Error('Parcel polygon geometry is required');
  const [zoning, etodOverlay] = await Promise.all([
    fetchCandidates(buildAustinParcelCandidateQueryUrl('zoning', input.geometry), 'zoning', fetchImpl),
    fetchCandidates(buildAustinParcelCandidateQueryUrl('etodOverlay', input.geometry), 'etodOverlay', fetchImpl),
  ]);
  const sql = buildAustinOverlapSql(input.geometry, { zoning, etodOverlay });
  const raw = await querySql(sql, { timeoutMs: 45_000, maxOutputBytes: 2_000_000 });
  const measured = summarizeAustinOverlapQuery(raw);
  return Object.freeze({
    status: 'preliminary-spatial-evidence',
    countyPilot: 'Travis',
    parcelAreaM2: measured.parcelAreaM2,
    sourceCandidates: Object.freeze({
      zoning: zoning.features.length,
      etodOverlay: etodOverlay.features.length,
    }),
    // Keep 0-area envelope hits visible as nonintersecting candidates, not
    // as extra zoning districts actually applying to the full parcel.
    observations: measured.observations,
    sourceCurrencyVerified: false,
    jurisdictionExactOverlapVerified: false,
    legalZoningVerified: false,
    etodAdoptionVerified: false,
    legalEntitlementVerified: false,
    acquisitionRecommendation: null,
    sourceNote: 'GIS parcel polygon intersections only. City jurisdiction, all zoning overlays, current ordinances, permit eligibility and recorded boundaries are not verified.',
  });
}
