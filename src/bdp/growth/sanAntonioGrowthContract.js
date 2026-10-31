import { normalizeWetlandsParcelRequest } from '../environment/wetlandsContract.js';

export const SAN_ANTONIO_MTP_URL =
  'https://services.arcgis.com/g1fRTDLeMgspWrYp/ArcGIS/rest/services/Major_Thoroughfare_Plan__MTP/FeatureServer/0';
export const SAN_ANTONIO_PRELIMINARY_PLAT_URL =
  'https://services.arcgis.com/g1fRTDLeMgspWrYp/ArcGIS/rest/services/PreliminaryPlat/FeatureServer/2';
export const SAN_ANTONIO_REGIONAL_CENTERS_URL =
  'https://services.arcgis.com/g1fRTDLeMgspWrYp/ArcGIS/rest/services/RegionalCenters/FeatureServer/0';

export const GROWTH_RADAR_MAX_FEATURES = 2_000;
export const GROWTH_RADAR_RADIUS_METERS = 40_233.6; // 25 miles
export const GROWTH_RADAR_QUERY_PAD_DEGREES = 0.55;

const MTP_FIELDS = [
  'OBJECTID',
  'StreetName',
  'CurrentRow',
  'PropRow',
  'ChangeCode',
  'Type',
  'StreetName1',
  'Downtown',
  'Ordinance',
].join(',');
const PLAT_FIELDS = [
  'OBJECTID',
  'PlatNumber',
  'PlatName',
  'created_date',
  'last_edited_date',
].join(',');
const CENTER_FIELDS = [
  'FID',
  'OBJECTID',
  'Name',
  'SquareMile',
  'Phase',
  'PlanType',
  'SubPlanID',
].join(',');

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function paddedBounds(bounds) {
  const pad = GROWTH_RADAR_QUERY_PAD_DEGREES;
  return Object.freeze({
    west: Math.max(-180, bounds.west - pad),
    south: Math.max(-90, bounds.south - pad),
    east: Math.min(180, bounds.east + pad),
    north: Math.min(90, bounds.north + pad),
  });
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
    resultRecordCount: String(GROWTH_RADAR_MAX_FEATURES),
    f: 'geojson',
  });
  return `${layerUrl}/query?${params.toString()}`;
}

export function buildSanAntonioGrowthQueryUrls(parcelInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const bounds = paddedBounds(request.bounds);
  return Object.freeze({
    thoroughfares: queryUrl(SAN_ANTONIO_MTP_URL, bounds, MTP_FIELDS),
    preliminaryPlats: queryUrl(
      SAN_ANTONIO_PRELIMINARY_PLAT_URL,
      bounds,
      PLAT_FIELDS,
    ),
    regionalCenters: queryUrl(
      SAN_ANTONIO_REGIONAL_CENTERS_URL,
      bounds,
      CENTER_FIELDS,
    ),
  });
}

function normalizeCollection(input, { label, geometryTypes, fields }) {
  if (!input || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error(`${label} returned malformed GeoJSON`);
  }
  if (input.features.length >= GROWTH_RADAR_MAX_FEATURES) {
    throw new Error(
      `${label} result is capped; Growth Radar will not treat an incomplete 25-mile result as complete evidence`,
    );
  }
  return Object.freeze({
    type: 'FeatureCollection',
    features: input.features
      .filter((feature) => geometryTypes.includes(feature?.geometry?.type))
      .map((feature) => ({
        type: 'Feature',
        geometry: feature.geometry,
        properties: Object.fromEntries(
          fields.map((field) => [field, feature.properties?.[field] ?? null]),
        ),
      })),
  });
}

export function normalizeSanAntonioMtp(input) {
  return normalizeCollection(input, {
    label: 'San Antonio Major Thoroughfare Plan service',
    geometryTypes: ['LineString', 'MultiLineString'],
    fields: MTP_FIELDS.split(','),
  });
}

export function normalizeSanAntonioPreliminaryPlats(input) {
  return normalizeCollection(input, {
    label: 'San Antonio Preliminary Plat service',
    geometryTypes: ['Polygon', 'MultiPolygon'],
    fields: PLAT_FIELDS.split(','),
  });
}

export function normalizeSanAntonioRegionalCenters(input) {
  return normalizeCollection(input, {
    label: 'San Antonio Regional Centers service',
    geometryTypes: ['Polygon', 'MultiPolygon'],
    fields: CENTER_FIELDS.split(','),
  });
}

