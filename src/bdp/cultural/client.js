import {
  BDP_CULTURAL_API_BASE,
  buildThcCemeteryViewportQueryUrl,
  normalizeThcCemeteryFeatureCollection,
} from './cemeteryContract.js';

async function readError(response) {
  try {
    const payload = await response.json();
    return payload?.message || payload?.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function fetchBdpParcelCemeteries(
  parcel,
  { fetchImpl = globalThis.fetch, signal } = {},
) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const geometry = parcel?.property?.geometry || parcel?.geometry;
  if (!geometry) throw new Error('Parcel geometry is required for cemetery screening');

  const response = await fetchImpl(`${BDP_CULTURAL_API_BASE}/cemeteries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ geometry }),
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

export async function fetchThcCemeteryFeatures(
  bounds,
  { fetchImpl = globalThis.fetch, signal } = {},
) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const response = await fetchImpl(buildThcCemeteryViewportQueryUrl(bounds), {
    headers: { accept: 'application/geo+json,application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`THC cemetery service returned HTTP ${response.status}`);
  return normalizeThcCemeteryFeatureCollection(await response.json());
}

export default fetchBdpParcelCemeteries;
