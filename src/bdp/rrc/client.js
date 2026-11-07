import { BDP_RRC_API_BASE, normalizeRrcBounds } from './apiContract.js';

function assertFeatureCollection(value, label) {
  if (!value || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw new Error(`${label} is not a GeoJSON FeatureCollection`);
  }
  return value;
}

async function readJsonResponse(response, label) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${label} returned malformed JSON`);
  }
  if (!response.ok) {
    const message = payload?.message || `${label} returned HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.error || null;
    throw error;
  }
  return payload;
}

export function buildRrcFeaturesUrl(boundsInput, { countyFips = null } = {}) {
  const bounds = normalizeRrcBounds(boundsInput);
  const params = new URLSearchParams({
    west: String(bounds.west),
    south: String(bounds.south),
    east: String(bounds.east),
    north: String(bounds.north),
  });
  if (countyFips) params.set('countyFips', String(countyFips));
  return `${BDP_RRC_API_BASE}/features?${params.toString()}`;
}

export async function fetchRrcFeatures(bounds, {
  countyFips = null,
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const response = await fetchImpl(buildRrcFeaturesUrl(bounds, { countyFips }), { signal });
  const payload = await readJsonResponse(response, 'BDP RRC feature service');
  assertFeatureCollection(payload?.wells, 'RRC wells');
  assertFeatureCollection(payload?.pipelines, 'RRC pipelines');
  return payload;
}

export async function fetchBdpParcelEnergy(parcel, {
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const geometry = parcel?.property?.geometry;
  if (!geometry) throw new Error('Parcel geometry is required for RRC screening');

  const response = await fetchImpl(`${BDP_RRC_API_BASE}/energy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      countyFips: parcel?.countyFips || null,
      geometry,
    }),
    signal,
  });
  const payload = await readJsonResponse(response, 'BDP RRC energy service');
  return payload?.metrics || null;
}
