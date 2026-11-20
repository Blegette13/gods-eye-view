import { normalizeHarrisFeature, HARRIS_PARCEL_LAYER_URL, HARRIS_PARCEL_FIELDS } from '../../src/bdp/cad/harrisAdapter.js';

async function json(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        const error = new Error(`Harris GIS HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const data = await response.json();
      if (data?.error) throw new Error(`Harris GIS ${data.error.code}: ${data.error.message}`);
      return data;
    } catch (error) {
      const temporary = ['TimeoutError', 'TypeError'].includes(error?.name)
        || [429, 500, 502, 503, 504].includes(error?.status);
      if (attempt === 3 || !temporary) throw error;
      console.warn(`[BDP:Harris] Public GIS transient failure; retrying (${error.status || error.name}, attempt ${attempt}/3)`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
}
const metadata = await json(`${HARRIS_PARCEL_LAYER_URL}?f=pjson`);
const names = new Set((metadata.fields || []).map((field) => field.name));
for (const name of HARRIS_PARCEL_FIELDS.split(',')) {
  if (!names.has(name)) throw new Error(`Harris GIS published field missing: ${name}`);
}
if (metadata.geometryType !== 'esriGeometryPolygon' || !/geojson/i.test(metadata.supportedQueryFormats || '')) {
  throw new Error('Harris HCAD polygon GeoJSON query contract changed');
}
const params = new URLSearchParams({ where: 'HCAD_NUM IS NOT NULL', outFields: HARRIS_PARCEL_FIELDS,
  outSR: '4326', returnGeometry: 'true', orderByFields: 'OBJECTID', resultRecordCount: '1', f: 'geojson' });
const sample = await json(`${HARRIS_PARCEL_LAYER_URL}/query?${params}`);
const parcel = sample.features?.length === 1 && normalizeHarrisFeature(sample.features[0]);
if (sample.type !== 'FeatureCollection' || !parcel || parcel.source.recordCurrency !== 'unverified') {
  throw new Error('Harris GIS sample did not produce a provenance-labeled parcel polygon');
}
console.log('[BDP:Harris] County-hosted HCAD metadata and one parcel GeoJSON query passed');
