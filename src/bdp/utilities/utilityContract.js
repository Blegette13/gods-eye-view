import { normalizeWetlandsParcelRequest } from '../environment/wetlandsContract.js';

export const TWDB_WATER_SERVICE_AREAS_URL =
  'https://services.twdb.texas.gov/arcgis/rest/services/PWS/Public_Water_Service_Areas/MapServer/0';

export const PUCT_WATER_CCN_URL =
  'https://services.twdb.texas.gov/arcgis/rest/services/PWS/Public_Utility_Commission_CCN_Water/MapServer/0';

export const US_GOV_TRANSMISSION_ARCHIVE_URL =
  'https://services.arcgis.com/707Mk8fFdkSwTkI9/ArcGIS/rest/services/PowerTransmissionInfrastructure_ExportFeatures/FeatureServer/0';

const SOURCE_MAX_FEATURES = 2_000;
const TRANSMISSION_PAD_DEGREES = 0.1;

const WATER_SERVICE_FIELDS = [
  'ObjectId',
  'PWSCode',
  'PWSName',
  'PWSId',
  'Active',
  'Source',
  'LUpDateTime',
].join(',');

const WATER_CCN_FIELDS = [
  'FID',
  'TYPE',
  'CCN_NO',
  'UTILITY',
  'COUNTY',
  'STATUS',
  'CCN_TYPE',
].join(',');

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function paddedBounds(bounds, pad) {
  return Object.freeze({
    west: Math.max(-180, bounds.west - pad),
    south: Math.max(-90, bounds.south - pad),
    east: Math.min(180, bounds.east + pad),
    north: Math.min(90, bounds.north + pad),
  });
}

function featureQueryUrl(layerUrl, bounds, outFields) {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(SOURCE_MAX_FEATURES),
    f: 'geojson',
  });
  return `${layerUrl}/query?${params.toString()}`;
}

export function buildUtilityParcelQueryUrls(parcelInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const transmissionBounds = paddedBounds(request.bounds, TRANSMISSION_PAD_DEGREES);
  return Object.freeze({
    waterServiceAreas: featureQueryUrl(
      TWDB_WATER_SERVICE_AREAS_URL,
      request.bounds,
      WATER_SERVICE_FIELDS,
    ),
    waterCcn: featureQueryUrl(
      PUCT_WATER_CCN_URL,
      request.bounds,
      WATER_CCN_FIELDS,
    ),
    transmission: featureQueryUrl(
      US_GOV_TRANSMISSION_ARCHIVE_URL,
      transmissionBounds,
      '*',
    ),
  });
}

function normalizeCollection(input, { label, geometryTypes, fields = null }) {
  if (!input || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error(`${label} returned malformed GeoJSON`);
  }
  if (input.features.length >= SOURCE_MAX_FEATURES) {
    throw new Error(`${label} screening result is capped; narrow the parcel vicinity before relying on utility metrics`);
  }

  const features = input.features
    .filter((feature) => geometryTypes.includes(feature?.geometry?.type))
    .map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: fields
        ? Object.fromEntries(fields.map((field) => [field, feature.properties?.[field] ?? null]))
        : { ...(feature.properties || {}) },
    }));

  return Object.freeze({ type: 'FeatureCollection', features });
}

export function normalizeWaterServiceAreas(input) {
  return normalizeCollection(input, {
    label: 'TWDB water-service boundary service',
    geometryTypes: ['Polygon', 'MultiPolygon'],
    fields: WATER_SERVICE_FIELDS.split(','),
  });
}

export function normalizeWaterCcn(input) {
  return normalizeCollection(input, {
    label: 'PUCT water CCN service',
    geometryTypes: ['Polygon', 'MultiPolygon'],
    fields: WATER_CCN_FIELDS.split(','),
  });
}

export function normalizeTransmissionLines(input) {
  return normalizeCollection(input, {
    label: 'U.S. Government transmission archive',
    geometryTypes: ['LineString', 'MultiLineString'],
  });
}

