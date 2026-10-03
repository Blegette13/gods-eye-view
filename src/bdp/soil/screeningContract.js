import { SDA_TABULAR_URL } from './ssurgoCatalog.js';

export const BDP_SOIL_API_BASE = '/api/bdp/soil';
export const SOIL_MAX_PARCEL_POSITIONS = 20_000;
export const SOIL_MAX_PARCEL_SPAN_DEGREES = 1.5;

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function validatePosition(position, state) {
  if (!Array.isArray(position) || position.length < 2) {
    throw new Error('Parcel geometry contains an invalid coordinate');
  }
  const longitude = finiteNumber(position[0], 'longitude');
  const latitude = finiteNumber(position[1], 'latitude');
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error('Parcel geometry contains coordinates outside WGS84 bounds');
  }
  state.positions += 1;
  state.west = Math.min(state.west, longitude);
  state.south = Math.min(state.south, latitude);
  state.east = Math.max(state.east, longitude);
  state.north = Math.max(state.north, latitude);
  if (state.positions > SOIL_MAX_PARCEL_POSITIONS) {
    throw new Error('Parcel geometry is too complex for a soil screening request');
  }
  return [longitude, latitude];
}

function validateRing(ring, state) {
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new Error('Parcel polygon ring must contain at least four positions');
  }
  const positions = ring.map((position) => validatePosition(position, state));
  const first = positions[0];
  const last = positions.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new Error('Parcel polygon rings must be closed');
  }
  return positions;
}

function validatePolygon(coordinates, state) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw new Error('Parcel polygon coordinates are required');
  }
  return coordinates.map((ring) => validateRing(ring, state));
}

export function normalizeSoilParcelRequest(input = {}) {
  const geometry = input?.geometry;
  if (!geometry || typeof geometry !== 'object') throw new Error('Parcel geometry is required');
  if (!['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error('Parcel geometry must be a Polygon or MultiPolygon');
  }

  const state = {
    positions: 0,
    west: Infinity,
    south: Infinity,
    east: -Infinity,
    north: -Infinity,
  };

  const coordinates = geometry.type === 'Polygon'
    ? validatePolygon(geometry.coordinates, state)
    : geometry.coordinates.map((polygon) => validatePolygon(polygon, state));

  if (
    state.east - state.west > SOIL_MAX_PARCEL_SPAN_DEGREES
    || state.north - state.south > SOIL_MAX_PARCEL_SPAN_DEGREES
  ) {
    throw new Error(`Parcel soil screening span must be ${SOIL_MAX_PARCEL_SPAN_DEGREES} degrees or smaller`);
  }

  return Object.freeze({
    geometry: Object.freeze({ type: geometry.type, coordinates }),
    positions: state.positions,
  });
}

function ringToWkt(ring) {
  return `(${ring.map(([x, y]) => `${x} ${y}`).join(',')})`;
}

function polygonToWkt(polygon) {
  return `(${polygon.map(ringToWkt).join(',')})`;
}

export function soilGeometryToWkt(input) {
  const request = normalizeSoilParcelRequest(input);
  const { geometry } = request;
  if (geometry.type === 'Polygon') {
    return `POLYGON${polygonToWkt(geometry.coordinates)}`;
  }
  return `MULTIPOLYGON(${geometry.coordinates.map(polygonToWkt).join(',')})`;
}

export function buildSsurgoParcelSql(input) {
  const wkt = soilGeometryToWkt(input);
  return `
~DeclareGeometry(@aoi)~
select @aoi = geometry::STGeomFromText('${wkt}', 4326)

~DeclareIdGeomTable(@intersectedPolygonGeometries)~
~GetClippedMapunits(@aoi,polygon,geo,@intersectedPolygonGeometries)~

~DeclareIdGeogTable(@intersectedPolygonGeographies)~
~GetGeogFromGeomWgs84(@intersectedPolygonGeometries,@intersectedPolygonGeographies)~

select id, sum(geog.STArea()) as area_m2
into #aggarea
from @intersectedPolygonGeographies
group by id;

select
  M.mukey,
  M.musym,
  M.muname,
  L.areasymbol,
  M.farmlndcl,
  A.area_m2,
  A.area_m2 / 4046.8564224 as acres
from #aggarea A
join mapunit M on A.id = M.mukey
join legend L on M.lkey = L.lkey
order by A.area_m2 desc;
`.trim();
}

export function buildSsurgoParcelRequest(input) {
  const query = buildSsurgoParcelSql(input);
  return Object.freeze({
    url: SDA_TABULAR_URL,
    init: Object.freeze({
      method: 'POST',
      headers: Object.freeze({
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      }),
      body: new URLSearchParams({
        SERVICE: 'query',
        REQUEST: 'query',
        QUERY: query,
        FORMAT: 'JSON+COLUMNNAME',
      }).toString(),
    }),
  });
}

function firstResultTable(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.Table)) return payload.Table;
  return Object.values(payload).find(Array.isArray) || null;
}

export function parseSdaColumnNameRows(payload) {
  const table = firstResultTable(payload);
  if (!Array.isArray(table) || table.length === 0) return [];
  const headers = table[0].map((value) => String(value || '').trim().toLowerCase());
  return table.slice(1).map((row) => Object.fromEntries(
    headers.map((header, index) => [header, row[index] ?? null]),
  ));
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function summarizeSsurgoRows(rows) {
  const units = rows
    .map((row) => ({
      mukey: String(row.mukey ?? '').trim(),
      symbol: String(row.musym ?? '').trim(),
      name: String(row.muname ?? '').trim(),
      areaSymbol: String(row.areasymbol ?? '').trim(),
      farmlandClass: String(row.farmlndcl ?? '').trim(),
      areaM2: finiteOrNull(row.area_m2),
      acres: finiteOrNull(row.acres),
    }))
    .filter((unit) => unit.mukey && Number.isFinite(unit.acres) && unit.acres >= 0)
    .sort((a, b) => b.acres - a.acres);

  const mappedAcres = units.reduce((sum, unit) => sum + unit.acres, 0);
  const enriched = units.map((unit) => ({
    ...unit,
    mappedSharePercent: mappedAcres > 0 ? (unit.acres / mappedAcres) * 100 : 0,
  }));

  return Object.freeze({
    mappedAcres,
    mapunitCount: enriched.length,
    dominant: enriched[0] || null,
    units: Object.freeze(enriched),
  });
}
