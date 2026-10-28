/**
 * Read-only TxDOT roadway diagnostic for the Austin parcel pilot.
 * Reports query stage, HTTP status, and record counts ONLY.
 * No GIS objects, credentials, owners or parcel identifiers are printed.
 */
import { buildTxdotParcelQueryUrls } from '../../src/bdp/transportation/txdotContract.js';

const sample = {
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-97.7589, 30.2452], [-97.7575, 30.2452],
      [-97.7575, 30.2463], [-97.7589, 30.2463],
      [-97.7589, 30.2452],
    ]],
  },
};

const baseUrl = new URL(buildTxdotParcelQueryUrls(sample).roadways);

async function probe(stage, url, init = {}) {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json,application/geo+json',
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await response.text();
    let body = null;
    try { body = JSON.parse(raw); } catch { /* An HTTP gateway can return HTML. */ }
    const result = {
      stage,
      status: response.status,
      ok: response.ok,
      method: init.method || 'GET',
      requestUrlLength: url.toString().length,
      responseBytes: Buffer.byteLength(raw),
      contentType: response.headers.get('content-type'),
      arcgisError: body?.error
        ? { code: body.error.code ?? null, message: String(body.error.message || '').slice(0, 160) }
        : null,
      objectIdCount: Array.isArray(body?.objectIds) ? body.objectIds.length : null,
      objectIdField: typeof body?.objectIdFieldName === 'string' ? body.objectIdFieldName : null,
      featureCount: Array.isArray(body?.features) ? body.features.length : null,
      exceededTransferLimit: body?.exceededTransferLimit === true,
    };
    console.log(JSON.stringify(result, null, 2));
    return { response, body };
  } catch (error) {
    console.log(JSON.stringify({
      stage,
      method: init.method || 'GET',
      requestUrlLength: url.toString().length,
      requestFailed: String(error?.message || error).slice(0, 180),
    }, null, 2));
    return null;
  }
}

console.log('TxDOT public roadway GIS diagnostic · Austin sample · read only');
const metadataUrl = new URL(baseUrl);
metadataUrl.pathname = metadataUrl.pathname.endsWith('/query')
  ? metadataUrl.pathname.slice(0, -'/query'.length)
  : metadataUrl.pathname;
metadataUrl.search = '?f=json';
await probe('layer-metadata', metadataUrl);

const idsUrl = new URL(baseUrl);
idsUrl.searchParams.set('returnIdsOnly', 'true');
idsUrl.searchParams.set('returnGeometry', 'false');
idsUrl.searchParams.set('f', 'json');
idsUrl.searchParams.delete('resultRecordCount');
idsUrl.searchParams.delete('outFields');
const inventory = await probe('roadway-id-inventory', idsUrl);
if (!inventory?.response.ok || !Array.isArray(inventory.body?.objectIds)) {
  console.log('Cannot continue safely: roadway ID inventory unavailable.');
  process.exit(0);
}

const ids = inventory.body.objectIds;
if (ids.length === 0) {
  console.log('Inventory contains no roads for this test footprint. No geometry query needed.');
  process.exit(0);
}
for (const count of [10, 200, 400]) {
  if (ids.length < count && count > 10) continue;
  const url = new URL(baseUrl);
  url.searchParams.set('objectIds', ids.slice(0, count).join(','));
  url.searchParams.set('resultRecordCount', String(count));
  url.searchParams.set('f', 'geojson');
  const res = await probe(`roadway-geometry-first-${Math.min(count, ids.length)}-ids`, url);
  if (res && !res.response.ok) break;
}
// Long GET URLs (>2,200 characters) returned HTTP 404/HTML, while 10 IDs
// returned valid GeoJSON. Test the ArcGIS-supported POST form-body equivalent
// without printing any source geometry or owner/parcel data.
for (const count of [200, 400]) {
  const params = new URLSearchParams(baseUrl.searchParams);
  params.set('objectIds', ids.slice(0, count).join(','));
  params.set('resultRecordCount', String(count));
  params.set('f', 'geojson');
  const endpoint = new URL(baseUrl);
  endpoint.search = '';
  const result = await probe(`roadway-geometry-post-first-${Math.min(count, ids.length)}-ids`, endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: params.toString(),
  });
  if (!result?.response.ok || !Array.isArray(result.body?.features)
    || result.body.features.length !== Math.min(count, ids.length)) {
    console.log('POST batch was incomplete; no full TxDOT screening can be claimed.');
    break;
  }
}
console.log('Diagnostic complete. A response without ALL requested IDs cannot establish complete coverage.');