export function buildSanAntonioGrowthSql(
  parcelInput,
  { thoroughfares, preliminaryPlats, regionalCenters },
) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const parcelJson = JSON.stringify(request.geometry);
  const mtpJson = JSON.stringify(normalizeSanAntonioMtp(thoroughfares));
  const platJson = JSON.stringify(
    normalizeSanAntonioPreliminaryPlats(preliminaryPlats),
  );
  const centerJson = JSON.stringify(
    normalizeSanAntonioRegionalCenters(regionalCenters),
  );

  return `
WITH parcel AS (
  SELECT ST_CollectionExtract(
    ST_MakeValid(
      ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(parcelJson)}), 4326)
    ),
    3
  ) AS geom
),
mtp_rows AS (
  SELECT
    ST_CollectionExtract(
      ST_MakeValid(
        ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)
      ),
      2
    ) AS geom,
    NULLIF(feature -> 'properties' ->> 'StreetName', '') AS street_name,
    NULLIF(feature -> 'properties' ->> 'CurrentRow', '') AS current_row,
    NULLIF(feature -> 'properties' ->> 'PropRow', '') AS proposed_row,
    NULLIF(feature -> 'properties' ->> 'ChangeCode', '') AS change_code,
    NULLIF(feature -> 'properties' ->> 'Type', '') AS type,
    NULLIF(feature -> 'properties' ->> 'Ordinance', '') AS ordinance
  FROM jsonb_array_elements(
    ${sqlTextLiteral(mtpJson)}::jsonb -> 'features'
  ) AS feature
),
mtp_nearby AS (
  SELECT
    m.*,
    ST_Distance(m.geom::geography, p.geom::geography) AS distance_m,
    ST_Intersects(m.geom, p.geom) AS intersects,
    (
      LOWER(COALESCE(m.type, '')) LIKE '%propos%'
      OR (
        COALESCE(m.proposed_row, '') <> ''
        AND COALESCE(m.proposed_row, '') <> COALESCE(m.current_row, '')
      )
    ) AS proposed_or_changed
  FROM mtp_rows m
  CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(m.geom)
    AND ST_DWithin(
      m.geom::geography,
      p.geom::geography,
      ${GROWTH_RADAR_RADIUS_METERS}
    )
),
nearest_mtp AS (
  SELECT * FROM mtp_nearby ORDER BY distance_m, COALESCE(street_name, '') LIMIT 1
),
mtp_summary AS (
  SELECT
    COUNT(*)::integer AS within_25_mi,
    COUNT(*) FILTER (WHERE distance_m <= 1609.344)::integer AS within_1_mi,
    COUNT(*) FILTER (WHERE distance_m <= 8046.72)::integer AS within_5_mi,
    COUNT(*) FILTER (WHERE distance_m <= 16093.44)::integer AS within_10_mi,
    COUNT(*) FILTER (WHERE proposed_or_changed)::integer AS proposed_or_changed_within_25_mi,
    COUNT(*) FILTER (WHERE proposed_or_changed AND distance_m <= 8046.72)::integer
      AS proposed_or_changed_within_5_mi,
    COUNT(*) FILTER (WHERE intersects)::integer AS crossing_count
  FROM mtp_nearby
),
plat_rows AS (
  SELECT
    ST_CollectionExtract(
      ST_MakeValid(
        ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)
      ),
      3
    ) AS geom,
    NULLIF(feature -> 'properties' ->> 'PlatNumber', '') AS plat_number,
    NULLIF(feature -> 'properties' ->> 'PlatName', '') AS plat_name,
    NULLIF(feature -> 'properties' ->> 'created_date', '') AS created_date,
    NULLIF(feature -> 'properties' ->> 'last_edited_date', '') AS last_edited_date
  FROM jsonb_array_elements(
    ${sqlTextLiteral(platJson)}::jsonb -> 'features'
  ) AS feature
),
plat_nearby AS (
  SELECT
    pp.*,
    ST_Distance(pp.geom::geography, p.geom::geography) AS distance_m,
    ST_Intersects(pp.geom, p.geom) AS intersects
  FROM plat_rows pp
  CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(pp.geom)
    AND ST_DWithin(
      pp.geom::geography,
      p.geom::geography,
      ${GROWTH_RADAR_RADIUS_METERS}
    )
),
nearest_plat AS (
  SELECT * FROM plat_nearby ORDER BY distance_m, COALESCE(plat_name, '') LIMIT 1
),
plat_summary AS (
  SELECT
    COUNT(*)::integer AS within_25_mi,
    COUNT(*) FILTER (WHERE distance_m <= 1609.344)::integer AS within_1_mi,
    COUNT(*) FILTER (WHERE distance_m <= 8046.72)::integer AS within_5_mi,
    COUNT(*) FILTER (WHERE distance_m <= 16093.44)::integer AS within_10_mi,
    COUNT(*) FILTER (WHERE intersects)::integer AS on_parcel
  FROM plat_nearby
),
center_rows AS (
  SELECT
    ST_CollectionExtract(
      ST_MakeValid(
        ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)
      ),
      3
    ) AS geom,
    NULLIF(feature -> 'properties' ->> 'Name', '') AS name,
    NULLIF(feature -> 'properties' ->> 'Phase', '') AS phase,
    NULLIF(feature -> 'properties' ->> 'PlanType', '') AS plan_type,
    NULLIF(feature -> 'properties' ->> 'SubPlanID', '') AS sub_plan_id
  FROM jsonb_array_elements(
    ${sqlTextLiteral(centerJson)}::jsonb -> 'features'
  ) AS feature
),
center_nearby AS (
  SELECT
    c.*,
    ST_Distance(c.geom::geography, p.geom::geography) AS distance_m,
    ST_Intersects(c.geom, p.geom) AS intersects
  FROM center_rows c
  CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(c.geom)
    AND ST_DWithin(
      c.geom::geography,
      p.geom::geography,
      ${GROWTH_RADAR_RADIUS_METERS}
    )
),
nearest_center AS (
  SELECT * FROM center_nearby ORDER BY distance_m, COALESCE(name, '') LIMIT 1
),
center_summary AS (
  SELECT
    COUNT(*)::integer AS within_25_mi,
    COUNT(*) FILTER (WHERE distance_m <= 8046.72)::integer AS within_5_mi,
    COUNT(*) FILTER (WHERE distance_m <= 16093.44)::integer AS within_10_mi,
    COUNT(*) FILTER (WHERE intersects)::integer AS on_parcel
  FROM center_nearby
)
SELECT jsonb_build_object(
  'growth_radius_miles', 25,
  'nearest_mtp_m', nm.distance_m,
  'nearest_mtp_street', nm.street_name,
  'nearest_mtp_current_row', nm.current_row,
  'nearest_mtp_proposed_row', nm.proposed_row,
  'nearest_mtp_change_code', nm.change_code,
  'nearest_mtp_type', nm.type,
  'nearest_mtp_ordinance', nm.ordinance,
  'mtp_crossing_count', ms.crossing_count,
  'mtp_within_1_mi', ms.within_1_mi,
  'mtp_within_5_mi', ms.within_5_mi,
  'mtp_within_10_mi', ms.within_10_mi,
  'mtp_within_25_mi', ms.within_25_mi,
  'mtp_proposed_or_changed_within_5_mi', ms.proposed_or_changed_within_5_mi,
  'mtp_proposed_or_changed_within_25_mi', ms.proposed_or_changed_within_25_mi,
  'nearest_preliminary_plat_m', np.distance_m,
  'nearest_preliminary_plat_name', np.plat_name,
  'nearest_preliminary_plat_number', np.plat_number,
  'nearest_preliminary_plat_created_date', np.created_date,
  'nearest_preliminary_plat_last_edited_date', np.last_edited_date,
  'preliminary_plats_on_parcel', ps.on_parcel,
  'preliminary_plats_within_1_mi', ps.within_1_mi,
  'preliminary_plats_within_5_mi', ps.within_5_mi,
  'preliminary_plats_within_10_mi', ps.within_10_mi,
  'preliminary_plats_within_25_mi', ps.within_25_mi,
  'nearest_regional_center_m', nc.distance_m,
  'nearest_regional_center_name', nc.name,
  'nearest_regional_center_phase', nc.phase,
  'nearest_regional_center_plan_type', nc.plan_type,
  'regional_centers_on_parcel', cs.on_parcel,
  'regional_centers_within_5_mi', cs.within_5_mi,
  'regional_centers_within_10_mi', cs.within_10_mi,
  'regional_centers_within_25_mi', cs.within_25_mi,
  'growth_score_ready', false
)::text
FROM mtp_summary ms
CROSS JOIN plat_summary ps
CROSS JOIN center_summary cs
LEFT JOIN nearest_mtp nm ON true
LEFT JOIN nearest_plat np ON true
LEFT JOIN nearest_center nc ON true;
`.trim();
}
