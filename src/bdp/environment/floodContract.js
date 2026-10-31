import {
  BDP_ENVIRONMENT_API_BASE,
  normalizeWetlandsParcelRequest,
} from './wetlandsContract.js';

export { BDP_ENVIRONMENT_API_BASE };

export const FEMA_NFHL_FLOOD_HAZARD_URL =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
export const FEMA_MAX_PARCEL_FEATURES = 5_000;
export const FEMA_EVALUATED_ZONE_PATTERN = '^(A|AE|AH|AO|A99|AR|AR/(A|AE|AH|AO|A1-30)|A([1-9]|[12][0-9]|30)|V|VE|V([1-9]|[12][0-9]|30)|X)$';

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

export function classifyFemaFloodFeature(feature) {
  const properties = feature?.properties || {};
  const zone = String(properties.FLD_ZONE || '').trim().toUpperCase();
  const subtype = String(properties.ZONE_SUBTY || '').trim().toUpperCase();
  const sfha = String(properties.SFHA_TF || '').trim().toUpperCase() === 'T';
  if (subtype.includes('FLOODWAY')) return 'floodway';
  if (sfha || zone.startsWith('A') || zone.startsWith('V')) return 'sfha';
  if (zone === 'X' && subtype.includes('0.2 PCT')) return 'moderate';
  return 'other';
}

export function buildFemaParcelQueryUrl(input) {
  const request = normalizeWetlandsParcelRequest(input);
  const { west, south, east, north } = request.bounds;
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${west},${south},${east},${north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,VELOCITY',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(FEMA_MAX_PARCEL_FEATURES),
    f: 'geojson',
  });
  return `${FEMA_NFHL_FLOOD_HAZARD_URL}?${params.toString()}`;
}

export function normalizeFemaFeatureCollection(input) {
  if (!input || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error('FEMA NFHL returned malformed GeoJSON');
  }
  if (input.exceededTransferLimit === true || input.properties?.exceededTransferLimit === true
    || input.features.length >= FEMA_MAX_PARCEL_FEATURES) {
    throw new Error('FEMA NFHL result is capped or truncated; incomplete evidence cannot be treated as clear');
  }

  if (input.features.some((feature) => !['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type))) {
    throw new Error('FEMA NFHL returned a feature with missing or invalid polygon geometry');
  }

  const features = input.features
    .filter((feature) => feature?.geometry && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type))
    .map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        FLD_ZONE: feature.properties?.FLD_ZONE ?? null,
        ZONE_SUBTY: feature.properties?.ZONE_SUBTY ?? null,
        SFHA_TF: feature.properties?.SFHA_TF ?? null,
        STATIC_BFE: feature.properties?.STATIC_BFE ?? null,
        DEPTH: feature.properties?.DEPTH ?? null,
        VELOCITY: feature.properties?.VELOCITY ?? null,
        bdp_class: classifyFemaFloodFeature(feature),
      },
    }));
  return Object.freeze({ type: 'FeatureCollection', features });
}

export function buildFemaOverlapSql(parcelInput, featureCollectionInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const featureCollection = normalizeFemaFeatureCollection(featureCollectionInput);
  const parcelJson = JSON.stringify(request.geometry);
  const femaJson = JSON.stringify(featureCollection);

  return `
WITH parcel AS (
  SELECT ST_CollectionExtract(
    ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(parcelJson)}), 4326)),
    3
  ) AS geom
),
fema_source AS (
  SELECT
    feature,
    ST_CollectionExtract(
      ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)),
      3
    ) AS geom,
    feature -> 'properties' ->> 'bdp_class' AS hazard_class,
    UPPER(BTRIM(COALESCE(feature -> 'properties' ->> 'FLD_ZONE', ''))) AS zone
  FROM jsonb_array_elements(${sqlTextLiteral(femaJson)}::jsonb -> 'features') AS feature
),
intersecting AS (
  SELECT f.geom, f.hazard_class
  FROM fema_source f
  CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(f.geom)
    AND f.hazard_class IN ('floodway', 'sfha', 'moderate')
    AND ST_Intersects(f.geom, p.geom)
),
unions AS (
  SELECT
    ST_UnaryUnion(ST_Collect(geom) FILTER (WHERE hazard_class = 'floodway')) AS floodway_geom,
    ST_UnaryUnion(ST_Collect(geom) FILTER (WHERE hazard_class IN ('floodway', 'sfha'))) AS sfha_geom,
    ST_UnaryUnion(ST_Collect(geom) FILTER (WHERE hazard_class = 'moderate')) AS moderate_geom,
    ST_UnaryUnion(ST_Collect(geom)) AS mapped_geom
  FROM intersecting
),
evaluated AS (
  SELECT COALESCE(ST_UnaryUnion(ST_Collect(geom)), ST_GeomFromText('POLYGON EMPTY', 4326)) AS geom
  FROM fema_source WHERE zone ~ '${FEMA_EVALUATED_ZONE_PATTERN}'
),
metrics AS (
  SELECT
    ST_Area(p.geom::geography) AS parcel_area_m2,
    ST_Area(ST_CollectionExtract(ST_Intersection(p.geom, e.geom), 3)::geography) AS evaluated_m2,
    ST_Area(ST_Intersection(p.geom, COALESCE(u.floodway_geom, ST_GeomFromText('POLYGON EMPTY', 4326)))::geography) AS floodway_m2,
    ST_Area(ST_Intersection(p.geom, COALESCE(u.sfha_geom, ST_GeomFromText('POLYGON EMPTY', 4326)))::geography) AS sfha_m2,
    ST_Area(ST_Intersection(p.geom, COALESCE(u.moderate_geom, ST_GeomFromText('POLYGON EMPTY', 4326)))::geography) AS moderate_m2,
    ST_Area(ST_Intersection(p.geom, COALESCE(u.mapped_geom, ST_GeomFromText('POLYGON EMPTY', 4326)))::geography) AS mapped_m2,
    (SELECT COUNT(*) FROM intersecting) AS feature_count
  FROM parcel p
  CROSS JOIN unions u
  CROSS JOIN evaluated e
)
SELECT jsonb_build_object(
  'coverage_complete', parcel_area_m2 > 0 AND evaluated_m2 / NULLIF(parcel_area_m2, 0) >= 0.995,
  'fema_evaluated_coverage_percent', CASE WHEN parcel_area_m2 > 0 THEN 100 * evaluated_m2 / parcel_area_m2 ELSE NULL END,
  'parcel_acres', ROUND((parcel_area_m2 / 4046.8564224)::numeric, 2),
  'floodway_acres', ROUND((floodway_m2 / 4046.8564224)::numeric, 2),
  'sfha_acres', ROUND((sfha_m2 / 4046.8564224)::numeric, 2),
  'moderate_acres', ROUND((moderate_m2 / 4046.8564224)::numeric, 2),
  'mapped_flood_acres', ROUND((mapped_m2 / 4046.8564224)::numeric, 2),
  'mapped_flood_percent', ROUND((CASE WHEN parcel_area_m2 > 0 THEN 100 * mapped_m2 / parcel_area_m2 ELSE 0 END)::numeric, 2),
  'preliminary_non_mapped_flood_acres', CASE WHEN parcel_area_m2 > 0 AND evaluated_m2 / parcel_area_m2 >= 0.995 THEN ROUND((GREATEST(parcel_area_m2 - mapped_m2, 0) / 4046.8564224)::numeric, 2) ELSE NULL END,
  'flood_feature_count', feature_count
)::text
FROM metrics;
`.trim();
}
