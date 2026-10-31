import { normalizeWetlandsParcelRequest, normalizeNwiFeatureCollection } from '../environment/wetlandsContract.js';
import { normalizeFemaFeatureCollection, FEMA_EVALUATED_ZONE_PATTERN } from '../environment/floodContract.js';

export const DEVELOPMENT_CONSTRAINT_NOTICE = 'Mapped FEMA flood hazards (including moderate hazard) and NWI wetland/water features are screening constraints. Their combined footprint counts overlap once. Land outside this footprint is not verified buildable acreage: jurisdictional wetlands, unmapped flood risk, slopes, setbacks, easements, title, legal access, utility capacity, soils and entitlement remain separate reviews.';

function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }

/** Spatial arithmetic stays in PostGIS; no acreage is inferred by AI or added percentages. */
export function buildDevelopmentConstraintSql(parcelInput, { flood, wetlands }) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const fema = normalizeFemaFeatureCollection(flood);
  const nwi = normalizeNwiFeatureCollection(wetlands);
  return `
WITH parcel AS (
  SELECT ST_CollectionExtract(ST_MakeValid(ST_SetSRID(
    ST_GeomFromGeoJSON(${literal(JSON.stringify(request.geometry))}),4326)),3) AS geom
), fema_rows AS (
  SELECT ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(feature->'geometry'),4326)),3) AS geom,
    feature->'properties'->>'bdp_class' AS hazard_class,
    UPPER(BTRIM(COALESCE(feature->'properties'->>'FLD_ZONE',''))) AS zone
  FROM jsonb_array_elements(${literal(JSON.stringify(fema))}::jsonb->'features') AS feature
), nwi_rows AS (
  SELECT ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(feature->'geometry'),4326)),3) AS geom
  FROM jsonb_array_elements(${literal(JSON.stringify(nwi))}::jsonb->'features') AS feature
), footprints AS (
  SELECT
    COALESCE((SELECT ST_UnaryUnion(ST_Collect(geom)) FROM fema_rows WHERE hazard_class IN ('floodway','sfha','moderate')),ST_GeomFromText('POLYGON EMPTY',4326)) AS flood_geom,
    COALESCE((SELECT ST_UnaryUnion(ST_Collect(geom)) FROM nwi_rows),ST_GeomFromText('POLYGON EMPTY',4326)) AS wetland_geom,
    COALESCE((SELECT ST_UnaryUnion(ST_Collect(geom)) FROM fema_rows WHERE zone ~ '${FEMA_EVALUATED_ZONE_PATTERN}'),ST_GeomFromText('POLYGON EMPTY',4326)) AS evaluated_fema_geom
), clipped AS (
  SELECT p.geom,
    ST_CollectionExtract(ST_Intersection(p.geom,f.flood_geom),3) AS flood_geom,
    ST_CollectionExtract(ST_Intersection(p.geom,f.wetland_geom),3) AS wetland_geom,
    ST_CollectionExtract(ST_Intersection(p.geom,f.evaluated_fema_geom),3) AS evaluated_fema_geom
  FROM parcel p CROSS JOIN footprints f
), areas AS (
  SELECT ST_Area(geom::geography) AS parcel_m2,
    ST_Area(flood_geom::geography) AS flood_m2,
    ST_Area(wetland_geom::geography) AS wetland_m2,
    ST_Area(ST_CollectionExtract(ST_Intersection(flood_geom,wetland_geom),3)::geography) AS shared_m2,
    ST_Area(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(flood_geom,wetland_geom)),3)::geography) AS combined_m2,
    ST_Area(evaluated_fema_geom::geography) AS evaluated_fema_m2
  FROM clipped
)
SELECT jsonb_build_object(
  'status',CASE WHEN parcel_m2 > 0 AND evaluated_fema_m2 / parcel_m2 >= 0.995 THEN 'preliminary-footprint' ELSE 'incomplete-fema-coverage' END,
  'parcel_acres',parcel_m2 / 4046.8564224,
  'mapped_flood_acres',flood_m2 / 4046.8564224,
  'mapped_nwi_acres',wetland_m2 / 4046.8564224,
  'shared_flood_nwi_acres',shared_m2 / 4046.8564224,
  'combined_mapped_constraint_acres',combined_m2 / 4046.8564224,
  'combined_mapped_constraint_percent',CASE WHEN parcel_m2 > 0 THEN 100 * combined_m2 / parcel_m2 ELSE NULL END,
  'fema_evaluated_coverage_percent',CASE WHEN parcel_m2 > 0 THEN 100 * evaluated_fema_m2 / parcel_m2 ELSE NULL END,
  'outside_mapped_footprint_acres',CASE WHEN parcel_m2 > 0 AND evaluated_fema_m2 / parcel_m2 >= 0.995 THEN GREATEST(parcel_m2-combined_m2,0) / 4046.8564224 ELSE NULL END,
  'verified_buildable_acres',NULL,
  'development_score_ready',false,
  'nwi_jurisdiction_verified',false,
  'source','FEMA NFHL + USFWS NWI; PostGIS parcel clipping and union',
  'notice',${literal(DEVELOPMENT_CONSTRAINT_NOTICE)}
)::text FROM areas;
`.trim();
}
