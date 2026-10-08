import { normalizeWetlandsParcelRequest } from '../environment/wetlandsContract.js';

export const TXDOT_ROADWAYS_LAYER_URL =
  'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/ArcGIS/rest/services/TxDOT_Roadways/FeatureServer/0';
export const TXDOT_AADT_LAYER_URL =
  'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_AADT/FeatureServer/0';
export const TXDOT_AADT_HISTORY_LAYER_URL =
  'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/ArcGIS/rest/services/TxDOT_5_Year_Statewide_AADT_Traffic_Counts/FeatureServer/0';

const SOURCE_MAX_FEATURES = 2_000;
const ROAD_QUERY_PAD_DEGREES = 0.08;
const HISTORY_QUERY_PAD_DEGREES = 0.12;

const ROAD_FIELDS = [
  'OBJECTID', 'RTE_NM', 'RTE_PRFX', 'RTE_NBR', 'RTE_SFX', 'RDBD_TYPE',
  'DES_DRCT', 'COUNTY', 'MAP_LBL', 'EXT_DATE', 'SYSTEM',
].join(',');
const AADT_FIELDS = [
  'OBJECTID', 'RTE_NM', 'RTE_PRFX', 'RTE_NBR', 'RDBD_TYPE', 'AADT_CUR',
  'ASSET_ID', 'SYSTEM', 'EXT_DATE',
].join(',');
const HISTORY_FIELDS = [
  'OBJECTID_1', 'DIST_NM', 'CNTY_NM', 'TRFC_STATN_ID', 'LATEST_AADT_YR',
  'AADT_RPT_QTY', 'AADT_RPT_HIST_01_QTY', 'AADT_RPT_HIST_02_QTY',
  'AADT_RPT_HIST_03_QTY', 'AADT_RPT_HIST_04_QTY',
].join(',');

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function paddedBounds(bounds, pad) {
  return {
    west: Math.max(-180, bounds.west - pad),
    south: Math.max(-90, bounds.south - pad),
    east: Math.min(180, bounds.east + pad),
    north: Math.min(90, bounds.north + pad),
  };
}

function featureQueryUrl(layerUrl, bounds, fields) {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: fields,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(SOURCE_MAX_FEATURES),
    f: 'geojson',
  });
  return `${layerUrl}/query?${params.toString()}`;
}

export function buildTxdotParcelQueryUrls(parcelInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const roadBounds = paddedBounds(request.bounds, ROAD_QUERY_PAD_DEGREES);
  const historyBounds = paddedBounds(request.bounds, HISTORY_QUERY_PAD_DEGREES);
  return Object.freeze({
    roadways: featureQueryUrl(TXDOT_ROADWAYS_LAYER_URL, roadBounds, ROAD_FIELDS),
    aadt: featureQueryUrl(TXDOT_AADT_LAYER_URL, roadBounds, AADT_FIELDS),
    history: featureQueryUrl(TXDOT_AADT_HISTORY_LAYER_URL, historyBounds, HISTORY_FIELDS),
  });
}

function normalizeCollection(input, { geometryType, label, fields }) {
  if (!input || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error(`${label} returned malformed GeoJSON`);
  }
  if (input.features.length >= SOURCE_MAX_FEATURES) {
    throw new Error(`${label} screening result is capped; narrow the parcel vicinity before relying on proximity metrics`);
  }
  const features = input.features
    .filter((feature) => feature?.geometry?.type === geometryType || (
      geometryType === 'MultiLineString' && feature?.geometry?.type === 'LineString'
    ))
    .map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: Object.fromEntries(fields.map((field) => [field, feature.properties?.[field] ?? null])),
    }));
  return Object.freeze({ type: 'FeatureCollection', features });
}

export function normalizeTxdotRoadways(input) {
  return normalizeCollection(input, {
    geometryType: 'MultiLineString',
    label: 'TxDOT roadway service',
    fields: ROAD_FIELDS.split(','),
  });
}

export function normalizeTxdotAadt(input) {
  return normalizeCollection(input, {
    geometryType: 'MultiLineString',
    label: 'TxDOT AADT service',
    fields: AADT_FIELDS.split(','),
  });
}

export function normalizeTxdotAadtHistory(input) {
  return normalizeCollection(input, {
    geometryType: 'Point',
    label: 'TxDOT AADT history service',
    fields: HISTORY_FIELDS.split(','),
  });
}

