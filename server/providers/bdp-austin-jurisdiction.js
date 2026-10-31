/**
 * Optional read-only Austin/Travis municipal jurisdiction GIS preview.
 * Queries ArcGIS server-side against the TCAD parcel ENVELOPE, not citywide
 * polygon downloads. No PostGIS or legal jurisdiction determination.
 */
import {
  buildAustinJurisdictionRelationUrl,
  summarizeAustinJurisdictionRelations,
} from '../../src/bdp/entitlement/austinJurisdictionRelations.js';

const MAX_BYTES = 1_000_000;

async function fetchAttributes(url, label, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const error = new Error(`Austin jurisdiction ${label} request failed (HTTP ${response.status})`);
    error.code = 'AUSTIN_GIS_UPSTREAM_FAILED';
    throw error;
  }
  const size = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(size) && size > MAX_BYTES) {
    throw new Error(`Austin jurisdiction ${label} response is too large`);
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    throw new Error(`Austin jurisdiction ${label} response is too large`);
  }
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`Austin jurisdiction ${label} returned invalid JSON`); }
  return data;
}

export async function screenBdpParcelAustinJurisdiction(input, {
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!input?.geometry) throw new Error('Parcel polygon geometry is required');

  const [intersects, within] = await Promise.all([
    fetchAttributes(buildAustinJurisdictionRelationUrl(
      input.geometry, 'touchesEnvelope'), 'intersects', fetchImpl),
    fetchAttributes(buildAustinJurisdictionRelationUrl(
      input.geometry, 'containsEntireEnvelope'), 'within', fetchImpl),
  ]);
  const result = summarizeAustinJurisdictionRelations(intersects, within);
  return Object.freeze({
    ...result,
    countyPilot: 'Travis',
    basis: 'Austin ArcGIS spatial relationship against TCAD parcel envelope',
    boundarySurveyVerified: false,
    parcelWideControllingJurisdiction: null,
    zoningJurisdictionDetermined: false,
    acquisitionRecommendation: null,
  });
}
