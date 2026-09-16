import {
  BDP_SOIL_API_BASE,
  buildSsurgoParcelRequest,
  parseSdaColumnNameRows,
  summarizeSsurgoRows,
} from '../../src/bdp/soil/screeningContract.js';

const MAX_BODY_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const SDA_TIMEOUT_MS = 20_000;

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

async function fetchSsurgoScreening(input) {
  const request = buildSsurgoParcelRequest(input);
  const response = await fetch(request.url, {
    ...request.init,
    signal: AbortSignal.timeout(SDA_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`USDA Soil Data Access request failed (${response.status})`);
    error.code = 'SDA_UPSTREAM_FAILED';
    throw error;
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('USDA Soil Data Access response is too large');
  }

  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new Error('USDA Soil Data Access response is too large');
  }
  const payload = JSON.parse(text);
  const rows = parseSdaColumnNameRows(payload);
  return summarizeSsurgoRows(rows);
}

function publicError(error) {
  if (error?.code === 'SDA_UPSTREAM_FAILED' || ['TimeoutError', 'AbortError'].includes(error?.name)) {
    return {
      status: 502,
      payload: {
        error: 'ssurgo_upstream_unavailable',
        message: 'USDA Soil Data Access could not be reached for this parcel screening request.',
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
      error: 'bdp_soil_query_failed',
      message: 'The BDP soil screening query could not be completed.',
    },
  };
}

async function handleBdpSoil(request, response, next) {
  const url = new URL(request.url || '/', 'http://localhost');
  if (!url.pathname.startsWith(BDP_SOIL_API_BASE)) return next();

  try {
    if (url.pathname === `${BDP_SOIL_API_BASE}/screening`) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return sendJson(response, 405, { error: 'method_not_allowed' });
      }
      const input = await readJsonBody(request);
      const summary = await fetchSsurgoScreening(input);
      return sendJson(response, 200, {
        source: 'USDA NRCS SSURGO / Soil Data Access',
        screeningOnly: true,
        summary,
      });
    }

    return sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    const { status, payload } = publicError(error);
    if (status >= 500) console.warn('[BDP:Soil Provider]', error?.message || error);
    return sendJson(response, status, payload);
  }
}

function install(server) {
  server.middlewares.use(handleBdpSoil);
}

export function bdpSoilProviderPlugin() {
  return {
    name: 'bdp-soil-provider',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default bdpSoilProviderPlugin;
