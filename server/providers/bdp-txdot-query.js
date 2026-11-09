import { TXDOT_MAX_VERIFIED_FEATURES } from '../../src/bdp/transportation/txdotContract.js';

const PAGE_SIZE = 400;
const MAX_SOURCE_BYTES = 18 * 1024 * 1024;
const MAX_ID_RESPONSE_BYTES = 1024 * 1024;
const SOURCE_TIMEOUT_MS = 15_000;
const CONCURRENT_PAGES = 4;

function upstreamFailure(message) {
  return Object.assign(new Error(message), { code: 'TXDOT_UPSTREAM_FAILED' });
}

async function requestJson(url, label, { fetchImpl, maxBytes, formParams = null }) {
  const post = formParams instanceof URLSearchParams;
  const response = await fetchImpl(url, {
    method: post ? 'POST' : 'GET',
    headers: {
      accept: 'application/json,application/geo+json',
      ...(post ? { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' } : {}),
    },
    ...(post ? { body: formParams.toString() } : {}),
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) throw upstreamFailure(`${label} request failed (HTTP ${response.status})`);
  const size = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(size) && size > maxBytes) {
    throw upstreamFailure(`${label} response exceeded the byte budget`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw upstreamFailure(`${label} response exceeded the byte budget`);
  }
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw upstreamFailure(`${label} returned invalid JSON`); }
  if (payload?.error) {
    throw upstreamFailure(`${label}: ${String(payload.error.message || 'ArcGIS service error').slice(0, 150)}`);
  }
  return payload;
}

/**
 * A viewport may return >2,000 TxDOT records. To avoid misleading truncation,
 * query ALL matching ArcGIS object IDs first, then fetch their geometries in
 * bounded batches. Do not accept a page unless every requested ID is present
 * exactly once. Object ID inventory can change between requests; fail closed
 * instead of presenting a partial snapshot as complete.
 */
export async function fetchCompleteTxdotCollection(urlText, label, normalize, {
  fetchImpl = globalThis.fetch,
  maxFeatures = TXDOT_MAX_VERIFIED_FEATURES,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const original = new URL(urlText);
  const idQuery = new URL(original);
  idQuery.searchParams.set('returnIdsOnly', 'true');
  idQuery.searchParams.set('returnGeometry', 'false');
  idQuery.searchParams.set('f', 'json');
  idQuery.searchParams.delete('resultRecordCount');
  idQuery.searchParams.delete('resultOffset');
  idQuery.searchParams.delete('outFields');

  const idsPayload = await requestJson(idQuery, label, {
    fetchImpl, maxBytes: MAX_ID_RESPONSE_BYTES,
  });
  const field = idsPayload?.objectIdFieldName;
  const ids = idsPayload?.objectIds;
  if (typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(field)
    || !Array.isArray(ids) || !ids.every(Number.isSafeInteger)) {
    throw upstreamFailure(`${label} returned invalid object ID inventory`);
  }
  if (idsPayload.exceededTransferLimit === true || ids.length > maxFeatures
    || new Set(ids).size !== ids.length) {
    throw upstreamFailure(`${label} has too many, capped, or repeated object IDs; screening cannot claim full coverage`);
  }
  if (ids.length === 0) {
    return normalize({ type: 'FeatureCollection', features: [], bdpFullObjectIdCoverage: true });
  }

  const pages = [];
  for (let index = 0; index < ids.length; index += PAGE_SIZE) {
    pages.push(ids.slice(index, index + PAGE_SIZE));
  }
  const byId = new Map();
  let bytes = 0;
  for (let index = 0; index < pages.length; index += CONCURRENT_PAGES) {
    const group = pages.slice(index, index + CONCURRENT_PAGES);
    const responses = await Promise.all(group.map(async (pageIds) => {
      // A 200-ID GET URL returned HTTP 404 from the public gateway at
      // ~2,227 characters, while 10 IDs (535 chars) succeeded. ArcGIS layer
      // /query supports POST, so send long ID batches as form data, not URLs.
      // Retain every original spatial constraint and field selection.
      const pageParams = new URLSearchParams(original.searchParams);
      pageParams.set('objectIds', pageIds.join(','));
      pageParams.set('resultRecordCount', String(PAGE_SIZE));
      pageParams.set('f', 'geojson');
      const endpoint = new URL(original);
      endpoint.search = '';
      const payload = await requestJson(endpoint, label, {
        fetchImpl, maxBytes: MAX_SOURCE_BYTES, formParams: pageParams,
      });
      if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)
        || payload.exceededTransferLimit === true || payload.features.length !== pageIds.length) {
        throw upstreamFailure(`${label} returned an incomplete or malformed object ID page`);
      }
      const expected = new Set(pageIds);
      const found = new Set();
      for (const feature of payload.features) {
        const featureId = feature?.properties?.[field] ?? feature?.id;
        if (!Number.isSafeInteger(Number(featureId)) || !expected.has(Number(featureId))
          || found.has(Number(featureId))) {
          throw upstreamFailure(`${label} returned missing, repeated or unexpected object IDs`);
        }
        found.add(Number(featureId));
      }
      if (found.size !== expected.size) {
        throw upstreamFailure(`${label} object ID page has missing records`);
      }
      return payload.features;
    }));

    for (const features of responses) {
      for (const feature of features) {
        bytes += Buffer.byteLength(JSON.stringify(feature), 'utf8');
        if (bytes > MAX_SOURCE_BYTES) throw upstreamFailure(`${label} exceeds the GeoJSON byte budget`);
        const objectId = Number(feature.properties?.[field] ?? feature.id);
        byId.set(objectId, feature);
      }
    }
  }
  if (byId.size !== ids.length) throw upstreamFailure(`${label} did not retrieve the full object ID inventory`);
  const completeCollection = {
    type: 'FeatureCollection',
    features: ids.map((id) => byId.get(id)),
    bdpFullObjectIdCoverage: true,
  };
  return normalize(completeCollection);
}
