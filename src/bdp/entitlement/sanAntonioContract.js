import { normalizeWetlandsParcelRequest } from '../environment/wetlandsContract.js';

export const SAN_ANTONIO_ZONING_URL =
  'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer/12';
export const SAN_ANTONIO_ETJ_URL =
  'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_ETJ/FeatureServer/3';
export const SAN_ANTONIO_FUTURE_LAND_USE_URL =
  'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/Future_Land_Use/FeatureServer/4';

export const ENTITLEMENT_MAX_SOURCE_FEATURES = 2_000;

const ZONING_FIELDS = [
  'OBJECTID',
  'ZoneKey',
  'CaseNo',
  'Base',
  'SpecDistrict',
  'SpecCondition',
  'SpecConditionDetail',
  'Zoning',
  'OrdinanceKey',
  'ZoningDetail',
  'BaseDescription',
  'SpecDistrictDescription',
  'EntryDate',
  'ModifiedDate',
].join(',');

const ETJ_FIELDS = ['OBJECTID', 'Acres', 'SqMiles', 'Name'].join(',');
const FLU_FIELDS = ['OBJECTID', 'PlanName', 'LandUse', 'CenterTiers'].join(',');

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function queryUrl(layerUrl, bounds, outFields) {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(ENTITLEMENT_MAX_SOURCE_FEATURES),
    f: 'geojson',
  });
  return `${layerUrl}/query?${params.toString()}`;
}

export function buildSanAntonioEntitlementQueryUrls(parcelInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  return Object.freeze({
    zoning: queryUrl(SAN_ANTONIO_ZONING_URL, request.bounds, ZONING_FIELDS),
    etj: queryUrl(SAN_ANTONIO_ETJ_URL, request.bounds, ETJ_FIELDS),
    futureLandUse: queryUrl(
      SAN_ANTONIO_FUTURE_LAND_USE_URL,
      request.bounds,
      FLU_FIELDS,
    ),
  });
}

function normalizeCollection(input, { label, fields }) {
  if (!input || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error(`${label} returned malformed GeoJSON`);
  }
  if (input.features.length >= ENTITLEMENT_MAX_SOURCE_FEATURES) {
    throw new Error(
      `${label} screening result is capped; narrow the parcel vicinity before relying on entitlement metrics`,
    );
  }

  const features = input.features
    .filter((feature) => ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type))
    .map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: Object.fromEntries(
        fields.map((field) => [field, feature.properties?.[field] ?? null]),
      ),
    }));

  return Object.freeze({ type: 'FeatureCollection', features });
}

export function normalizeSanAntonioZoning(input) {
  return normalizeCollection(input, {
    label: 'San Antonio zoning service',
    fields: ZONING_FIELDS.split(','),
  });
}

export function normalizeSanAntonioEtj(input) {
  return normalizeCollection(input, {
    label: 'San Antonio ETJ service',
    fields: ETJ_FIELDS.split(','),
  });
}

export function normalizeSanAntonioFutureLandUse(input) {
  return normalizeCollection(input, {
    label: 'San Antonio Future Land Use service',
    fields: FLU_FIELDS.split(','),
  });
}

