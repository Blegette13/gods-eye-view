/**
 * Read-only City of Austin entitlement discovery.
 * Runs on a representative point in central Austin, NOT the legal geometry
 * of a parcel and NOT a zoning determination.
 *
 * A city GIS zoning match by itself never establishes jurisdiction, permitted
 * uses, overlays, subdivision restrictions, or legal development rights.
 */
import {
  AUSTIN_SOURCE_LAYERS,
  buildAustinPointQueryUrl,
  summarizeAustinPointResponse,
} from '../../src/bdp/entitlement/austinSourceContract.js';

// Representative geographic test point, not verified as inside any particular
// parcel; avoid using an address geocode as parcel-wide jurisdiction evidence.
const point = Object.freeze({ longitude: -97.7578, latitude: 30.2466 });

async function requestJson(url, label) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  if (Buffer.byteLength(body) > 1_000_000) throw new Error(`${label}: response exceeds budget`);
  let data;
  try { data = JSON.parse(body); }
  catch { throw new Error(`${label}: invalid JSON (HTTP ${response.status})`); }
  if (!response.ok || data?.error) {
    const code = data?.error?.code ?? response.status;
    const message = String(data?.error?.message || 'service response failed').slice(0, 130);
    throw new Error(`${label}: HTTP ${response.status}, ArcGIS error ${code}: ${message}`);
  }
  return data;
}

console.log('BDP · Austin source discovery · read only · point sample, NOT parcel zoning');
console.log(JSON.stringify({ sample: point, officialZoningDetermination: false }));

for (const [name, source] of Object.entries(AUSTIN_SOURCE_LAYERS)) {
  try {
    const metadata = await requestJson(new URL(`${source.url}?f=json`), `${name} metadata`);
    const fields = new Set((metadata.fields || []).map((field) => field.name));
    const missing = source.fields.filter((field) => !fields.has(field));
    const metadataSummary = {
      name,
      metadataType: metadata.type,
      geometryType: metadata.geometryType,
      supportsQuery: (metadata.capabilities || '').split(',').includes('Query'),
      missingRequiredFields: missing,
      maxRecordCount: metadata.maxRecordCount ?? null,
    };
    console.log('METADATA ' + JSON.stringify(metadataSummary));
    if (metadata.type !== 'Feature Layer' || metadata.geometryType !== 'esriGeometryPolygon'
      || metadataSummary.supportsQuery === false || missing.length) {
      console.log('SCREENING SKIPPED · metadata does not match expected official layer');
      continue;
    }
    const url = buildAustinPointQueryUrl(name, point.longitude, point.latitude);
    const data = await requestJson(url, `${name} point query`);
    const result = summarizeAustinPointResponse(name, data);
    console.log('POINT ' + JSON.stringify({
      name, status: result.status, count: result.count, capped: result.capped,
      records: result.records,
    }, null, 2));
  } catch (error) {
    console.log('UNAVAILABLE ' + JSON.stringify({
      name,
      message: String(error?.message || error).slice(0, 200),
    }));
  }
}
console.log('Source diagnostic only: DO NOT classify any parcel as zoning-cleared or buildable.');
