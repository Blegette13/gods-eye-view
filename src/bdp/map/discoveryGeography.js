import { PILOT_COUNTIES } from '../acquisition/session.js';

export const CENSUS_COUNTY_SOURCE =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query';

/** U.S. Census Bureau TIGERweb 2026-vintage county geometry, not a survey. */
export function censusCountyUrl({ geoid = null, envelope = null } = {}) {
  const query = new URLSearchParams({
    where: geoid ? `GEOID='${geoid}'` : "STATE='48'",
    outFields: 'GEOID,NAME,STATE,INTPTLAT,INTPTLON',
    outSR: '4326',
    returnGeometry: 'true',
    f: 'geojson',
  });
  if (envelope) {
    query.set('geometry', [envelope.west, envelope.south, envelope.east, envelope.north].join(','));
    query.set('geometryType', 'esriGeometryEnvelope');
    query.set('inSR', '4326');
    query.set('spatialRel', 'esriSpatialRelIntersects');
  }
  return `${CENSUS_COUNTY_SOURCE}?${query.toString()}`;
}

export function countyForCriteria(criteria) {
  return PILOT_COUNTIES.find(({ name }) => name === criteria?.county) || null;
}

function finiteCoord(value, max) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number)
    && Math.abs(number) <= max ? number : null;
}

export function countyPoint(feature) {
  const lat = finiteCoord(feature?.properties?.INTPTLAT, 90);
  const lon = finiteCoord(feature?.properties?.INTPTLON, 180);
  return lat === null || lon === null ? null : Object.freeze({ lat, lon });
}

export function validateCountyFeatures(data) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)
      || data.exceededTransferLimit || data.error) {
    throw new Error('Census county boundary response is incomplete or invalid');
  }
  const valid = [];
  for (const feature of data.features) {
    if (feature?.type !== 'Feature'
      || !/^48\d{3}$/.test(String(feature?.properties?.GEOID || ''))
      || !['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
      || !Array.isArray(feature.geometry.coordinates)) {
      throw new Error('Invalid Texas Census county boundary feature');
    }
    valid.push(feature);
  }
  return valid;
}

/** Approximate earth-surface circle for the chosen Census internal point. */
export function radiusLineCoordinates(point, miles, count = 96) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)
      || !Number.isFinite(miles) || miles <= 0 || miles > 50) return [];
  const earthRadiusMiles = 3958.7613;
  const d = miles / earthRadiusMiles;
  const lat1 = point.lat * Math.PI / 180;
  const lon1 = point.lon * Math.PI / 180;
  const line = [];
  for (let i = 0; i <= count; i++) {
    const bearing = (2 * Math.PI * i) / count;
    const latitude = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
    );
    const longitude = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(latitude),
    );
    line.push([longitude * 180 / Math.PI, latitude * 180 / Math.PI]);
  }
  return line;
}

/** A geodetic search envelope only; not proof every overlapping county is covered. */
export function radiusEnvelope(point, miles) {
  if (!point || !Number.isFinite(miles) || miles <= 0 || miles > 50) return null;
  const latDegrees = miles / 69;
  const lonDegrees = miles / (69 * Math.max(.15, Math.cos(point.lat * Math.PI / 180)));
  return Object.freeze({
    west: point.lon - lonDegrees,
    east: point.lon + lonDegrees,
    south: point.lat - latDegrees,
    north: point.lat + latDegrees,
  });
}

export function countyBoundaryLines(features) {
  const output = [];
  for (const feature of features) {
    const g = feature.geometry;
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const rings of polygons) {
      if (!Array.isArray(rings)) continue;
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 4) continue;
        const valid = ring.every((p) => Array.isArray(p) && p.length >= 2
          && Number.isFinite(p[0]) && Number.isFinite(p[1])
          && p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90);
        if (!valid) throw new Error('Malformed county boundary coordinates');
        output.push({
          type: 'Feature', properties: { GEOID: feature.properties.GEOID, name: feature.properties.NAME },
          geometry: { type: 'LineString', coordinates: ring },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features: output };
}
