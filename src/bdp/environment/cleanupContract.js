import { normalizeWetlandsParcelRequest } from './wetlandsContract.js';
import { EPA_CLEANUP_QUERY_URL } from '../overlays/epaCleanupLayer.js';

export const EPA_CLEANUP_MAX_SOURCE_FEATURES = 2_000;
export const EPA_CLEANUP_QUERY_PAD_DEGREES = 0.12;

const OUT_FIELDS = [
  'OBJECTID',
  'REGISTRY_ID',
  'PRIMARY_NAME',
  'LOCATION_ADDRESS',
  'CITY_NAME',
  'STATE_CODE',
  'COUNTY_NAME',
  'MAP_SYMBOL_CODE',
  'URL',
  'EPA_ID',
  'SF_SITE_NAME',
  'SF_NPL_CODE_F',
  'SF_NPL_CODE_D',
  'SF_NON_NPL_STATUS',
  'RCRA_HANDLER_NAME',
  'RCRA_GPRA_CA',
  'BF_PROPERTY_NAME',
  'EPAOSC_SITE_ID',
  'EPAOSC_STATUS',
  'EPAOSC_INCI_CATEG',
  'LUST_ID',
  'UST_STATUS',
  'DATA_REFRESH_DT',
  'GIS_REFRESH_DT',
].join(',');

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