export function buildTxdotParcelMetricsSql(parcelInput, { roadways, aadt, history }) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const roads = normalizeTxdotRoadways(roadways);
  const traffic = normalizeTxdotAadt(aadt);
  const stations = normalizeTxdotAadtHistory(history);
  const parcelJson = JSON.stringify(request.geometry);
  const roadsJson = JSON.stringify(roads);
  const aadtJson = JSON.stringify(traffic);
  const historyJson = JSON.stringify(stations);

  return `
WITH parcel AS (
  SELECT ST_CollectionExtract(
    ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(parcelJson)}), 4326)), 3
  ) AS geom
),
road_rows AS (
  SELECT
    feature,
    ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326) AS geom,
    NULLIF(feature -> 'properties' ->> 'RTE_NM', '') AS route_name,
    NULLIF(feature -> 'properties' ->> 'RTE_PRFX', '') AS route_prefix,
    NULLIF(feature -> 'properties' ->> 'RTE_NBR', '') AS route_number,
    NULLIF(feature -> 'properties' ->> 'MAP_LBL', '') AS map_label,
    NULLIF(feature -> 'properties' ->> 'SYSTEM', '') AS system,
    NULLIF(feature -> 'properties' ->> 'EXT_DATE', '') AS extract_date
  FROM jsonb_array_elements(${sqlTextLiteral(roadsJson)}::jsonb -> 'features') AS feature
),
road_nearby AS (
  SELECT r.*, ST_Distance(r.geom::geography, p.geom::geography) AS distance_m,
    ST_Intersects(r.geom, p.geom) AS centerline_intersects
  FROM road_rows r CROSS JOIN parcel p
  WHERE ST_DWithin(r.geom::geography, p.geom::geography, 8046.72)
),
nearest_road AS (
  SELECT * FROM road_nearby ORDER BY distance_m, COALESCE(route_name, map_label) LIMIT 1
),
aadt_rows AS (
  SELECT
    feature,
    ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326) AS geom,
    NULLIF(feature -> 'properties' ->> 'RTE_NM', '') AS route_name,
    NULLIF(feature -> 'properties' ->> 'RTE_PRFX', '') AS route_prefix,
    NULLIF(feature -> 'properties' ->> 'RTE_NBR', '') AS route_number,
    NULLIF(feature -> 'properties' ->> 'SYSTEM', '') AS system,
    NULLIF(feature -> 'properties' ->> 'EXT_DATE', '') AS extract_date,
    NULLIF(feature -> 'properties' ->> 'AADT_CUR', '')::double precision AS aadt_current
  FROM jsonb_array_elements(${sqlTextLiteral(aadtJson)}::jsonb -> 'features') AS feature
),
aadt_nearby AS (
  SELECT a.*, ST_Distance(a.geom::geography, p.geom::geography) AS distance_m
  FROM aadt_rows a CROSS JOIN parcel p
  WHERE ST_DWithin(a.geom::geography, p.geom::geography, 8046.72)
),
nearest_aadt AS (
  SELECT * FROM aadt_nearby ORDER BY distance_m, route_name LIMIT 1
),
history_rows AS (
  SELECT
    feature,
    ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326) AS geom,
    NULLIF(feature -> 'properties' ->> 'TRFC_STATN_ID', '') AS station_id,
    NULLIF(feature -> 'properties' ->> 'CNTY_NM', '') AS county_name,
    NULLIF(feature -> 'properties' ->> 'LATEST_AADT_YR', '')::integer AS latest_year,
    NULLIF(feature -> 'properties' ->> 'AADT_RPT_QTY', '')::double precision AS count_current,
    NULLIF(feature -> 'properties' ->> 'AADT_RPT_HIST_01_QTY', '')::double precision AS count_1yr,
    NULLIF(feature -> 'properties' ->> 'AADT_RPT_HIST_02_QTY', '')::double precision AS count_2yr,
    NULLIF(feature -> 'properties' ->> 'AADT_RPT_HIST_03_QTY', '')::double precision AS count_3yr,
    NULLIF(feature -> 'properties' ->> 'AADT_RPT_HIST_04_QTY', '')::double precision AS count_4yr
  FROM jsonb_array_elements(${sqlTextLiteral(historyJson)}::jsonb -> 'features') AS feature
),
history_nearby AS (
  SELECT h.*, ST_Distance(h.geom::geography, p.geom::geography) AS distance_m
  FROM history_rows h CROSS JOIN parcel p
  WHERE ST_DWithin(h.geom::geography, p.geom::geography, 16093.44)
),
nearest_station AS (
  SELECT * FROM history_nearby ORDER BY distance_m, station_id LIMIT 1
),
road_summary AS (
  SELECT
    COUNT(*) FILTER (WHERE distance_m <= 76.2)::integer AS road_centerlines_within_250_ft,
    COUNT(*) FILTER (WHERE distance_m <= 1609.344)::integer AS road_centerlines_within_1_mi
  FROM road_nearby
),
aadt_summary AS (
  SELECT COUNT(*) FILTER (WHERE distance_m <= 1609.344)::integer AS aadt_segments_within_1_mi
  FROM aadt_nearby
)
SELECT jsonb_build_object(
  'nearest_road_m', nr.distance_m,
  'nearest_road_name', COALESCE(nr.map_label, nr.route_name),
  'nearest_road_route_name', nr.route_name,
  'nearest_road_prefix', nr.route_prefix,
  'nearest_road_number', nr.route_number,
  'nearest_road_system', nr.system,
  'nearest_road_extract_date', nr.extract_date,
  'road_centerline_intersects_parcel', COALESCE(nr.centerline_intersects, false),
  'road_centerlines_within_250_ft', COALESCE(rs.road_centerlines_within_250_ft, 0),
  'road_centerlines_within_1_mi', COALESCE(rs.road_centerlines_within_1_mi, 0),
  'nearest_aadt_m', na.distance_m,
  'nearest_aadt_route', na.route_name,
  'nearest_aadt_current', na.aadt_current,
  'nearest_aadt_extract_date', na.extract_date,
  'aadt_segments_within_1_mi', COALESCE(ads.aadt_segments_within_1_mi, 0),
  'nearest_station_m', ns.distance_m,
  'nearest_station_id', ns.station_id,
  'nearest_station_latest_year', ns.latest_year,
  'nearest_station_count_current', ns.count_current,
  'nearest_station_count_1yr', ns.count_1yr,
  'nearest_station_count_2yr', ns.count_2yr,
  'nearest_station_count_3yr', ns.count_3yr,
  'nearest_station_count_4yr', ns.count_4yr,
  'nearest_station_5yr_change_percent', CASE
    WHEN ns.count_4yr IS NOT NULL AND ns.count_4yr > 0 AND ns.count_current IS NOT NULL
      THEN ((ns.count_current - ns.count_4yr) / ns.count_4yr) * 100.0
    ELSE NULL
  END
)::text
FROM road_summary rs
CROSS JOIN aadt_summary ads
LEFT JOIN nearest_road nr ON true
LEFT JOIN nearest_aadt na ON true
LEFT JOIN nearest_station ns ON true;
`.trim();
}
