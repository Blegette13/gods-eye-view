import { normalizeTexasCountyFips } from '../ingestion/rrcCatalog.js';

export const BDP_RRC_API_BASE = '/api/bdp/rrc';
export const RRC_MAX_VIEW_SPAN_DEGREES = 0.35;
export const RRC_MAX_FEATURES_PER_KIND = 1500;
export const RRC_MAX_PARCEL_POSITIONS = 20000;

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

export function normalizeRrcBounds(input = {}) {
  const bounds = {
    west: finiteNumber(input.west, 'west'),
    south: finiteNumber(input.south, 'south'),
    east: finiteNumber(input.east, 'east'),
    north: finiteNumber(input.north, 'north'),
  };

  if (bounds.west < -180 || bounds.east > 180 || bounds.south < -90 || bounds.north > 90) {
    throw new Error('RRC bounds must be valid WGS84 coordinates');
  }
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new Error('RRC bounds must have positive width and height');
  }
  if (
    bounds.east - bounds.west > RRC_MAX_VIEW_SPAN_DEGREES
    || bounds.north - bounds.south > RRC_MAX_VIEW_SPAN_DEGREES
  ) {
    throw new Error(`RRC viewport must be ${RRC_MAX_VIEW_SPAN_DEGREES} degrees or smaller`);
  }

  return Object.freeze(bounds);
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
  if (state.positions > RRC_MAX_PARCEL_POSITIONS) {
    throw new Error('Parcel geometry is too complex for an RRC screening request');
  }
}

function validateCoordinates(node, state) {
  if (!Array.isArray(node) || node.length === 0) {
    throw new Error('Parcel geometry coordinates are required');
  }
  if (typeof node[0] === 'number') {
    validatePosition(node, state);
    return;
  }
  for (const child of node) validateCoordinates(child, state);
}

export function normalizeRrcParcelRequest(input = {}) {
  const geometry = input?.geometry;
  if (!geometry || typeof geometry !== 'object') {
    throw new Error('Parcel geometry is required');
  }
  if (!['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error('Parcel geometry must be a Polygon or MultiPolygon');
  }

  const state = { positions: 0 };
  validateCoordinates(geometry.coordinates, state);
  if (state.positions < 4) throw new Error('Parcel geometry does not contain enough positions');

  const countyFips = input.countyFips
    ? normalizeTexasCountyFips(input.countyFips)
    : null;

  return Object.freeze({
    countyFips,
    geometry: Object.freeze({
      type: geometry.type,
      coordinates: structuredClone(geometry.coordinates),
    }),
  });
}

export function buildRrcFeaturesSql(boundsInput, { countyFips = null } = {}) {
  const bounds = normalizeRrcBounds(boundsInput);
  const county = countyFips ? normalizeTexasCountyFips(countyFips) : null;
  const countyWhereWells = county ? `AND w.county_fips = ${sqlTextLiteral(county)}` : '';
  const countyWherePipelines = county ? `AND p.county_fips = ${sqlTextLiteral(county)}` : '';
  const envelope = `ST_MakeEnvelope(${bounds.west}, ${bounds.south}, ${bounds.east}, ${bounds.north}, 4326)`;

  return `
WITH
well_rows AS (
  SELECT
    w.id,
    ST_AsGeoJSON(w.geom, 6)::jsonb AS geometry,
    jsonb_build_object(
      'kind', 'well',
      'countyFips', w.county_fips,
      'apiNumber', w.api_number,
      'status', w.status,
      'symnum', w.symnum,
      'reliability', w.reliability_code
    ) AS properties
  FROM bdp_rrc_wells w
  WHERE w.geom && ${envelope}
    AND ST_Intersects(w.geom, ${envelope})
    ${countyWhereWells}
  ORDER BY w.id
  LIMIT ${RRC_MAX_FEATURES_PER_KIND}
),
pipeline_rows AS (
  SELECT
    p.id,
    ST_AsGeoJSON(p.geom, 6)::jsonb AS geometry,
    jsonb_build_object(
      'kind', 'pipeline',
      'countyFips', p.county_fips,
      'operator', p.operator_name,
      'system', p.system_name,
      'pipelineId', p.pipeline_id,
      'permitNumber', p.permit_number,
      'diameter', p.diameter,
      'commodity', p.commodity,
      'status', p.operational_status
    ) AS properties
  FROM bdp_rrc_pipelines p
  WHERE p.geom && ${envelope}
    AND ST_Intersects(p.geom, ${envelope})
    ${countyWherePipelines}
  ORDER BY p.id
  LIMIT ${RRC_MAX_FEATURES_PER_KIND}
)
SELECT jsonb_build_object(
  'source', 'Railroad Commission of Texas GIS',
  'screeningOnly', true,
  'wells', jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type', 'Feature', 'id', 'well-' || id, 'geometry', geometry, 'properties', properties
      )) FROM well_rows
    ), '[]'::jsonb)
  ),
  'pipelines', jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type', 'Feature', 'id', 'pipeline-' || id, 'geometry', geometry, 'properties', properties
      )) FROM pipeline_rows
    ), '[]'::jsonb)
  )
)::text;
`.trim();
}

export function buildRrcEnergySql(requestInput) {
  const request = normalizeRrcParcelRequest(requestInput);
  const geometryJson = JSON.stringify(request.geometry);
  const county = request.countyFips ? sqlTextLiteral(request.countyFips) : 'NULL';

  return `
SELECT row_to_json(metrics)::text
FROM bdp_rrc_parcel_energy_metrics(
  ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(geometryJson)}), 4326),
  ${county}
) AS metrics;
`.trim();
}
