import {
  BDP_TERRAIN_API_BASE,
  build3depStatisticsUrl,
  normalizeTerrainParcelRequest,
  summarizeTerrainStatistics,
} from '../../src/bdp/terrain/terrainContract.js';

const MAX_BODY_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const USGS_TIMEOUT_MS = 20_000;

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

async function fetchSmallJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(USGS_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`USGS 3DEP request failed (${response.status})`);
    error.code = 'USGS_3DEP_FAILED';
    throw error;
  }
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new Error('USGS 3DEP response is too large');
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('USGS 3DEP response is too large');
  const payload = JSON.parse(text);
  if (payload?.error) {
    const error = new Error(payload.error.message || 'USGS 3DEP returned an error');
    error.code = 'USGS_3DEP_FAILED';
    throw error;
  }
  return payload;
}

async function fetchTerrainScreening(input) {
  normalizeTerrainParcelRequest(input);
  const [elevation, slope] = await Promise.all([
    fetchSmallJson(build3depStatisticsUrl(input, { mode: 'elevation' })),
    fetchSmallJson(build3depStatisticsUrl(input, { mode: 'slope' })),
  ]);
  return summarizeTerrainStatistics(elevation, slope);
}

function publicError(error) {
  if (error?.code === 'USGS_3DEP_FAILED' || ['TimeoutError', 'AbortError'].includes(error?.name)) {
    return {
      status: 502,
      payload: {
        error: 'usgs_3dep_unavailable',
        message: 'USGS 3DEP could not complete this terrain screening request.',
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
    || message.includes('rings must be closed')
  ) {
    return { status: 400, payload: { error: 'invalid_request', message } };
  }
  return {
    status: 500,
    payload: {
      error: 'bdp_terrain_query_failed',
      message: 'The BDP terrain screening query could not be completed.',
    },
  };
}

async function handleBdpTerrain(request, response, next) {
  const url = new URL(request.url || '/', 'http://localhost');
  if (!url.pathname.startsWith(BDP_TERRAIN_API_BASE)) return next();

  try {
    if (url.pathname === `${BDP_TERRAIN_API_BASE}/screening`) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return sendJson(response, 405, { error: 'method_not_allowed' });
      }
      const input = await readJsonBody(request);
      const metrics = await fetchTerrainScreening(input);
      return sendJson(response, 200, {
        source: 'USGS 3D Elevation Program (3DEP)',
        screeningOnly: true,
        metrics,
      });
    }
    return sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    const { status, payload } = publicError(error);
    if (status >= 500) console.warn('[BDP:Terrain Provider]', error?.message || error);
    return sendJson(response, status, payload);
  }
}

function install(server) {
  server.middlewares.use(handleBdpTerrain);
}

export function bdpTerrainProviderPlugin() {
  return {
    name: 'bdp-terrain-provider',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default bdpTerrainProviderPlugin;
