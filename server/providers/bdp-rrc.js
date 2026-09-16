import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BDP_RRC_API_BASE,
  buildRrcEnergySql,
  buildRrcFeaturesSql,
} from '../../src/bdp/rrc/apiContract.js';

const execFileAsync = promisify(execFile);
const MAX_BODY_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 15_000;

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
    maxBuffer: MAX_RESPONSE_BYTES,
    timeout: QUERY_TIMEOUT_MS,
  });

  const text = String(stdout || '').trim();
  if (!text) return null;
  return JSON.parse(text);
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

function featureRequest(url) {
  return {
    west: url.searchParams.get('west'),
    south: url.searchParams.get('south'),
    east: url.searchParams.get('east'),
    north: url.searchParams.get('north'),
  };
}

function publicError(error) {
  if (error?.code === 'BDP_POSTGIS_NOT_CONFIGURED' || error?.code === 'ENOENT') {
    return {
      status: 503,
      payload: {
        error: 'bdp_postgis_unavailable',
        message: 'BDP RRC data is not available until PostGIS and the RRC ingestion service are configured.',
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
    || message.includes('viewport')
    || message.includes('geometry')
    || message.includes('WGS84')
    || message.includes('complex')
  ) {
    return { status: 400, payload: { error: 'invalid_request', message } };
  }

  return {
    status: 500,
    payload: {
      error: 'bdp_rrc_query_failed',
      message: 'The BDP RRC screening query could not be completed.',
    },
  };
}

async function handleBdpRrc(request, response, next) {
  const url = new URL(request.url || '/', 'http://localhost');
  if (!url.pathname.startsWith(BDP_RRC_API_BASE)) return next();

  try {
    if (url.pathname === `${BDP_RRC_API_BASE}/features`) {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return sendJson(response, 405, { error: 'method_not_allowed' });
      }
      const sql = buildRrcFeaturesSql(featureRequest(url), {
        countyFips: url.searchParams.get('countyFips') || null,
      });
      const payload = await queryPostgisJson(sql);
      return sendJson(response, 200, payload || {
        source: 'Railroad Commission of Texas GIS',
        screeningOnly: true,
        wells: { type: 'FeatureCollection', features: [] },
        pipelines: { type: 'FeatureCollection', features: [] },
      });
    }

    if (url.pathname === `${BDP_RRC_API_BASE}/energy`) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return sendJson(response, 405, { error: 'method_not_allowed' });
      }
      const input = await readJsonBody(request);
      const payload = await queryPostgisJson(buildRrcEnergySql(input));
      return sendJson(response, 200, {
        source: 'Railroad Commission of Texas GIS',
        screeningOnly: true,
        metrics: payload || null,
      });
    }

    return sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    const { status, payload } = publicError(error);
    if (status >= 500) console.warn('[BDP:RRC Provider]', error?.message || error);
    return sendJson(response, status, payload);
  }
}

function install(server) {
  server.middlewares.use(handleBdpRrc);
}

export function bdpRrcProviderPlugin() {
  return {
    name: 'bdp-rrc-provider',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default bdpRrcProviderPlugin;
