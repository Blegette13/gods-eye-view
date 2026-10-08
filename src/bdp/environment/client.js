import { BDP_ENVIRONMENT_API_BASE } from './wetlandsContract.js';
import { normalizeTceqMswBounds } from './mswContract.js';

async function readError(response) {
  try {
    const payload = await response.json();
    return payload?.message || payload?.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function fetchParcelEnvironment(path, parcel, { fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  if (!parcel?.property?.geometry) throw new Error('Parcel geometry is required for environmental screening');

  const response = await fetchImpl(`${BDP_ENVIRONMENT_API_BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ geometry: parcel.property.geometry }),
    signal,
  });
  if (!response.ok) {
    const error = new Error(await readError(response));
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  return payload?.metrics || null;
}

export function buildTceqMswFeaturesUrl(boundsInput) {
  const bounds = normalizeTceqMswBounds(boundsInput);
  const params = new URLSearchParams({
    west: String(bounds.west),
    south: String(bounds.south),
    east: String(bounds.east),
    north: String(bounds.north),
  });
  return `${BDP_ENVIRONMENT_API_BASE}/msw-features?${params.toString()}`;
}

export async function fetchTceqMswFeatures(
  bounds,
  { fetchImpl = globalThis.fetch, signal } = {},
) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const response = await fetchImpl(buildTceqMswFeaturesUrl(bounds), {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const error = new Error(await readError(response));
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  if (
    !payload?.points
    || payload.points.type !== 'FeatureCollection'
    || !Array.isArray(payload.points.features)
  ) {
    throw new Error('BDP TCEQ MSW feature service returned malformed GeoJSON');
  }
  return payload;
}

export function fetchBdpParcelWetlands(parcel, options = {}) {
  return fetchParcelEnvironment('wetlands', parcel, options);
}

export function fetchBdpParcelFlood(parcel, options = {}) {
  return fetchParcelEnvironment('flood', parcel, options);
}

export function fetchBdpParcelCleanups(parcel, options = {}) {
  return fetchParcelEnvironment('cleanups', parcel, options);
}

export function fetchBdpParcelMsw(parcel, options = {}) {
  return fetchParcelEnvironment('msw', parcel, options);
}

export default fetchBdpParcelWetlands;
