import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BDP_ENVIRONMENT_API_BASE,
  buildNwiOverlapSql,
  buildNwiParcelQueryUrl,
  normalizeNwiFeatureCollection,
  normalizeWetlandsParcelRequest,
} from '../../src/bdp/environment/wetlandsContract.js';
import {
  buildFemaOverlapSql,
  buildFemaParcelQueryUrl,
  normalizeFemaFeatureCollection,
} from '../../src/bdp/environment/floodContract.js';

const execFileAsync = promisify(execFile);
const MAX_BODY_BYTES = 1_000_000;
const MAX_SOURCE_RESPONSE_BYTES = 16 * 1024 * 1024;
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

async function fetchBoundedGeoJson(url, { sourceLabel, errorCode, normalize }) {
  const response = await fetch(url, {
    headers: { accept: 'application/geo+json,application/json' },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`${sourceLabel} request failed (${response.status})`);
    error.code = errorCode;
    throw error;
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_RESPONSE_BYTES) {
    throw new Error(`${sourceLabel} response is too large`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_SOURCE_RESPONSE_BYTES) {
    throw new Error(`${sourceLabel} response is too large`);
  }
  return normalize(JSON.parse(text));
}

async function fetchNwiParcelFeatures(parcelInput) {
  normalizeWetlandsParcelRequest(parcelInput);
  return fetchBoundedGeoJson(buildNwiParcelQueryUrl(parcelInput), {
    sourceLabel: 'USFWS NWI',
    errorCode: 'NWI_UPSTREAM_FAILED',
    normalize: normalizeNwiFeatureCollection,
  });
}

async function fetchFemaParcelFeatures(parcelInput) {
  normalizeWetlandsParcelRequest(parcelInput);
  return fetchBoundedGeoJson(buildFemaParcelQueryUrl(parcelInput), {
    sourceLabel: 'FEMA NFHL',
    errorCode: 'FEMA_UPSTREAM_FAILED',
    normalize: normalizeFemaFeatureCollection,
  });
}

function publicError(error) {
  if (error?.code === 'BDP_POSTGIS_NOT_CONFIGURED' || error?.code === 'ENOENT') {
    return {
      status: 503,
      payload: {
        error: 'bdp_postgis_unavailable',
        message: 'Parcel acreage screening requires the BDP PostGIS service.',
      },
    };
  }
  if (error?.code === 'NWI_UPSTREAM_FAILED' || error?.code === 'FEMA_UPSTREAM_FAILED' || ['TimeoutError', 'AbortError'].includes(error?.name)) {
    const source = error?.code === 'FEMA_UPSTREAM_FAILED' ? 'FEMA NFHL' : 'USFWS NWI';
    return {
      status: 502,
      payload: {
        error: 'environment_upstream_unavailable',
        message: `${source} could not be reached for this screening request.`,
      },
    };
  }
  if (error instanceof SyntaxError) {
    return { status: 400, payload: { error: 'invalid_json', message: 'The request body must be valid JSON.' } };
  }

  const message = String(error?.message || '');
  if (
    message.includes('must be')
    || message.includes('required')
    || message.includes('geometry')
    || message.includes('WGS84')
    || message.includes('too complex')
    || message.includes('span')
  ) {
    return { status: 400, payload: { error: 'invalid_request', message } };
  }

  return {
    status: 500,
    payload: {
      error: 'bdp_environment_query_failed',
      message: 'The BDP environmental screening query could not be completed.',
    },
  };
}

async function handleBdpEnvironment(request, response, next) {
  const url = new URL(request.url || '/', 'http://localhost');
  if (!url.pathname.startsWith(BDP_ENVIRONMENT_API_BASE)) return next();

  try {
    if (url.pathname === `${BDP_ENVIRONMENT_API_BASE}/wetlands`) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return sendJson(response, 405, { error: 'method_not_allowed' });
      }
      const input = await readJsonBody(request);
      const sourceFeatures = await fetchNwiParcelFeatures(input);
      const metrics = await queryPostgisJson(buildNwiOverlapSql(input, sourceFeatures));
      return sendJson(response, 200, {
        source: 'U.S. Fish & Wildlife Service National Wetlands Inventory',
        screeningOnly: true,
        sourceFeatureCount: sourceFeatures.features.length,
        metrics,
      });
    }

    if (url.pathname === `${BDP_ENVIRONMENT_API_BASE}/flood`) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return sendJson(response, 405, { error: 'method_not_allowed' });
      }
      const input = await readJsonBody(request);
      const sourceFeatures = await fetchFemaParcelFeatures(input);
      const metrics = await queryPostgisJson(buildFemaOverlapSql(input, sourceFeatures));
      return sendJson(response, 200, {
        source: 'FEMA National Flood Hazard Layer',
        screeningOnly: true,
        sourceFeatureCount: sourceFeatures.features.length,
        metrics,
      });
    }

    return sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    const { status, payload } = publicError(error);
    if (status >= 500) console.warn('[BDP:Environment Provider]', error?.message || error);
    return sendJson(response, status, payload);
  }
}

function install(server) {
  server.middlewares.use(handleBdpEnvironment);
}

export function bdpEnvironmentProviderPlugin() {
  return {
    name: 'bdp-environment-provider',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default bdpEnvironmentProviderPlugin;
