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
// Prevent regressing to TCAD_Travis_County_Property, a county-owned-property subset.
// A residential neighborhood in central Austin must yield parcel features.
const neighborhood = new URLSearchParams({
  where: '1=1',
  geometry: '-97.715,30.265,-97.712,30.269',
  geometryType: 'esriGeometryEnvelope',
  inSR: '4326',
  spatialRel: 'esriSpatialRelIntersects',
  returnCountOnly: 'true',
  f: 'json',
});
const nearby = await json(`${TRAVIS_PARCEL_LAYER_URL}/query?${neighborhood}`);
if (!Number.isInteger(nearby.count) || nearby.count < 1) {
  throw new Error('Travis GIS countywide coverage failed: no parcels in central Austin');
}
console.log('[BDP:Travis] Official countywide metadata, parcel sample, and Austin neighborhood coverage passed');
