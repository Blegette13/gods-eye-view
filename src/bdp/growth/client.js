const API_BASE = '/api/bdp/growth';

async function readError(response) {
  try {
    const payload = await response.json();
    return payload?.message || payload?.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function fetchBdpParcelGrowthRadar(
  parcel,
  { fetchImpl = globalThis.fetch, signal } = {},
) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const geometry = parcel?.property?.geometry || parcel?.geometry;
  if (!geometry) throw new Error('Parcel geometry is required for Growth Radar');

  const response = await fetchImpl(`${API_BASE}/screen`, {
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

export default fetchBdpParcelGrowthRadar;
