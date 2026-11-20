import { queryPostgisJsonStdin } from './bdp-psql.js';
import { fetchCompleteTxdotCollection } from './bdp-txdot-query.js';
import {
  buildTxdotParcelMetricsSql,
  buildTxdotParcelQueryUrls,
  normalizeTxdotAadt,
  normalizeTxdotAadtHistory,
  normalizeTxdotRoadways,
} from '../../src/bdp/transportation/txdotContract.js';

const API_BASE = '/api/bdp/transportation';
const MAX_BODY_BYTES = 1_000_000;
const MAX_SOURCE_RESPONSE_BYTES = 18 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 30_000;

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body.trim()) throw new Error('JSON request body is required');
  return JSON.parse(body);
}

function queryPostgisJson(sql) {
  return queryPostgisJsonStdin(sql, {
    timeoutMs: QUERY_TIMEOUT_MS,
    maxOutputBytes: MAX_SOURCE_RESPONSE_BYTES,
  });
}

export async function screenBdpParcelTransportation(input, {
  fetchSource = fetchCompleteTxdotCollection,
  query = queryPostgisJson,
} = {}) {
  const urls = buildTxdotParcelQueryUrls(input);
  const [roadways, aadt, history] = await Promise.all([
    fetchSource(urls.roadways, 'TxDOT roadways', normalizeTxdotRoadways),
    fetchSource(urls.aadt, 'TxDOT AADT', normalizeTxdotAadt),
    fetchSource(urls.history, 'TxDOT AADT history', normalizeTxdotAadtHistory),
  ]);
  const metrics = await query(buildTxdotParcelMetricsSql(input, {
    roadways,
    aadt,
    history,
  }));

  return Object.freeze({
    sourceFeatureCounts: Object.freeze({
      roadways: roadways.features.length,
      aadt: aadt.features.length,
      history: history.features.length,
    }),
    metrics,
  });
}

function publicError(error) {
  if (error?.code === 'BDP_POSTGIS_NOT_CONFIGURED' || error?.code === 'ENOENT') {
    return {
      status: 503,
      payload: {
        error: 'bdp_postgis_unavailable',
        message: 'TxDOT parcel access/traffic screening requires the BDP PostGIS service.',
      },
    };
  }
  if (error?.code === 'TXDOT_UPSTREAM_FAILED' || ['TimeoutError', 'AbortError'].includes(error?.name)) {
    return {
      status: 502,
      payload: {
        error: 'txdot_upstream_unavailable',
        message: 'TxDOT GIS data could not be reached for this screening request.',
      },
    };
  }
  if (error instanceof SyntaxError) {
    return { status: 400, payload: { error: 'invalid_json', message: 'The request body must be valid JSON.' } };
  }
  const message = String(error?.message || '');
  if (
    message.includes('required')
    || message.includes('geometry')
    || message.includes('WGS84')
    || message.includes('too complex')
    || message.includes('capped')
  ) {
    return { status: 400, payload: { error: 'invalid_request', message } };
  }
  return {
    status: 500,
    payload: {
      error: 'bdp_transportation_query_failed',
      message: 'The BDP TxDOT screening query could not be completed.',
    },
  };
}

async function handleTransportation(request, response, next) {
  const url = new URL(request.url || '/', 'http://localhost');
  if (!url.pathname.startsWith(API_BASE)) return next();

  try {
    if (url.pathname !== `${API_BASE}/screen`) {
      return sendJson(response, 404, { error: 'not_found' });
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { error: 'method_not_allowed' });
    }

    const input = await readJsonBody(request);
    const result = await screenBdpParcelTransportation(input);

    return sendJson(response, 200, {
      source: 'Texas Department of Transportation GRID / Traffic Monitoring Program',
      screeningOnly: true,
      ...result,
    });
  } catch (error) {
    const { status, payload } = publicError(error);
    if (status >= 500) console.warn('[BDP:Transportation Provider]', error?.message || error);
    return sendJson(response, status, payload);
  }
}

function install(server) {
  server.middlewares.use(handleTransportation);
}

export function bdpTransportationProviderPlugin() {
  return {
    name: 'bdp-transportation-provider',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default bdpTransportationProviderPlugin;
