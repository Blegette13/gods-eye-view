import { runBdpParcelScreening } from '../../src/bdp/intelligence/screeningSession.js';
import {
  BDP_INTELLIGENCE_API_BASE,
  normalizeBdpIntelligenceRequest,
} from '../../src/bdp/intelligence/apiContract.js';
import { screenBdpParcelEnergy } from './bdp-rrc.js';
import {
  screenBdpParcelCleanups,
  screenBdpParcelFlood,
  screenBdpParcelWetlands,
} from './bdp-environment.js';
import { screenBdpParcelSoils } from './bdp-soil.js';
import { screenBdpParcelTerrain } from './bdp-terrain.js';
import { screenBdpParcelTransportation } from './bdp-transportation.js';
import { screenBdpParcelUtilities } from './bdp-utilities.js';

const MAX_BODY_BYTES = 1_000_000;

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

function providerStatus(error) {
  if (Number.isFinite(Number(error?.status))) return Number(error.status);
  if (error?.code === 'BDP_POSTGIS_NOT_CONFIGURED' || error?.code === 'ENOENT') return 503;
  if (
    [
      'NWI_UPSTREAM_FAILED',
      'FEMA_UPSTREAM_FAILED',
      'EPA_CLEANUPS_UPSTREAM_FAILED',
      'SDA_UPSTREAM_FAILED',
      'USGS_3DEP_FAILED',
      'TXDOT_UPSTREAM_FAILED',
      'UTILITIES_UPSTREAM_FAILED',
    ].includes(error?.code)
    || ['TimeoutError', 'AbortError'].includes(error?.name)
  ) return 502;
  return 500;
}

function screened(loader) {
  return async (parcel) => {
    try {
      return await loader(parcel);
    } catch (error) {
      if (!Number.isFinite(Number(error?.status))) error.status = providerStatus(error);
      throw error;
    }
  };
}

function parcelGeometryInput(parcel) {
  return { geometry: parcel.property.geometry };
}

export async function screenBdpParcelIntelligence(parcelInput) {
  const { parcel } = normalizeBdpIntelligenceRequest(parcelInput);
  return runBdpParcelScreening(parcel, {
    energyLoader: screened((candidate) => screenBdpParcelEnergy({
      countyFips: candidate.countyFips || null,
      geometry: candidate.property.geometry,
    })),
    floodLoader: screened(async (candidate) => (
      await screenBdpParcelFlood(parcelGeometryInput(candidate))
    ).metrics),
    wetlandsLoader: screened(async (candidate) => (
      await screenBdpParcelWetlands(parcelGeometryInput(candidate))
    ).metrics),
    cleanupsLoader: screened(async (candidate) => (
      await screenBdpParcelCleanups(parcelGeometryInput(candidate))
    ).metrics),
    soilsLoader: screened((candidate) => screenBdpParcelSoils(parcelGeometryInput(candidate))),
    terrainLoader: screened((candidate) => screenBdpParcelTerrain(parcelGeometryInput(candidate))),
    transportationLoader: screened(async (candidate) => (
      await screenBdpParcelTransportation(parcelGeometryInput(candidate))
    ).metrics),
    utilitiesLoader: screened(async (candidate) => (
      await screenBdpParcelUtilities(parcelGeometryInput(candidate))
    ).metrics),
  });
}

function publicError(error) {
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
    || message.includes('Polygon')
    || message.includes('body is too large')
  ) {
    return {
      status: 400,
      payload: { error: 'invalid_request', message },
    };
  }

  return {
    status: 500,
    payload: {
      error: 'bdp_intelligence_failed',
      message: 'The unified BDP parcel intelligence request could not be completed.',
    },
  };
}

async function handleBdpIntelligence(request, response, next) {
  const url = new URL(request.url || '/', 'http://localhost');
  if (!url.pathname.startsWith(BDP_INTELLIGENCE_API_BASE)) return next();

  try {
    if (url.pathname !== `${BDP_INTELLIGENCE_API_BASE}/screen`) {
      return sendJson(response, 404, { error: 'not_found' });
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { error: 'method_not_allowed' });
    }

    const input = await readJsonBody(request);
    const screening = await screenBdpParcelIntelligence(input);
    return sendJson(response, 200, {
      source: 'BDP Unified Parcel Intelligence',
      screeningOnly: true,
      screening,
    });
  } catch (error) {
    const { status, payload } = publicError(error);
    if (status >= 500) console.warn('[BDP:Intelligence Provider]', error?.message || error);
    return sendJson(response, status, payload);
  }
}

function install(server) {
  server.middlewares.use(handleBdpIntelligence);
}

export function bdpIntelligenceProviderPlugin() {
  return {
    name: 'bdp-intelligence-provider',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default bdpIntelligenceProviderPlugin;
