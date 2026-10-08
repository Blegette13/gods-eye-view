import { normalizeWetlandsParcelRequest } from '../environment/wetlandsContract.js';

export const BDP_WATER_API_BASE = '/api/bdp/water';
export const WATER_RIGHTS_MAX_VIEW_SPAN_DEGREES = 0.35;
export const WATER_RIGHTS_MAX_FEATURES = 1500;

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

export function normalizeWaterRightsBounds(input = {}) {
  const bounds = {
    west: Number(input.west),
    south: Number(input.south),
    east: Number(input.east),
    north: Number(input.north),
  };

  if (Object.values(bounds).some((value) => !Number.isFinite(value))) {
    throw new Error('Water-right bounds must be finite WGS84 coordinates');
  }
  if (
    bounds.west < -180
    || bounds.east > 180
    || bounds.south < -90
    || bounds.north > 90
  ) {
    throw new Error('Water-right bounds must be valid WGS84 coordinates');
  }
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new Error('Water-right bounds must have positive width and height');
  }
  if (
    bounds.east - bounds.west > WATER_RIGHTS_MAX_VIEW_SPAN_DEGREES
    || bounds.north - bounds.south > WATER_RIGHTS_MAX_VIEW_SPAN_DEGREES
  ) {
    throw new Error(
      `Water-right viewport must be ${WATER_RIGHTS_MAX_VIEW_SPAN_DEGREES} degrees or smaller`,
    );
  }

  return Object.freeze(bounds);
}

export function buildTceqWaterRightFeaturesSql(input) {
  const bounds = normalizeWaterRightsBounds(input);
  const envelope = `ST_MakeEnvelope(${bounds.west}, ${bounds.south}, ${bounds.east}, ${bounds.north}, 4326)`;

  return `
WITH points AS (
  SELECT
    p.id,
    ST_AsGeoJSON(p.geom, 6)::jsonb AS geometry,
    jsonb_build_object(
      'waterRightId', p.water_right_id,
      'locationRole', p.location_role,
      'label', p.point_label,
      'county', p.county,
      'watercourse', p.watercourse
    ) AS properties
  FROM bdp_tceq_water_right_points p
  WHERE p.geom && ${envelope}
    AND ST_Intersects(p.geom, ${envelope})
  ORDER BY p.id
  LIMIT ${WATER_RIGHTS_MAX_FEATURES}
)
SELECT jsonb_build_object(
  'source', 'Texas Commission on Environmental Quality surface-water rights GIS',
  'screeningOnly', true,
  'ownershipInferred', false,
  'points', jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'id', 'tceq-water-' || id,
        'geometry', geometry,
        'properties', properties
      ))
      FROM points
    ), '[]'::jsonb)
  )
)::text;
`.trim();
}

export function normalizeWaterParcelRequest(input = {}) {
  return normalizeWetlandsParcelRequest(input);
}

export function buildTceqParcelWaterSql(input) {
  const request = normalizeWaterParcelRequest(input);
  const geometryJson = JSON.stringify(request.geometry);
  return `
SELECT row_to_json(metrics)::text
FROM bdp_tceq_parcel_water_metrics(
  ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(geometryJson)}), 4326)
) AS metrics;
`.trim();
}