export function buildSanAntonioEntitlementSql(
  parcelInput,
  { zoning, etj, futureLandUse },
) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const parcelJson = JSON.stringify(request.geometry);
  const zoningJson = JSON.stringify(normalizeSanAntonioZoning(zoning));
  const etjJson = JSON.stringify(normalizeSanAntonioEtj(etj));
  const fluJson = JSON.stringify(normalizeSanAntonioFutureLandUse(futureLandUse));

  return `
WITH parcel AS (
  SELECT ST_CollectionExtract(
    ST_MakeValid(
      ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(parcelJson)}), 4326)
    ),
    3
  ) AS geom
),
parcel_stats AS (
  SELECT geom, ST_Area(geom::geography) AS area_m2
  FROM parcel
),
zoning_rows AS (
  SELECT
    ST_CollectionExtract(
      ST_MakeValid(
        ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)
      ),
      3
    ) AS geom,
    NULLIF(feature -> 'properties' ->> 'Base', '') AS base,
    NULLIF(feature -> 'properties' ->> 'Zoning', '') AS zoning,
    NULLIF(feature -> 'properties' ->> 'ZoningDetail', '') AS zoning_detail,
    NULLIF(feature -> 'properties' ->> 'BaseDescription', '') AS base_description,
    NULLIF(feature -> 'properties' ->> 'SpecDistrict', '') AS spec_district,
    NULLIF(feature -> 'properties' ->> 'SpecDistrictDescription', '') AS spec_district_description,
    NULLIF(feature -> 'properties' ->> 'SpecCondition', '') AS spec_condition,
    NULLIF(feature -> 'properties' ->> 'SpecConditionDetail', '') AS spec_condition_detail,
    NULLIF(feature -> 'properties' ->> 'CaseNo', '') AS case_no
  FROM jsonb_array_elements(
    ${sqlTextLiteral(zoningJson)}::jsonb -> 'features'
  ) AS feature
),
zoning_hits AS (
  SELECT
    z.*,
    ST_Area(ST_Intersection(z.geom, p.geom)::geography) AS overlap_m2,
    UPPER(COALESCE(z.base, '')) NOT IN ('OCL', 'UZROW') AS is_city_base
  FROM zoning_rows z
  CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(z.geom)
    AND ST_Intersects(z.geom, p.geom)
),
city_zone_union AS (
  SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom
  FROM zoning_hits
  WHERE is_city_base
),
zoning_summary AS (
  SELECT
    (SELECT COUNT(*)::integer FROM zoning_hits) AS feature_count,
    (SELECT COUNT(*)::integer FROM zoning_hits WHERE is_city_base) AS city_feature_count,
    (SELECT COUNT(*)::integer FROM zoning_hits
      WHERE is_city_base
        AND (
          COALESCE(spec_district, '') <> ''
          OR COALESCE(spec_condition, '') <> ''
          OR COALESCE(spec_condition_detail, '') <> ''
        )
    ) AS special_condition_count,
    CASE
      WHEN czu.geom IS NULL OR ps.area_m2 <= 0 THEN 0::double precision
      ELSE LEAST(
        100.0,
        ST_Area(ST_Intersection(ps.geom, czu.geom)::geography)
          / ps.area_m2 * 100.0
      )
    END AS city_zoning_coverage_percent
  FROM parcel_stats ps
  CROSS JOIN city_zone_union czu
),
dominant_zoning AS (
  SELECT
    base,
    zoning,
    zoning_detail,
    base_description,
    spec_district,
    spec_district_description,
    spec_condition,
    spec_condition_detail,
    case_no,
    overlap_m2
  FROM zoning_hits
  WHERE is_city_base AND overlap_m2 > 0
  ORDER BY overlap_m2 DESC, COALESCE(zoning, base, '')
  LIMIT 1
),
etj_rows AS (
  SELECT
    ST_CollectionExtract(
      ST_MakeValid(
        ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)
      ),
      3
    ) AS geom,
    NULLIF(feature -> 'properties' ->> 'Name', '') AS name
  FROM jsonb_array_elements(
    ${sqlTextLiteral(etjJson)}::jsonb -> 'features'
  ) AS feature
),
etj_hits AS (
  SELECT e.*, ST_Area(ST_Intersection(e.geom, p.geom)::geography) AS overlap_m2
  FROM etj_rows e
  CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(e.geom)
    AND ST_Intersects(e.geom, p.geom)
),
etj_union AS (
  SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom FROM etj_hits
),
etj_summary AS (
  SELECT
    (SELECT COUNT(*)::integer FROM etj_hits) AS feature_count,
    (SELECT COALESCE(jsonb_agg(DISTINCT name) FILTER (WHERE name IS NOT NULL), '[]'::jsonb)
       FROM etj_hits) AS names,
    CASE
      WHEN eu.geom IS NULL OR ps.area_m2 <= 0 THEN 0::double precision
      ELSE LEAST(
        100.0,
        ST_Area(ST_Intersection(ps.geom, eu.geom)::geography)
          / ps.area_m2 * 100.0
      )
    END AS overlap_percent
  FROM parcel_stats ps
  CROSS JOIN etj_union eu
),
flu_rows AS (
  SELECT
    ST_CollectionExtract(
      ST_MakeValid(
        ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)
      ),
      3
    ) AS geom,
    NULLIF(feature -> 'properties' ->> 'PlanName', '') AS plan_name,
    NULLIF(feature -> 'properties' ->> 'LandUse', '') AS land_use,
    NULLIF(feature -> 'properties' ->> 'CenterTiers', '') AS center_tiers
  FROM jsonb_array_elements(
    ${sqlTextLiteral(fluJson)}::jsonb -> 'features'
  ) AS feature
),
flu_hits AS (
  SELECT
    f.*,
    ST_Area(ST_Intersection(f.geom, p.geom)::geography) AS overlap_m2
  FROM flu_rows f
  CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(f.geom)
    AND ST_Intersects(f.geom, p.geom)
),
flu_union AS (
  SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom FROM flu_hits
),
flu_summary AS (
  SELECT
    (SELECT COUNT(*)::integer FROM flu_hits) AS feature_count,
    CASE
      WHEN fu.geom IS NULL OR ps.area_m2 <= 0 THEN 0::double precision
      ELSE LEAST(
        100.0,
        ST_Area(ST_Intersection(ps.geom, fu.geom)::geography)
          / ps.area_m2 * 100.0
      )
    END AS coverage_percent
  FROM parcel_stats ps
  CROSS JOIN flu_union fu
),
dominant_flu AS (
  SELECT plan_name, land_use, center_tiers, overlap_m2
  FROM flu_hits
  WHERE overlap_m2 > 0
  ORDER BY overlap_m2 DESC, COALESCE(land_use, '')
  LIMIT 1
)
SELECT jsonb_build_object(
  'jurisdiction_screen',
    CASE
      WHEN zs.city_zoning_coverage_percent >= 50 THEN 'san-antonio-city-zoned'
      WHEN es.overlap_percent > 0 THEN 'san-antonio-etj'
      ELSE 'outside-or-unresolved'
    END,
  'city_zoning_coverage_percent', zs.city_zoning_coverage_percent,
  'zoning_feature_count', zs.feature_count,
  'city_zoning_feature_count', zs.city_feature_count,
  'zoning_special_condition_count', zs.special_condition_count,
  'dominant_zoning_base', dz.base,
  'dominant_zoning_code', dz.zoning,
  'dominant_zoning_detail', dz.zoning_detail,
  'dominant_zoning_base_description', dz.base_description,
  'dominant_zoning_spec_district', dz.spec_district,
  'dominant_zoning_spec_district_description', dz.spec_district_description,
  'dominant_zoning_spec_condition', dz.spec_condition,
  'dominant_zoning_spec_condition_detail', dz.spec_condition_detail,
  'dominant_zoning_case_no', dz.case_no,
  'dominant_zoning_share_percent',
    CASE
      WHEN ps.area_m2 <= 0 OR dz.overlap_m2 IS NULL THEN 0::double precision
      ELSE LEAST(100.0, dz.overlap_m2 / ps.area_m2 * 100.0)
    END,
  'etj_feature_count', es.feature_count,
  'etj_names', es.names,
  'etj_overlap_percent', es.overlap_percent,
  'future_land_use_feature_count', fs.feature_count,
  'future_land_use_coverage_percent', fs.coverage_percent,
  'dominant_future_land_use', df.land_use,
  'dominant_future_land_use_plan', df.plan_name,
  'dominant_future_land_use_center_tiers', df.center_tiers,
  'dominant_future_land_use_share_percent',
    CASE
      WHEN ps.area_m2 <= 0 OR df.overlap_m2 IS NULL THEN 0::double precision
      ELSE LEAST(100.0, df.overlap_m2 / ps.area_m2 * 100.0)
    END,
  'legal_entitlement_determined', false
)::text
FROM parcel_stats ps
CROSS JOIN zoning_summary zs
CROSS JOIN etj_summary es
CROSS JOIN flu_summary fs
LEFT JOIN dominant_zoning dz ON true
LEFT JOIN dominant_flu df ON true;
`.trim();
}