export function buildUtilityParcelMetricsSql(
  parcelInput,
  { waterServiceAreas, waterCcn, transmission },
) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const services = normalizeWaterServiceAreas(waterServiceAreas);
  const ccn = normalizeWaterCcn(waterCcn);
  const lines = normalizeTransmissionLines(transmission);

  const parcelJson = JSON.stringify(request.geometry);
  const serviceJson = JSON.stringify(services);
  const ccnJson = JSON.stringify(ccn);
  const lineJson = JSON.stringify(lines);

  return `
WITH parcel AS (
  SELECT ST_CollectionExtract(
    ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(parcelJson)}), 4326)), 3
  ) AS geom
),
parcel_stats AS (
  SELECT geom, ST_Area(geom::geography) AS area_m2 FROM parcel
),
service_rows AS (
  SELECT
    feature,
    ST_CollectionExtract(
      ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)), 3
    ) AS geom,
    NULLIF(feature -> 'properties' ->> 'PWSName', '') AS name,
    NULLIF(feature -> 'properties' ->> 'PWSId', '') AS pws_id,
    NULLIF(feature -> 'properties' ->> 'Active', '') AS active
  FROM jsonb_array_elements(${sqlTextLiteral(serviceJson)}::jsonb -> 'features') AS feature
),
service_hits AS (
  SELECT s.*
  FROM service_rows s CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(s.geom) AND ST_Intersects(s.geom, p.geom)
),
service_union AS (
  SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom FROM service_hits
),
service_summary AS (
  SELECT
    (SELECT COUNT(*)::integer FROM service_hits) AS count,
    (SELECT COUNT(*)::integer FROM service_hits WHERE LOWER(COALESCE(active, '')) IN ('1','true','yes','active')) AS active_count,
    (SELECT COALESCE(jsonb_agg(DISTINCT name) FILTER (WHERE name IS NOT NULL), '[]'::jsonb) FROM service_hits) AS names,
    CASE
      WHEN su.geom IS NULL THEN 0::double precision
      ELSE ST_Area(ST_Intersection(ps.geom, su.geom)::geography) / 4046.8564224
    END AS overlap_acres,
    CASE
      WHEN su.geom IS NULL OR ps.area_m2 <= 0 THEN 0::double precision
      ELSE LEAST(100.0, ST_Area(ST_Intersection(ps.geom, su.geom)::geography) / ps.area_m2 * 100.0)
    END AS overlap_percent
  FROM parcel_stats ps CROSS JOIN service_union su
),
ccn_rows AS (
  SELECT
    feature,
    ST_CollectionExtract(
      ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)), 3
    ) AS geom,
    NULLIF(feature -> 'properties' ->> 'CCN_NO', '') AS ccn_no,
    NULLIF(feature -> 'properties' ->> 'UTILITY', '') AS utility,
    NULLIF(feature -> 'properties' ->> 'STATUS', '') AS status,
    NULLIF(feature -> 'properties' ->> 'CCN_TYPE', '') AS ccn_type
  FROM jsonb_array_elements(${sqlTextLiteral(ccnJson)}::jsonb -> 'features') AS feature
),
ccn_hits AS (
  SELECT c.*
  FROM ccn_rows c CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(c.geom) AND ST_Intersects(c.geom, p.geom)
),
ccn_union AS (
  SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom FROM ccn_hits
),
ccn_summary AS (
  SELECT
    (SELECT COUNT(*)::integer FROM ccn_hits) AS count,
    (SELECT COALESCE(jsonb_agg(DISTINCT utility) FILTER (WHERE utility IS NOT NULL), '[]'::jsonb) FROM ccn_hits) AS utilities,
    (SELECT COALESCE(jsonb_agg(DISTINCT ccn_no) FILTER (WHERE ccn_no IS NOT NULL), '[]'::jsonb) FROM ccn_hits) AS numbers,
    CASE
      WHEN cu.geom IS NULL OR ps.area_m2 <= 0 THEN 0::double precision
      ELSE LEAST(100.0, ST_Area(ST_Intersection(ps.geom, cu.geom)::geography) / ps.area_m2 * 100.0)
    END AS overlap_percent
  FROM parcel_stats ps CROSS JOIN ccn_union cu
),
line_rows AS (
  SELECT
    feature,
    ST_CollectionExtract(
      ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)), 2
    ) AS geom,
    COALESCE(
      NULLIF(feature -> 'properties' ->> 'OWNER', ''),
      NULLIF(feature -> 'properties' ->> 'owner', '')
    ) AS owner,
    COALESCE(
      NULLIF(feature -> 'properties' ->> 'VOLTAGE', ''),
      NULLIF(feature -> 'properties' ->> 'voltage', '')
    ) AS voltage
  FROM jsonb_array_elements(${sqlTextLiteral(lineJson)}::jsonb -> 'features') AS feature
),
line_nearby AS (
  SELECT
    l.*,
    ST_Distance(l.geom::geography, p.geom::geography) AS distance_m,
    ST_Intersects(l.geom, p.geom) AS intersects
  FROM line_rows l CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(l.geom)
    AND ST_DWithin(l.geom::geography, p.geom::geography, 16093.44)
),
nearest_line AS (
  SELECT * FROM line_nearby ORDER BY distance_m LIMIT 1
),
line_summary AS (
  SELECT
    COUNT(*) FILTER (WHERE intersects)::integer AS crossing_count,
    COALESCE(SUM(
      CASE
        WHEN intersects THEN ST_Length(ST_Intersection(l.geom, p.geom)::geography)
        ELSE 0
      END
    ), 0)::double precision AS length_on_parcel_m,
    COUNT(*) FILTER (WHERE distance_m <= 1609.344)::integer AS within_1_mi,
    COUNT(*) FILTER (WHERE distance_m <= 8046.72)::integer AS within_5_mi
  FROM line_nearby l CROSS JOIN parcel p
)
SELECT jsonb_build_object(
  'water_service_area_count', ss.count,
  'water_service_active_count', ss.active_count,
  'water_service_names', ss.names,
  'water_service_overlap_acres', ss.overlap_acres,
  'water_service_overlap_percent', ss.overlap_percent,
  'water_ccn_count', cs.count,
  'water_ccn_utilities', cs.utilities,
  'water_ccn_numbers', cs.numbers,
  'water_ccn_overlap_percent', cs.overlap_percent,
  'water_ccn_source_currency', 'twdb-2021',
  'nearest_transmission_m', nl.distance_m,
  'nearest_transmission_owner', nl.owner,
  'nearest_transmission_voltage', nl.voltage,
  'transmission_crossing_count', ls.crossing_count,
  'transmission_length_on_parcel_m', ls.length_on_parcel_m,
  'transmission_lines_within_1_mi', ls.within_1_mi,
  'transmission_lines_within_5_mi', ls.within_5_mi,
  'transmission_data_currency', 'archived-2024'
)::text
FROM service_summary ss
CROSS JOIN ccn_summary cs
CROSS JOIN line_summary ls
LEFT JOIN nearest_line nl ON true;
`.trim();
}

