import { normalizeWetlandsParcelRequest } from '../environment/wetlandsContract.js';

export const BDP_CULTURAL_API_BASE = '/api/bdp/cultural';
export const THC_CEMETERY_LAYER_URL =
  'https://services7.arcgis.com/2hv9bZMrcgZpr7i9/ArcGIS/rest/services/Historical/FeatureServer/5';
export const THC_CEMETERY_MAX_FEATURES = 2_000;
export const THC_CEMETERY_PAD_DEGREES = 0.08;

const OUT_FIELDS = [
  'OBJECTID',
  'CEMNUM',
  'CEMNAME',
  'Add_Name',
  'CEMTYPE',
  'County',
  'AtlasNum',
  'Source',
  'Notes',
  'Calc_Acres',
  'last_edited_date',
].join(',');

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function paddedBounds(bounds, pad = THC_CEMETERY_PAD_DEGREES) {
  return Object.freeze({
    west: Math.max(-180, bounds.west - pad),
    south: Math.max(-90, bounds.south - pad),
    east: Math.min(180, bounds.east + pad),
    north: Math.min(90, bounds.north + pad),
  });
}

export function buildThcCemeteryParcelQueryUrl(parcelInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const bounds = paddedBounds(request.bounds);
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(THC_CEMETERY_MAX_FEATURES),
    f: 'geojson',
  });
  return `${THC_CEMETERY_LAYER_URL}/query?${params.toString()}`;
}

export function normalizeThcCemeteryFeatureCollection(input) {
  if (!input || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error('Texas Historical Commission cemetery service returned malformed GeoJSON');
  }
  if (input.features.length >= THC_CEMETERY_MAX_FEATURES) {
    throw new Error('THC cemetery screening result is capped; narrow the parcel vicinity before relying on metrics');
  }

  const features = input.features
    .filter((feature) => feature?.geometry && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type))
    .map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        OBJECTID: feature.properties?.OBJECTID ?? null,
        CEMNUM: feature.properties?.CEMNUM ?? null,
        CEMNAME: feature.properties?.CEMNAME ?? null,
        Add_Name: feature.properties?.Add_Name ?? null,
        CEMTYPE: feature.properties?.CEMTYPE ?? null,
        County: feature.properties?.County ?? null,
        AtlasNum: feature.properties?.AtlasNum ?? feature.properties?.ATLAS_NUM ?? null,
        Source: feature.properties?.Source ?? null,
        Notes: feature.properties?.Notes ?? null,
        Calc_Acres: feature.properties?.Calc_Acres ?? null,
        last_edited_date: feature.properties?.last_edited_date ?? null,
      },
    }));

  return Object.freeze({ type: 'FeatureCollection', features });
}

export function buildThcCemeteryMetricsSql(parcelInput, featureCollectionInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const cemeteries = normalizeThcCemeteryFeatureCollection(featureCollectionInput);
  const parcelJson = JSON.stringify(request.geometry);
  const cemeteryJson = JSON.stringify(cemeteries);

  return `
WITH parcel AS (
  SELECT ST_CollectionExtract(
    ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(parcelJson)}), 4326)),
    3
  ) AS geom
),
cemetery_source AS (
  SELECT
    feature,
    ST_CollectionExtract(
      ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)),
      3
    ) AS geom,
    NULLIF(feature -> 'properties' ->> 'CEMNAME', '') AS name,
    NULLIF(feature -> 'properties' ->> 'CEMTYPE', '') AS cemetery_type,
    NULLIF(feature -> 'properties' ->> 'CEMNUM', '') AS cemetery_number,
    NULLIF(feature -> 'properties' ->> 'AtlasNum', '') AS atlas_number
  FROM jsonb_array_elements(${sqlTextLiteral(cemeteryJson)}::jsonb -> 'features') AS feature
),
nearby AS (
  SELECT
    c.*,
    ST_Distance(c.geom::geography, p.geom::geography) AS distance_m,
    ST_Intersects(c.geom, p.geom) AS intersects,
    CASE
      WHEN ST_Intersects(c.geom, p.geom)
      THEN ST_Area(ST_Intersection(c.geom, p.geom)::geography)
      ELSE 0
    END AS overlap_m2
  FROM cemetery_source c
  CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(c.geom)
    AND ST_DWithin(c.geom::geography, p.geom::geography, 8046.72)
),
nearest AS (
  SELECT *
  FROM nearby
  ORDER BY distance_m, name NULLS LAST
  LIMIT 1
),
summary AS (
  SELECT
    COUNT(*) FILTER (WHERE intersects)::integer AS intersecting_count,
    COALESCE(SUM(overlap_m2), 0)::double precision AS overlap_m2,
    COUNT(*) FILTER (WHERE distance_m <= 1609.344)::integer AS within_1_mi,
    COUNT(*) FILTER (WHERE distance_m <= 4828.032)::integer AS within_3_mi,
    COUNT(*)::integer AS within_5_mi
  FROM nearby
),
parcel_stats AS (
  SELECT ST_Area(geom::geography) AS area_m2
  FROM parcel
)
SELECT jsonb_build_object(
  'nearest_cemetery_m', n.distance_m,
  'nearest_cemetery_name', n.name,
  'nearest_cemetery_type', n.cemetery_type,
  'nearest_cemetery_number', n.cemetery_number,
  'nearest_atlas_number', n.atlas_number,
  'cemeteries_intersecting_parcel', s.intersecting_count,
  'cemetery_overlap_acres', s.overlap_m2 / 4046.8564224,
  'cemetery_overlap_percent',
    CASE WHEN ps.area_m2 > 0 THEN LEAST(100.0, s.overlap_m2 / ps.area_m2 * 100.0) ELSE 0 END,
  'cemeteries_within_1_mi', s.within_1_mi,
  'cemeteries_within_3_mi', s.within_3_mi,
  'cemeteries_within_5_mi', s.within_5_mi,
  'archaeology_public_screen_status', 'restricted-location-data-not-screened'
)::text
FROM summary s
CROSS JOIN parcel_stats ps
LEFT JOIN nearest n ON true;
`.trim();
}
