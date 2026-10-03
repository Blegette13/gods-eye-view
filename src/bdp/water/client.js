import { BDP_WATER_API_BASE } from './apiContract.js';

async function readJsonResponse(response, label) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${label} returned malformed JSON`);
  }

  if (!response.ok) {
    const error = new Error(payload?.message || `${label} returned HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.error || null;
    throw error;
  }

  return payload;
}

export async function fetchBdpParcelWaterRights(
  parcel,
  { signal, fetchImpl = globalThis.fetch } = {},
) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const geometry = parcel?.property?.geometry || parcel?.geometry;
  if (!geometry) throw new Error('Parcel geometry is required for TCEQ water-right screening');

  const response = await fetchImpl(`${BDP_WATER_API_BASE}/rights`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ geometry }),
    signal,
  });

  const payload = await readJsonResponse(response, 'BDP TCEQ water-right service');
  return payload?.metrics || null;
}

export default fetchBdpParcelWaterRights;
