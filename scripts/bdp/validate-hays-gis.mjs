import { normalizeHaysFeature, HAYS_PARCEL_LAYER_URL } from '../../src/bdp/cad/haysAdapter.js';

async function json(url) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Hays GIS HTTP ${response.status}`);
      const data = await response.json();
      if (data?.error) throw new Error(`Hays GIS ${data.error.code}: ${data.error.message}`);
      return data;
    } catch (error) {
      if (attempt === 2 || !['TimeoutError', 'TypeError'].includes(error?.name)) throw error;
      console.warn(`[BDP:Hays] Public GIS request failed transiently; retrying once (${error.name})`);
    }
  }
}
const metadata = await json(`${HAYS_PARCEL_LAYER_URL}?f=pjson`);
const names = new Set((metadata.fields || []).map((field) => field.name));
for (const name of ['OBJECTID', 'Prop_ID', 'OWNER_NAME', 'LEGAL_AREA', 'LGL_AREA_U', 'MKT_VALUE', 'TAX_YEAR', 'FIPS']) {
  if (!names.has(name)) throw new Error(`Hays GIS published field missing: ${name}`);
}
if (metadata.geometryType !== 'esriGeometryPolygon' || !/geojson/i.test(metadata.supportedQueryFormats || '')
  || !/February 2022/i.test(metadata.description || '')) {
  throw new Error('Hays public CAD copy polygon/date contract changed; review its provenance before screening');
}
const params = new URLSearchParams({ where: 'Prop_ID IS NOT NULL', outFields: 'OBJECTID,Prop_ID,OWNER_NAME,LEGAL_AREA,LGL_AREA_U,MKT_VALUE,TAX_YEAR,FIPS',
  outSR: '4326', returnGeometry: 'true', orderByFields: 'OBJECTID', resultRecordCount: '1', f: 'geojson' });
const sample = await json(`${HAYS_PARCEL_LAYER_URL}/query?${params}`);
const parcel = sample.features?.length === 1 && normalizeHaysFeature(sample.features[0]);
if (sample.type !== 'FeatureCollection' || !parcel || parcel.source.recordCurrency !== 'stale') {
  throw new Error('Hays GIS sample did not produce a stale-labeled parcel polygon');
}
console.log('[BDP:Hays] Public GIS metadata and one historical parcel GeoJSON query passed');
