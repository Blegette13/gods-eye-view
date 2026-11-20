import { normalizeWilliamsonFeature, WILLIAMSON_PARCEL_LAYER_URL } from '../../src/bdp/cad/williamsonAdapter.js';

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Williamson GIS HTTP ${response.status}`);
  const data = await response.json();
  if (data?.error) throw new Error(`Williamson GIS ${data.error.code}: ${data.error.message}`);
  return data;
}
const metadata = await json(`${WILLIAMSON_PARCEL_LAYER_URL}?f=pjson`);
const names = new Set((metadata.fields || []).map((field) => field.name));
for (const name of ['OBJECTID', 'PropertyID', 'PrimaryOwner', 'Acres', 'LegalDesc', 'TotalPropMktValue']) {
  if (!names.has(name)) throw new Error(`Williamson GIS published field missing: ${name}`);
}
if (metadata.geometryType !== 'esriGeometryPolygon' || !/geojson/i.test(metadata.supportedQueryFormats || '')) {
  throw new Error('Williamson GIS polygon GeoJSON query contract changed');
}
const params = new URLSearchParams({ where: 'PropertyID IS NOT NULL', outFields: 'OBJECTID,PropertyID,PrimaryOwner,Acres,LegalDesc,TotalPropMktValue',
  outSR: '4326', returnGeometry: 'true', orderByFields: 'OBJECTID', resultRecordCount: '1', f: 'geojson' });
const sample = await json(`${WILLIAMSON_PARCEL_LAYER_URL}/query?${params}`);
if (sample.type !== 'FeatureCollection' || sample.features?.length !== 1 || !normalizeWilliamsonFeature(sample.features[0])) {
  throw new Error('Williamson GIS sample did not produce a normalized parcel polygon');
}
console.log('[BDP:Williamson] Official GIS metadata and one parcel GeoJSON query passed');
