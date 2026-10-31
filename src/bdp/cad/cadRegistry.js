const adapters = new Map();

function normalizeCountyKey(county) {
  return String(county || '')
    .trim()
    .toLowerCase()
    .replace(/\bcounty\b/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-');
}

export function registerCadAdapter(county, adapter) {
  const key = normalizeCountyKey(county);
  if (!key) throw new Error('county is required');
  if (!adapter || typeof adapter.fetchParcel !== 'function') {
    throw new Error('CAD adapter must expose fetchParcel()');
  }
  if (adapters.has(key)) throw new Error(`CAD adapter already registered for ${county}`);
  adapters.set(key, adapter);
  return key;
}

export function getCadAdapter(county) {
  return adapters.get(normalizeCountyKey(county)) || null;
}

export function hasCadAdapter(county) {
  return adapters.has(normalizeCountyKey(county));
}

export function listCadAdapters() {
  return [...adapters.entries()].map(([countyKey, adapter]) => ({
    countyKey,
    id: adapter.id || countyKey,
    source: adapter.source || '',
  }));
}

export function clearCadAdaptersForTests() {
  adapters.clear();
}
