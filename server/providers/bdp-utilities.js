import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildUtilityParcelMetricsSql,
  buildPuctSewerMetricsSql,
  buildPuctSewerMapSql,
  buildPuctWaterMetricsSql,
  buildPuctWaterMapSql,
  buildUtilityParcelQueryUrls,
  normalizeTransmissionLines,
  normalizeWaterCcn,
  normalizeWaterServiceAreas,
} from '../../src/bdp/utilities/utilityContract.js';

const execFileAsync = promisify(execFile);
const API_BASE = '/api/bdp/utilities';
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
    error.code = 'UTILITIES_UPSTREAM_FAILED';
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

export async function screenBdpParcelUtilities(input) {
  const urls = buildUtilityParcelQueryUrls(input);
  const [waterServiceAreas, waterCcn, transmission] = await Promise.all([
    fetchGeoJson(
      urls.waterServiceAreas,
      'TWDB current retail water-service boundaries',
      normalizeWaterServiceAreas,
    ),
    fetchGeoJson(
      urls.waterCcn,
      'PUCT water CCN boundaries',
      normalizeWaterCcn,
    ),
    fetchGeoJson(
      urls.transmission,
      'U.S. Government archived transmission lines',
      normalizeTransmissionLines,
    ),
  ]);

  const waterAndTransmission = await queryPostgisJson(buildUtilityParcelMetricsSql(input, {
    waterServiceAreas,
    waterCcn,
    transmission,
  }));
  const readCcn = async (kind, sql) => {
    try { return await queryPostgisJson(sql); }
    catch (error) {
      if (!String(error?.stderr || error?.message).includes(`function bdp_puct_${kind}_ccn_metrics(geometry) does not exist`)) throw error;
      const prefix = kind === 'water' ? 'puct_water_ccn' : 'sewer_ccn';
      return { [`${prefix}_coverage`]: 'not-ingested', [`${prefix}_overlap_percent`]: null,
        [`${prefix}_utilities`]: [], [`${prefix}_numbers`]: [], [`${prefix}_source_last_modified`]: null };
    }
  };
  const [sewer, currentWater] = await Promise.all([
    readCcn('sewer', buildPuctSewerMetricsSql(input)),
    readCcn('water', buildPuctWaterMetricsSql(input)),
  ]);
  const metrics = { ...waterAndTransmission, ...sewer, ...currentWater };

  return Object.freeze({
    sourceFeatureCounts: Object.freeze({
      waterServiceAreas: waterServiceAreas.features.length,
      waterCcn: waterCcn.features.length,
      transmission: transmission.features.length,
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
        message: 'Parcel utility screening requires the BDP PostGIS service.',
      },
    };
  }
  if (
    error?.code === 'UTILITIES_UPSTREAM_FAILED'
    || ['TimeoutError', 'AbortError'].includes(error?.name)
  ) {
    return {
      status: 502,
      payload: {
        error: 'utilities_upstream_unavailable',
        message: 'One or more public utility GIS sources could not be reached for this screening request.',
      },
    };
  }
  if (error instanceof SyntaxError) {
    return {
      status: 400,
      payload: {
        error: 'invalid_json',
        message: 'The request body must be valid JSON.',
      },
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
    return {
      status: 400,
      payload: { error: 'invalid_request', message },
    };
  }

  return {
    status: 500,
    payload: {
      error: 'bdp_utilities_query_failed',
      message: 'The BDP utilities screening query could not be completed.',
    },
  };
}

async function handleUtilities(request, response, next) {
  const url = new URL(request.url || '/', 'http://localhost');
  if (!url.pathname.startsWith(API_BASE)) return next();

  try {
    if ([`${API_BASE}/sewer-ccn-map`, `${API_BASE}/water-ccn-map`].includes(url.pathname)) {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return sendJson(response, 405, { error: 'method_not_allowed' });
      }
      const bounds = Object.fromEntries(['west','south','east','north'].map((key) => [key, url.searchParams.get(key)]));
      if (Object.values(bounds).some((value) => value === null || value === '')) {
        return sendJson(response, 400, { error: 'invalid_request', message: 'A bounded Texas WGS84 viewport is required' });
      }
      const data = await queryPostgisJson(url.pathname.endsWith('/water-ccn-map')
        ? buildPuctWaterMapSql(bounds) : buildPuctSewerMapSql(bounds));
      return sendJson(response, 200, data);
    }
    if (url.pathname !== `${API_BASE}/screen`) {
      return sendJson(response, 404, { error: 'not_found' });
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { error: 'method_not_allowed' });
    }

    const input = await readJsonBody(request);
    const result = await screenBdpParcelUtilities(input);

    return sendJson(response, 200, {
      source: 'TWDB water service + archived water CCN + current PUCT water/sewer CCN snapshots (if imported) + archived U.S. Government transmission screening',
      screeningOnly: true,
      transmissionDataCurrency: 'archived-2024',
      ...result,
    });
  } catch (error) {
    const { status, payload } = publicError(error);
    if (status >= 500) console.warn('[BDP:Utilities Provider]', error?.message || error);
    return sendJson(response, status, payload);
  }
}

function install(server) {
  server.middlewares.use(handleUtilities);
}

export function bdpUtilitiesProviderPlugin() {
  return {
    name: 'bdp-utilities-provider',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default bdpUtilitiesProviderPlugin;
