import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BDP_CULTURAL_API_BASE,
  buildThcCemeteryMetricsSql,
  buildThcCemeteryParcelQueryUrl,
  normalizeThcCemeteryFeatureCollection,
} from '../../src/bdp/cultural/cemeteryContract.js';

const execFileAsync = promisify(execFile);
const MAX_BODY_BYTES = 1_000_000;
const MAX_SOURCE_RESPONSE_BYTES = 18 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 20_000;
const SOURCE_TIMEOUT_MS = 15_000;

function configuredService() {
  const service = String(process.env.BDP_PG_SERVICE || '').trim();
  return /^[A-Za-z0-9_.-]+$/.test(service) ? service : null;
}

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
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) throw new Error('JSON request body is required');
  return JSON.parse(text);
}

async function queryPostgisJson(sql) {
  const service = configuredService();
  if (!service) {
    const error = new Error('BDP PostGIS is not configured');
    error.code = 'BDP_POSTGIS_NOT_CONFIGURED';
    throw error;
  }

  const { stdout } = await execFileAsync('psql', [
    `service=${service}`,
    '-v',
    'ON_ERROR_STOP=1',
    '--tuples-only',
    '--no-align',
    '--command',
    sql,
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: MAX_SOURCE_RESPONSE_BYTES,
    timeout: QUERY_TIMEOUT_MS,
  });

  const text = String(stdout || '').trim();
  return text ? JSON.parse(text) : null;
}

async function fetchCemeteryFeatures(input) {
  const response = await fetch(buildThcCemeteryParcelQueryUrl(input), {
    headers: { accept: 'application/geo+json,application/json' },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`THC cemetery service request failed (${response.status})`);
    error.code = 'THC_CEMETERY_UPSTREAM_FAILED';
    throw error;
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_RESPONSE_BYTES) {
    throw new Error('THC cemetery response is too large');
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_SOURCE_RESPONSE_BYTES) {
    throw new Error('THC cemetery response is too large');
  }

  return normalizeThcCemeteryFeatureCollection(JSON.parse(text));
}

export async function screenBdpParcelCemeteries(input) {
  const sourceFeatures = await fetchCemeteryFeatures(input);
  const metrics = await queryPostgisJson(
    buildThcCemeteryMetricsSql(input, sourceFeatures),
  );
  return Object.freeze({
    sourceFeatureCount: sourceFeatures.features.length,
    metrics,
  });
}

function publicError(error) {
  if (error?.code === 'BDP_POSTGIS_NOT_CONFIGURED' || error?.code === 'ENOENT') {
    return {
      status: 503,
      payload: {
        error: 'bdp_postgis_unavailable',
        message: 'Cemetery screening requires the BDP PostGIS service.',
      },
    };
  }
  if (
    error?.code === 'THC_CEMETERY_UPSTREAM_FAILED'
    || ['TimeoutError', 'AbortError'].includes(error?.name)
  ) {
    return {
      status: 502,
      payload: {
        error: 'thc_cemetery_upstream_unavailable',
        message: 'The public Texas Historical Commission cemetery service is unavailable.',
      },
    };
  }
  if (error instanceof SyntaxError) {
    return {
      status: 400,
      payload: { error: 'invalid_json', message: 'The request body must be valid JSON.' },
    };
  }

  const message = String(error?.message || '');
  if (
    message.includes('required')
    || message.includes('geometry')
    || message.includes('WGS84')
    || message.includes('complex')
    || message.includes('capped')
    || message.includes('body is too large')
  ) {
    return { status: 400, payload: { error: 'invalid_request', message } };
  }

  return {
    status: 500,
    payload: {
      error: 'bdp_cemetery_query_failed',
      message: 'The BDP cemetery screening request could not be completed.',
    },
  };
}

async function handleCultural(request, response, next) {
  const url = new URL(request.url || '/', 'http://localhost');
  if (!url.pathname.startsWith(BDP_CULTURAL_API_BASE)) return next();

  try {
    if (url.pathname !== `${BDP_CULTURAL_API_BASE}/cemeteries`) {
      return sendJson(response, 404, { error: 'not_found' });
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { error: 'method_not_allowed' });
    }

    const input = await readJsonBody(request);
    const result = await screenBdpParcelCemeteries(input);
    return sendJson(response, 200, {
      source: 'Texas Historical Commission Historic Sites Atlas · public cemetery polygons',
      screeningOnly: true,
      archaeologyPublicScreenStatus: 'restricted-location-data-not-screened',
      ...result,
    });
  } catch (error) {
    const { status, payload } = publicError(error);
    if (status >= 500) console.warn('[BDP:Cultural Provider]', error?.message || error);
    return sendJson(response, status, payload);
  }
}

function install(server) {
  server.middlewares.use(handleCultural);
}

export function bdpCulturalProviderPlugin() {
  return {
    name: 'bdp-cultural-provider',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default bdpCulturalProviderPlugin;
