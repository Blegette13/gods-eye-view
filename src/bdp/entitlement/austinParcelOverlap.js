/**
 * Preliminary parcel-to-Austin-zoning/ETOD polygon intersections.
 * PostGIS is responsible for geometric area calculations. These measures
 * are not zoning verification, entitlement, or acquisition advice.
 * Jurisdiction is excluded because it is currently attributes-only.
 */
import { austinParcelBounds, validateAustinCandidateCollection } from './austinSourceContract.js';

function sqlLiteral(input) {
  return "'" + JSON.stringify(input).replaceAll("'", "''") + "'";
}

export function buildAustinOverlapSql(parcelGeometry, collections) {
  austinParcelBounds(parcelGeometry);
  if (!collections || !collections.zoning || !collections.etodOverlay) {
    throw new Error('Both Austin zoning and ETOD source collections are required');
  }
  const features = [];
  for (const sourceName of ['zoning', 'etodOverlay']) {
    const checked = validateAustinCandidateCollection(sourceName, collections[sourceName]);
    for (const feature of checked.features) {
      features.push({
        sourceName,
        properties: Object.fromEntries(Object.entries(feature.properties).filter(([key]) =>
          sourceName === 'zoning'
            ? ['ZONING_ZTYPE', 'ZONING_BASE'].includes(key)
            : ['ZONING_OVERLAY_NAME', 'ZONING_OVERLAY_SUB_NAME', 'ZONING_STATUS'].includes(key)
        )),
        geometry: feature.geometry,
      });
    }
  }
  const parcelSql = sqlLiteral(parcelGeometry);
  const featuresSql = sqlLiteral(features);
  return `
WITH parcel_geom AS (
  SELECT ST_SetSRID(ST_GeomFromGeoJSON(${parcelSql}), 4326) AS geom
),
parcel AS (
  SELECT
    geom,
    ST_IsValid(geom) AND NOT ST_IsEmpty(geom) AS is_valid,
    CASE WHEN ST_IsValid(geom) AND NOT ST_IsEmpty(geom)
      THEN ST_Area(ST_Transform(geom, 5070)) ELSE NULL END AS parcel_area_m2
  FROM parcel_geom
),
candidate_inputs AS (
  SELECT
    item ->> 'sourceName' AS source_name,
    item -> 'properties' AS attributes,
    ST_SetSRID(ST_GeomFromGeoJSON((item -> 'geometry')::text), 4326) AS geom
  FROM jsonb_array_elements(${featuresSql}::jsonb) AS item
),
candidate AS (
  SELECT source_name, attributes, geom,
    ST_IsValid(geom) AND NOT ST_IsEmpty(geom) AS is_valid
  FROM candidate_inputs
),
overlap AS (
  SELECT c.source_name, c.attributes, c.is_valid AS source_geometry_valid,
    CASE WHEN p.is_valid AND p.parcel_area_m2 > 0 AND c.is_valid
      THEN ST_Intersects(p.geom, c.geom) ELSE NULL END AS intersects_parcel,
    CASE WHEN p.is_valid AND p.parcel_area_m2 > 0 AND c.is_valid
      THEN ST_Area(ST_Transform(ST_Intersection(p.geom, c.geom), 5070))
      ELSE NULL END AS intersect_area_m2,
    p.parcel_area_m2
  FROM candidate c CROSS JOIN parcel p
)
SELECT jsonb_build_object(
  'status', CASE
    WHEN NOT p.is_valid OR p.parcel_area_m2 <= 0 THEN 'invalid-parcel-geometry'
    WHEN EXISTS (SELECT 1 FROM candidate WHERE NOT is_valid) THEN 'invalid-source-geometry'
    ELSE 'preliminary-intersections-only'
  END,
  'parcelAreaM2', p.parcel_area_m2,
  'parcelGeometryValid', p.is_valid,
  'allCandidateGeometriesValid', NOT EXISTS (SELECT 1 FROM candidate WHERE NOT is_valid),
  'exactGeometryIntersectionsCalculated', p.is_valid AND p.parcel_area_m2 > 0
     AND NOT EXISTS (SELECT 1 FROM candidate WHERE NOT is_valid),
  'legalZoningVerified', false,
  'legalJurisdictionVerified', false,
  'sourceCurrencyVerified', false,
  'overlaps', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sourceName', o.source_name,
      'attributes', o.attributes,
      'sourceGeometryValid', o.source_geometry_valid,
      'intersectsParcel', o.intersects_parcel,
      'areaM2', o.intersect_area_m2,
      'parcelPercent', CASE WHEN o.parcel_area_m2 > 0 AND o.intersect_area_m2 IS NOT NULL
        THEN 100.0 * o.intersect_area_m2 / o.parcel_area_m2 ELSE NULL END
    ) ORDER BY o.source_name, o.attributes::text)
    FROM overlap o
  ), '[]'::jsonb)
)::text
FROM parcel p;
`.trim();
}

export function summarizeAustinOverlapQuery(result) {
  if (!result || result.status !== 'preliminary-intersections-only'
    || result.exactGeometryIntersectionsCalculated !== true
    || result.parcelGeometryValid !== true
    || result.allCandidateGeometriesValid !== true
    || !Number.isFinite(Number(result.parcelAreaM2))
    || Number(result.parcelAreaM2) <= 0
    || !Array.isArray(result.overlaps)) {
    throw new Error('Austin PostGIS intersections are incomplete or invalid; retain UNKNOWN');
  }
  const observations = result.overlaps.map((entry) => {
    const area = entry.areaM2;
    const pct = entry.parcelPercent;
    if (!['zoning', 'etodOverlay'].includes(entry.sourceName)
      || entry.sourceGeometryValid !== true
      || typeof entry.intersectsParcel !== 'boolean'
      || area === null || area === undefined || pct === null || pct === undefined
      || !Number.isFinite(Number(area)) || Number(area) < 0
      || !Number.isFinite(Number(pct)) || Number(pct) < 0 || Number(pct) > 100.0001) {
      throw new Error('Austin PostGIS returned an invalid source measurement; retain UNKNOWN');
    }
    return {
      sourceName: entry.sourceName,
      attributes: entry.attributes,
      intersectsParcel: entry.intersectsParcel,
      areaM2: Number(area),
      parcelPercent: Number(pct),
    };
  });
  return Object.freeze({
    status: 'preliminary-spatial-evidence',
    parcelAreaM2: Number(result.parcelAreaM2),
    observations,
    sourceCandidatePresence: Object.freeze({
      zoning: observations.some((item) => item.sourceName === 'zoning'),
      etodOverlay: observations.some((item) => item.sourceName === 'etodOverlay'),
    }),
    emptySourceMeansUnknown: true, // no GIS candidates is not a legal clearance
    sourceTotalsNotSummed: true, // overlapping polygons can double-count
    legalZoningVerified: false,
    legalJurisdictionVerified: false,
    sourceCurrencyVerified: false,
    acquisitionRecommendation: null,
  });
}
