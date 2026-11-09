import { normalizeDallasFeature, DALLAS_PARCEL_LAYER_URL } from '../../src/bdp/cad/dallasAdapter.js';

async function json(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        const error = new Error(`Dallas GIS HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const data = await response.json();
      if (data?.error) throw new Error(`Dallas GIS ${data.error.code}: ${data.error.message}`);
      return data;
    } catch (error) {
      const temporary = ['TimeoutError', 'TypeError'].includes(error?.name)
        || [429, 500, 502, 503, 504].includes(error?.status);
      if (attempt === 3 || !temporary) throw error;
      console.warn(`[BDP:Dallas] Public GIS request failed transiently; retrying (${error.status || error.name}, attempt ${attempt}/3)`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
}

const metadata = await json(`${DALLAS_PARCEL_LAYER_URL}?f=pjson`);
const names = new Set((metadata.fields || []).map((field) => field.name));
for (const name of ['OBJECTID', 'PARCELID', 'OWNERNME1', 'SITEADDRESS', 'STATEDAREA', 'CNTASSDVAL', 'REVALYR']) {
  if (!names.has(name)) throw new Error(`Dallas GIS published field missing: ${name}`);
}
if (metadata.geometryType !== 'esriGeometryPolygon' || !/geojson/i.test(metadata.supportedQueryFormats || '')) {
  throw new Error('Dallas CAD polygon GeoJSON query contract changed');
}
const params = new URLSearchParams({ where: 'PARCELID IS NOT NULL',
  outFields: 'OBJECTID,PARCELID,OWNERNME1,SITEADDRESS,STATEDAREA,CNTASSDVAL,REVALYR',
  outSR: '4326', returnGeometry: 'true', orderByFields: 'OBJECTID', resultRecordCount: '1', f: 'geojson' });
const sample = await json(`${DALLAS_PARCEL_LAYER_URL}/query?${params}`);
const parcel = sample.features?.length === 1 && normalizeDallasFeature(sample.features[0]);
if (sample.type !== 'FeatureCollection' || !parcel || parcel.source.recordCurrency !== 'unverified') {
  throw new Error('Dallas GIS sample did not produce a provenance-labeled parcel polygon');
}
console.log('[BDP:Dallas] DCAD GIS metadata and one parcel GeoJSON query passed');
