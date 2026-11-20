import { radiusEnvelope } from './discoveryGeography.js';
import { TXDOT_ROADWAYS_LAYER_URL } from '../transportation/txdotContract.js';

const PLACES = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/28/query';

function bboxOfFeature(feature) {
  const geom = feature?.geometry;
  if (!geom || !['Polygon','MultiPolygon'].includes(geom.type)) return null;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const box = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (const rings of polys) for (const ring of rings) for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    box.west = Math.min(box.west, p[0]); box.east = Math.max(box.east, p[0]);
    box.south = Math.min(box.south, p[1]); box.north = Math.max(box.north, p[1]);
  }
  return Number.isFinite(box.west) ? box : null;
}

function requestParams(box, extras) {
  if (!box) throw new Error('Source geography required for geographic labels');
  return new URLSearchParams({
    geometry: [box.west,box.south,box.east,box.north].join(','),
    geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    ...extras,
  });
}

export function geographicLabelUrls({ countyFeature, point, radiusMiles }) {
  const box = radiusMiles ? radiusEnvelope(point,radiusMiles) : bboxOfFeature(countyFeature);
  const cities = requestParams(box,{
    where: "1=1", outFields: 'BASENAME,INTPTLAT,INTPTLON',
    returnGeometry: 'false', resultRecordCount: '75', f: 'json',
  });
  const highways = requestParams(box,{
    where: "RTE_PRFX IN ('IH','US','SH')", outFields: 'RTE_NM,MAP_LBL,RTE_PRFX,RTE_NBR',
    returnGeometry: 'true', outSR: '4326', resultRecordCount: '121',
    orderByFields: 'OBJECTID', f: 'geojson',
  });
  return Object.freeze({
    cities: PLACES + '?' + cities.toString(),
    highways: TXDOT_ROADWAYS_LAYER_URL + '/query?' + highways.toString(),
  });
}

function numberOrNull(value, max) {
  const n = Number(value);
  return value !== null && value !== undefined && String(value).trim() !== ''
    && Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}
function cityNames(data) {
  if (data?.error || !Array.isArray(data?.features) || data.features.length > 76) {
    throw new Error('Census town labels response invalid or oversized');
  }
  const seen = new Set(), out = [];
  for (const feature of data.features) {
    const attr = feature.attributes || feature.properties || {};
    const name = String(attr.BASENAME || '').trim().slice(0,60);
    const lat = numberOrNull(attr.INTPTLAT, 90);
    const lon = numberOrNull(attr.INTPTLON, 180);
    if (!name || lat === null || lon === null || seen.has(name)) continue;
    seen.add(name);
    out.push(Object.freeze({name,lat,lon,category:'city'}));
    if(out.length === 32)break;
  }
  return out;
}
function highwayNames(data) {
  if (data?.error || data?.type !== 'FeatureCollection' ||
      !Array.isArray(data.features) || data.features.length > 121) {
    throw new Error('TxDOT roadway labels response invalid or oversized');
  }
  const seen = new Set(), out = [];
  for (const f of data.features) {
    const p = f?.properties || {};
    const name = String(p.MAP_LBL || p.RTE_NM || '').trim().slice(0,38);
    const geom = f?.geometry;
    const lines = geom?.type === 'LineString' ? [geom.coordinates]
      : geom?.type === 'MultiLineString' ? geom.coordinates : [];
    const line = lines.find((x)=>Array.isArray(x) && x.length >= 2);
    const midpoint = line?.[Math.floor(line.length/2)];
    if (!name || seen.has(name) || !midpoint || !Number.isFinite(midpoint[0]) || !Number.isFinite(midpoint[1]))continue;
    seen.add(name);
    out.push(Object.freeze({name,lon:midpoint[0],lat:midpoint[1],category:'highway'}));
    if(out.length === 18)break;
  }
  return out;
}
async function fetchData(url,signal,fetcher){
  const response = await fetcher(url,{signal});
  if(!response.ok)throw new Error('Geographic label provider HTTP '+response.status);
  return response.json();
}

/** Non-authoritative navigation labels, not zoning or roadway access evidence. */
export async function fetchGeographicLabels({countyFeature,point,radiusMiles=0,signal,fetcher=fetch}={}){
  const urls = geographicLabelUrls({countyFeature,point,radiusMiles});
  const tasks=await Promise.allSettled([
    fetchData(urls.cities,signal,fetcher).then(cityNames),
    fetchData(urls.highways,signal,fetcher).then(highwayNames),
  ]);
  if(signal?.aborted)throw new DOMException('Label request cancelled','AbortError');
  return Object.freeze({
    cityLabels: tasks[0].status==='fulfilled' ? tasks[0].value : [],
    highwayLabels: tasks[1].status==='fulfilled' ? tasks[1].value : [],
    errors: tasks.map((task,i)=>task.status==='rejected' ? (i===0?'Census places':'TxDOT roadways') : null).filter(Boolean),
    source: 'U.S. Census Bureau · TxDOT GIS',
  });
}
