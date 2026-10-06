import { normalizeTravisFeature, TRAVIS_PARCEL_LAYER_URL } from '../../src/bdp/cad/travisAdapter.js';

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Travis GIS HTTP ${response.status}`);
  const data = await response.json();
  if (data?.error) throw new Error(`Travis GIS ${data.error.code}: ${data.error.message}`);
  return data;
}

const metadata = await json(`${TRAVIS_PARCEL_LAYER_URL}?f=pjson`);
const names = new Set((metadata.fields || []).map((field) => field.name));
for (const name of ['OBJECTID', 'PROP_ID', 'py_owner_name', 'tcad_acres', 'legal_desc']) {
  if (!names.has(name)) throw new Error(`Travis GIS published field missing: ${name}`);
}
if (metadata.geometryType !== 'esriGeometryPolygon' || !/geojson/i.test(metadata.supportedQueryFormats || '')) {
  throw new Error('Travis GIS polygon GeoJSON query contract changed');
}
const params = new URLSearchParams({ where: 'PROP_ID IS NOT NULL', outFields: 'OBJECTID,PROP_ID,py_owner_name,tcad_acres,legal_desc',
  outSR: '4326', returnGeometry: 'true', orderByFields: 'OBJECTID', resultRecordCount: '1', f: 'geojson' });
const sample = await json(`${TRAVIS_PARCEL_LAYER_URL}/query?${params}`);
if (sample.type !== 'FeatureCollection' || sample.features?.length !== 1 || !normalizeTravisFeature(sample.features[0])) {
  throw new Error('Travis GIS sample did not produce a normalized parcel polygon');
}
console.log('[BDP:Travis] Official GIS metadata and one parcel GeoJSON query passed');
