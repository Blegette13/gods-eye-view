import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildSanAntonioEntitlementQueryUrls,
  buildSanAntonioEntitlementSql,
  normalizeSanAntonioEtj,
  normalizeSanAntonioFutureLandUse,
  normalizeSanAntonioZoning,
} from '../../src/bdp/entitlement/sanAntonioContract.js';

const execFileAsync = promisify(execFile);
const API_BASE = '/api/bdp/entitlement';
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

async function fetchGeoJson(url, label, normalize) {
  const response = await fetch(url, {
    headers: { accept: 'application/geo+json,application/json' },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`${label} request failed (${response.status})`);
    error.code = 'ENTITLEMENT_UPSTREAM_FAILED';
    throw error;
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_RESPONSE_BYTES) {
    throw new Error(`${label} response is too large`);
  }

  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_SOURCE_RESPONSE_BYTES) {
    throw new Error(`${label} response is too large`);
  }

  return normalize(JSON.parse(text));
}

export async function screenBdpParcelEntitlement(input) {
  const urls = buildSanAntonioEntitlementQueryUrls(input);
  const [zoning, etj, futureLandUse] = await Promise.all([
    fetchGeoJson(urls.zoning, 'San Antonio zoning', normalizeSanAntonioZoning),
    fetchGeoJson(urls.etj, 'San Antonio ETJ', normalizeSanAntonioEtj),
    fetchGeoJson(
      urls.futureLandUse,
      'San Antonio Future Land Use',
      normalizeSanAntonioFutureLandUse,
    ),
  ]);

  const metrics = await queryPostgisJson(buildSanAntonioEntitlementSql(input, {
    zoning,
    etj,
    futureLandUse,
  }));

  return Object.freeze({
    sourceFeatureCounts: Object.freeze({
      zoning: zoning.features.length,
      etj: etj.features.length,
      futureLandUse: futureLandUse.features.length,
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
        message: 'Entitlement screening requires the BDP PostGIS service.',
      },
    };
  }
  if (
    error?.code === 'ENTITLEMENT_UPSTREAM_FAILED'
    || ['TimeoutError', 'AbortError'].includes(error?.name)
  ) {
    return {
      status: 502,
      payload: {
        error: 'entitlement_upstream_unavailable',
        message: 'One or more official San Antonio entitlement GIS sources could not be reached.',
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
    || message.includes('too complex')
    || message.includes('capped')
  ) {
    return { status: 400, payload: { error: 'invalid_request', message } };
  }

  return {
    status: 500,
    payload: {
      error: 'bdp_entitlement_query_failed',
      message: 'The BDP entitlement screening query could not be completed.',
    },
  };
}

async function handleEntitlement(request, response, next) {
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
    const result = await screenBdpParcelEntitlement(input);
    return sendJson(response, 200, {
      source: 'City of San Antonio zoning / ETJ / adopted Future Land Use GIS',
      screeningOnly: true,
      legalEntitlementDetermined: false,
      ...result,
    });
  } catch (error) {
    const { status, payload } = publicError(error);
    if (status >= 500) console.warn('[BDP:Entitlement Provider]', error?.message || error);
    return sendJson(response, status, payload);
  }
}

function install(server) {
  server.middlewares.use(handleEntitlement);
}

export function bdpEntitlementProviderPlugin() {
  return {
    name: 'bdp-entitlement-provider',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default bdpEntitlementProviderPlugin;
