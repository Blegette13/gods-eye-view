import { BDP_TERRAIN_API_BASE } from './terrainContract.js';

async function readError(response) {
  try {
    const payload = await response.json();
    return payload?.message || payload?.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function fetchBdpParcelTerrain(parcel, { fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  if (!parcel?.property?.geometry) throw new Error('Parcel geometry is required for terrain screening');

  const response = await fetchImpl(`${BDP_TERRAIN_API_BASE}/screening`, {
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

export default fetchBdpParcelTerrain;
