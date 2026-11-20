import { parseBoundedParcelPageRequest } from '../../src/bdp/ingestion/parcelPageContract.js';

/**
 * Step 40C-14: UNMOUNTED, internal-only Node HTTP transport for metadata.
 *
 * Does NOT call createServer/listen(), install a route, mint sessions, read
 * environment variables, or deliver any geometry. A server integrator MUST
 * independently provide a trusted HttpOnly-cookie reader, a genuinely current
 * account/county session store behind readViewportMetadata, and a distributed,
 * fail-closed per-user quota. The cookie callback may never accept headers
 * such as x-role/x-session as authority. Do not mount this on public HTTP
 * until security/DBA and county-GIS rights gates are satisfied.
 */
export const INTERNAL_PARCEL_METADATA_PATH = '/internal/parcel/viewport-metadata';
export const INTERNAL_PARCEL_METADATA_MAX_BODY_BYTES = 1024;

const JSON_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const HANDLE = /^[A-Za-z0-9_-]{43}$/;
const BAD = Object.freeze({ status: 'invalid-request', viewportCoverage: 'unknown' });
const DENIED = Object.freeze({ status: 'denied', viewportCoverage: 'unknown' });
const BUSY = Object.freeze({ status: 'busy', viewportCoverage: 'unknown' });
const UNAVAILABLE = Object.freeze({ status: 'unavailable', viewportCoverage: 'unknown' });
const CLOSED = Object.freeze({ status: 'cancelled', viewportCoverage: 'unknown' });

function isHandle(value) {
  if (typeof value !== 'string' || !HANDLE.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === value;
}

function statusCode(result) {
  switch (result.status) {
    case 'ok': case 'partial-page': return 200;
    case 'invalid-request': return 400;
    case 'denied': return 403;
    case 'busy': return 429;
    default: return 503;
  }
}

function sanitizeResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || raw.viewportCoverage !== 'unknown') return UNAVAILABLE;
  if (raw.status === 'ok' || raw.status === 'partial-page') {
    if (!Number.isSafeInteger(raw.parcelCount)
      || raw.parcelCount < 0 || raw.parcelCount > 200
      || typeof raw.overflow !== 'boolean'
      || raw.overflow !== (raw.status === 'partial-page')
      || raw.geometryDelivered !== false) return UNAVAILABLE;
    // Never serialize unreviewed DB fields (parcel ID, SQL, secrets, owner).
    return Object.freeze({
      status: raw.status,
      parcelCount: raw.parcelCount,
      overflow: raw.overflow,
      viewportCoverage: 'unknown',
      geometryDelivered: false,
    });
  }
  switch (raw.status) {
    case 'invalid-request': return BAD;
    case 'denied': return DENIED;
    case 'busy': return BUSY;
    case 'cancelled': return CLOSED;
    default: return UNAVAILABLE;
  }
}

function writeResponse(res, body) {
  if (res.destroyed || res.writableEnded) return;
  const clean = sanitizeResult(body);
  const output = JSON.stringify(clean);
  res.statusCode = statusCode(clean);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Vary', 'Origin');
  // Intentionally do not set Access-Control-Allow-Origin.
  res.end(output);
}

async function readBoundedJson(req, signal) {
  const length = req.headers['content-length'];
  if (length !== undefined) {
    if (typeof length !== 'string' || !/^(?:0|[1-9][0-9]{0,6})$/.test(length)
      || Number(length) > INTERNAL_PARCEL_METADATA_MAX_BODY_BYTES) return null;
  }
  if (!JSON_TYPE.test(req.headers['content-type'] ?? '')
    || ![undefined, 'identity'].includes(req.headers['content-encoding'])) return null;

  const chunks = [];
  let bytes = 0;
  try {
    for await (const part of req) {
      if (signal.aborted) return null;
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      bytes += chunk.length;
      if (bytes > INTERNAL_PARCEL_METADATA_MAX_BODY_BYTES) return null;
      chunks.push(chunk);
    }
    if (signal.aborted || bytes === 0 || (length !== undefined && bytes !== Number(length))) {
      return null;
    }
    const parsed = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
    return parseBoundedParcelPageRequest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * expectedOrigin is a reviewed origin, not derived from the request Host or
 * X-Forwarded-* headers. A future gateway must enforce trusted Host/proxy,
 * HTTPS, cookie SameSite/Secure and request/header timeouts independently.
 *
 * readOpaqueSession(req, signal) must read only a secure server cookie.
 * consumeQuota({sessionHandle, countyFips, signal}) must perform a distributed
 * atomic user/county budget decision and return exactly true when allowed.
 *
 * This handler returns status information only. It never logs tokens and
 * never includes data-source coverage or parcel geometries in responses.
 */
export function createInternalParcelMetadataHandler({
  expectedOrigin,
  readOpaqueSession,
  consumeQuota,
  readViewportMetadata,
} = {}) {
  let normalizedOrigin;
  try {
    const url = new URL(expectedOrigin);
    if (!url.origin || url.origin === 'null'
      || url.pathname !== '/' || url.search || url.hash
      || url.username || url.password
      || !['https:', 'http:'].includes(url.protocol)
      || (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      || url.origin !== expectedOrigin) throw Error('Untrusted origin');
    normalizedOrigin = url.origin;
  } catch {
    throw new TypeError('A reviewed exact HTTPS origin or local-only development origin is required');
  }
  if (typeof readOpaqueSession !== 'function'
    || typeof consumeQuota !== 'function'
    || typeof readViewportMetadata !== 'function') {
    throw new TypeError('Trusted cookie resolver, distributed quota, and metadata runtime are required');
  }

  return async function handleInternalParcelMetadata(req, res) {
    if (!req || !res || typeof req.on !== 'function'
      || typeof res.setHeader !== 'function' || typeof res.end !== 'function') {
      throw new TypeError('Node HTTP request and response are required');
    }
    // Even a mounted handler refuses all other paths, methods and querystrings.
    if (req.method !== 'POST' || req.url !== INTERNAL_PARCEL_METADATA_PATH) {
      writeResponse(res, BAD);
      return;
    }
    // Origin and Fetch Metadata enforce a fail-closed CSRF gate; no CORS.
    if (req.headers.origin !== normalizedOrigin
      || (req.headers['sec-fetch-site'] !== undefined
        && req.headers['sec-fetch-site'] !== 'same-origin')) {
      writeResponse(res, DENIED);
      return;
    }

    const controller = new AbortController();
    const onAborted = () => controller.abort();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', onAborted);
    res.on('close', onClose);
    try {
      const request = await readBoundedJson(req, controller.signal);
      if (controller.signal.aborted) return;
      if (!request) { writeResponse(res, BAD); return; }

      // Token is never accepted from the body, query, Authorization or X-Role.
      const sessionHandle = await readOpaqueSession(req, controller.signal);
      if (controller.signal.aborted) return;
      if (!isHandle(sessionHandle)) { writeResponse(res, DENIED); return; }

      const quota = await consumeQuota(Object.freeze({
        sessionHandle, countyFips: request.countyFips, signal: controller.signal,
      }));
      if (controller.signal.aborted) return;
      if (quota !== true) { writeResponse(res, BUSY); return; }

      const result = await readViewportMetadata({
        sessionHandle, request, signal: controller.signal,
      });
      if (!controller.signal.aborted) writeResponse(res, result);
    } catch {
      if (!controller.signal.aborted) writeResponse(res, UNAVAILABLE);
    } finally {
      req.off('aborted', onAborted);
      res.off('close', onClose);
    }
  };
}
