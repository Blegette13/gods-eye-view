import { normalizeWetlandsParcelRequest } from './wetlandsContract.js';

export const TCEQ_MSW_MAX_VIEW_SPAN_DEGREES = 1.25;
export const TCEQ_MSW_MAX_FEATURES = 2_000;

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

export function normalizeTceqMswBounds(input = {}) {
  const bounds = {
    west: Number(input.west),
    south: Number(input.south),
    east: Number(input.east),
    north: Number(input.north),
  };

  if (Object.values(bounds).some((value) => !Number.isFinite(value))) {
    throw new Error('TCEQ MSW bounds must be finite WGS84 coordinates');
  }
  if (
    bounds.west < -180
    || bounds.east > 180
    || bounds.south < -90
    || bounds.north > 90
  ) {
    throw new Error('TCEQ MSW bounds must be valid WGS84 coordinates');
  }
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new Error('TCEQ MSW bounds must have positive width and height');
  }
  if (
    bounds.east - bounds.west > TCEQ_MSW_MAX_VIEW_SPAN_DEGREES
    || bounds.north - bounds.south > TCEQ_MSW_MAX_VIEW_SPAN_DEGREES
  ) {
    throw new Error(
      `TCEQ MSW viewport must be ${TCEQ_MSW_MAX_VIEW_SPAN_DEGREES} degrees or smaller`,
    );
  }

  return Object.freeze(bounds);
}

export function buildTceqMswFeaturesSql(input) {
  const bounds = normalizeTceqMswBounds(input);
  const envelope =
    `ST_MakeEnvelope(${bounds.west}, ${bounds.south}, ${bounds.east}, ${bounds.north}, 4326)`;

  return `
WITH rows AS (
  SELECT
    s.id,
    ST_AsGeoJSON(s.geom, 6)::jsonb AS geometry,
    jsonb_build_object(
      'dataset', s.source_dataset,
      'siteName', s.site_name,
      'alternateName', s.alternate_name,
      'authorizationNumber', s.authorization_number,
      'rn', s.rn,
      'facilityType', s.facility_type,
      'legalStatus', s.legal_status,
      'physicalStatus', s.physical_status,
      'county', s.county,
      'unauthorized', s.unauthorized,
      'hazardousConfirmed', s.hazardous_waste_confirmed,
      'hazardousProbable', s.hazardous_waste_probable,
      'dateClosed', s.date_closed,
      'sizeAcres', s.size_acres,
      'coordinateAccuracy', s.coordinate_accuracy_code
    ) AS properties
  FROM bdp_tceq_msw_sites s
  WHERE s.geom IS NOT NULL
    AND s.geom && ${envelope}
    AND ST_Intersects(s.geom, ${envelope})
  ORDER BY s.id
  LIMIT ${TCEQ_MSW_MAX_FEATURES}
)
SELECT jsonb_build_object(
  'source', 'Texas Commission on Environmental Quality municipal-solid-waste data',
  'screeningOnly', true,
  'boundaryInferred', false,
  'coverage', bdp_tceq_msw_coverage(),
  'truncated', (SELECT COUNT(*) FROM rows) >= ${TCEQ_MSW_MAX_FEATURES},
  'points', jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'id', 'tceq-msw-' || id,
        'geometry', geometry,
        'properties', properties
      ))
      FROM rows
    ), '[]'::jsonb)
  )
)::text;
`.trim();
}

export function buildTceqMswParcelSql(input) {
  const request = normalizeWetlandsParcelRequest(input);
  const geometryJson = JSON.stringify(request.geometry);

  return `
SELECT (to_jsonb(metrics) || jsonb_build_object(
  'coverage', bdp_tceq_msw_coverage(),
  'coverage_complete', (bdp_tceq_msw_coverage() ->> 'complete')::boolean
))::text
FROM bdp_tceq_parcel_msw_metrics(
  ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(geometryJson)}), 4326)
) AS metrics;
`.trim();
}