/** Query the imported official PUCT sewer snapshot; absence stays unknown. */
export function buildPuctSewerMetricsSql(parcelInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  return `SELECT bdp_puct_sewer_ccn_metrics(ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(JSON.stringify(request.geometry))}), 4326))::text`;
}
export function buildPuctWaterMetricsSql(parcelInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  return `SELECT bdp_puct_water_ccn_metrics(ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(JSON.stringify(request.geometry))}), 4326))::text`;
}

/** Bounded viewport clipping is performed by PostGIS for the native map. */
function buildPuctCcnMapSql(bounds, kind) {
  const coords = [bounds?.west, bounds?.south, bounds?.east, bounds?.north].map(Number);
  if (coords.some((value) => !Number.isFinite(value)) || coords[0] >= coords[2] || coords[1] >= coords[3]
    || coords[2] - coords[0] > 0.35 || coords[3] - coords[1] > 0.35
    || coords[0] < -107 || coords[2] > -93 || coords[1] < 25 || coords[3] > 37) {
    throw new Error('A bounded Texas WGS84 viewport is required');
  }
  return `WITH b AS (SELECT ST_MakeEnvelope(${coords.join(',')},4326) AS geom),
  snapshot AS (SELECT source_last_modified FROM bdp_puct_${kind}_ccn_snapshot WHERE singleton),
  hits AS MATERIALIZED (
    SELECT c.* FROM bdp_puct_${kind}_ccn c CROSS JOIN b
    WHERE c.geom && b.geom AND ST_Intersects(c.geom,b.geom) LIMIT 501
  ), clipped AS (
    SELECT h.*, ST_CollectionExtract(ST_Intersection(h.geom,b.geom),3) AS clip
    FROM hits h CROSS JOIN b LIMIT 500
  )
  SELECT jsonb_build_object('type','FeatureCollection',
    'coverage', CASE WHEN NOT EXISTS (SELECT 1 FROM snapshot) THEN 'not-ingested'
      WHEN (SELECT source_last_modified FROM snapshot) IS NULL
        OR (SELECT source_last_modified FROM snapshot) < NOW() - INTERVAL '180 days'
      THEN 'stale-or-unverified' ELSE 'mapped-snapshot' END,
    'truncated',(SELECT COUNT(*) > 500 FROM hits),
    'features',COALESCE((SELECT jsonb_agg(jsonb_build_object('type','Feature',
      'geometry',ST_AsGeoJSON(clip,6)::jsonb,'properties',jsonb_build_object(
        'CCN_NO',ccn_no,'UTILITY',utility,'sourceLastModified',(SELECT source_last_modified FROM snapshot))))
      FROM clipped WHERE NOT ST_IsEmpty(clip)), '[]'::jsonb))::text`;
}
export function buildPuctSewerMapSql(bounds) { return buildPuctCcnMapSql(bounds, 'sewer'); }
export function buildPuctWaterMapSql(bounds) { return buildPuctCcnMapSql(bounds, 'water'); }