export function buildEpaCleanupParcelQueryUrl(parcelInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const { west, south, east, north } = request.bounds;
  const pad = EPA_CLEANUP_QUERY_PAD_DEGREES;
  const params = new URLSearchParams({
    where: "STATE_CODE='TX'",
    geometry: `${Math.max(-180, west - pad)},${Math.max(-90, south - pad)},${Math.min(180, east + pad)},${Math.min(90, north + pad)}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(EPA_CLEANUP_MAX_SOURCE_FEATURES),
    f: 'geojson',
  });
  return `${EPA_CLEANUP_QUERY_URL}?${params.toString()}`;
}

export function normalizeEpaCleanupFeatureCollection(input) {
  if (!input || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error('US EPA cleanup service returned malformed GeoJSON');
  }
  if (input.features.length >= EPA_CLEANUP_MAX_SOURCE_FEATURES) {
    throw new Error('US EPA cleanup screening result is capped; narrow the parcel vicinity before relying on counts');
  }

  const features = input.features
    .filter((feature) => feature?.geometry?.type === 'Point')
    .map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        REGISTRY_ID: feature.properties?.REGISTRY_ID ?? null,
        PRIMARY_NAME: feature.properties?.PRIMARY_NAME ?? null,
        MAP_SYMBOL_CODE: feature.properties?.MAP_SYMBOL_CODE ?? null,
        URL: feature.properties?.URL ?? null,
        EPA_ID: feature.properties?.EPA_ID ?? null,
        SF_SITE_NAME: feature.properties?.SF_SITE_NAME ?? null,
        SF_NPL_CODE_F: feature.properties?.SF_NPL_CODE_F ?? null,
        SF_NPL_CODE_D: feature.properties?.SF_NPL_CODE_D ?? null,
        SF_NON_NPL_STATUS: feature.properties?.SF_NON_NPL_STATUS ?? null,
        RCRA_HANDLER_NAME: feature.properties?.RCRA_HANDLER_NAME ?? null,
        RCRA_GPRA_CA: feature.properties?.RCRA_GPRA_CA ?? null,
        BF_PROPERTY_NAME: feature.properties?.BF_PROPERTY_NAME ?? null,
        EPAOSC_SITE_ID: feature.properties?.EPAOSC_SITE_ID ?? null,
        EPAOSC_STATUS: feature.properties?.EPAOSC_STATUS ?? null,
        LUST_ID: feature.properties?.LUST_ID ?? null,
        UST_STATUS: feature.properties?.UST_STATUS ?? null,
        DATA_REFRESH_DT: feature.properties?.DATA_REFRESH_DT ?? null,
        GIS_REFRESH_DT: feature.properties?.GIS_REFRESH_DT ?? null,
      },
    }));

  return Object.freeze({ type: 'FeatureCollection', features });
}

export function buildEpaCleanupMetricsSql(parcelInput, featureCollectionInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const source = normalizeEpaCleanupFeatureCollection(featureCollectionInput);
  const parcelJson = JSON.stringify(request.geometry);
  const sourceJson = JSON.stringify(source);

  return `
WITH parcel AS (
  SELECT ST_CollectionExtract(
    ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(parcelJson)}), 4326)),
    3
  ) AS geom
),
source_points AS (
  SELECT
    feature,
    ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326) AS geom,
    COALESCE(NULLIF(feature -> 'properties' ->> 'PRIMARY_NAME', ''), 'Unnamed cleanup site') AS site_name,
    NULLIF(feature -> 'properties' ->> 'REGISTRY_ID', '') AS registry_id,
    NULLIF(feature -> 'properties' ->> 'MAP_SYMBOL_CODE', '') AS map_symbol_code,
    NULLIF(feature -> 'properties' ->> 'URL', '') AS site_url,
    NULLIF(feature -> 'properties' ->> 'SF_SITE_NAME', '') IS NOT NULL AS is_superfund,
    (
      NULLIF(feature -> 'properties' ->> 'RCRA_HANDLER_NAME', '') IS NOT NULL
      OR NULLIF(feature -> 'properties' ->> 'RCRA_GPRA_CA', '') IS NOT NULL
    ) AS is_rcra,
    NULLIF(feature -> 'properties' ->> 'BF_PROPERTY_NAME', '') IS NOT NULL AS is_brownfield,
    (
      NULLIF(feature -> 'properties' ->> 'EPAOSC_SITE_ID', '') IS NOT NULL
      OR NULLIF(feature -> 'properties' ->> 'EPAOSC_STATUS', '') IS NOT NULL
    ) AS is_response,
    (
      NULLIF(feature -> 'properties' ->> 'LUST_ID', '') IS NOT NULL
      OR NULLIF(feature -> 'properties' ->> 'UST_STATUS', '') IS NOT NULL
    ) AS is_storage_tank
  FROM jsonb_array_elements(${sqlTextLiteral(sourceJson)}::jsonb -> 'features') AS feature
),
nearby AS (
  SELECT
    s.*,
    ST_Distance(s.geom::geography, p.geom::geography) AS distance_m,
    ST_Intersects(s.geom, p.geom) AS on_parcel
  FROM source_points s
  CROSS JOIN parcel p
  WHERE ST_DWithin(s.geom::geography, p.geom::geography, 8046.72)
),
nearest AS (
  SELECT *
  FROM nearby
  ORDER BY distance_m, site_name
  LIMIT 1
),
summary AS (
  SELECT
    MIN(distance_m) AS nearest_cleanup_m,
    COUNT(*) FILTER (WHERE on_parcel)::integer AS cleanup_sites_on_parcel,
    COUNT(*) FILTER (WHERE distance_m <= 1609.344)::integer AS cleanup_sites_within_1_mi,
    COUNT(*) FILTER (WHERE distance_m <= 4828.032)::integer AS cleanup_sites_within_3_mi,
    COUNT(*)::integer AS cleanup_sites_within_5_mi,
    COUNT(*) FILTER (WHERE is_superfund)::integer AS superfund_within_5_mi,
    COUNT(*) FILTER (WHERE is_rcra)::integer AS rcra_within_5_mi,
    COUNT(*) FILTER (WHERE is_brownfield)::integer AS brownfields_within_5_mi,
    COUNT(*) FILTER (WHERE is_response)::integer AS responses_within_5_mi,
    COUNT(*) FILTER (WHERE is_storage_tank)::integer AS storage_tank_sites_within_5_mi
  FROM nearby
)
SELECT jsonb_build_object(
  'nearest_cleanup_m', s.nearest_cleanup_m,
  'cleanup_sites_on_parcel', COALESCE(s.cleanup_sites_on_parcel, 0),
  'cleanup_sites_within_1_mi', COALESCE(s.cleanup_sites_within_1_mi, 0),
  'cleanup_sites_within_3_mi', COALESCE(s.cleanup_sites_within_3_mi, 0),
  'cleanup_sites_within_5_mi', COALESCE(s.cleanup_sites_within_5_mi, 0),
  'superfund_within_5_mi', COALESCE(s.superfund_within_5_mi, 0),
  'rcra_within_5_mi', COALESCE(s.rcra_within_5_mi, 0),
  'brownfields_within_5_mi', COALESCE(s.brownfields_within_5_mi, 0),
  'responses_within_5_mi', COALESCE(s.responses_within_5_mi, 0),
  'storage_tank_sites_within_5_mi', COALESCE(s.storage_tank_sites_within_5_mi, 0),
  'nearest_site_name', n.site_name,
  'nearest_registry_id', n.registry_id,
  'nearest_map_symbol_code', n.map_symbol_code,
  'nearest_site_url', n.site_url,
  'nearest_is_superfund', COALESCE(n.is_superfund, false),
  'nearest_is_rcra', COALESCE(n.is_rcra, false),
  'nearest_is_brownfield', COALESCE(n.is_brownfield, false),
  'nearest_is_response', COALESCE(n.is_response, false)
)::text
FROM summary s
LEFT JOIN nearest n ON true;
`.trim();
}
