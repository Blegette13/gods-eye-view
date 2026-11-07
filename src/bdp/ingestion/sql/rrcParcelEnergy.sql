-- BDP Land Intelligence: parcel-level Railroad Commission energy metrics
--
-- Geometry math belongs in PostGIS, not the LLM. This function accepts a
-- parcel polygon and returns screening metrics that can feed the BDP score and
-- property card. RRC GIS is treated as preliminary screening data; survey,
-- title, easement and operator verification remain separate due-diligence work.

CREATE OR REPLACE FUNCTION bdp_rrc_parcel_energy_metrics(
  p_parcel geometry,
  p_county_fips TEXT DEFAULT NULL
)
RETURNS TABLE (
  nearest_well_m DOUBLE PRECISION,
  wells_within_1_mi INTEGER,
  wells_within_2_mi INTEGER,
  wells_within_5_mi INTEGER,
  nearest_pipeline_m DOUBLE PRECISION,
  pipeline_crossing_count INTEGER,
  pipeline_length_on_parcel_m DOUBLE PRECISION
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
WITH parcel AS (
  SELECT CASE
    WHEN ST_SRID(p_parcel) = 4326 THEN ST_MakeValid(p_parcel)
    WHEN ST_SRID(p_parcel) = 0 THEN ST_SetSRID(ST_MakeValid(p_parcel), 4326)
    ELSE ST_Transform(ST_MakeValid(p_parcel), 4326)
  END AS geom
),
nearest_well AS (
  SELECT ST_Distance(w.geom::geography, p.geom::geography) AS distance_m
  FROM bdp_rrc_wells w
  CROSS JOIN parcel p
  WHERE p_county_fips IS NULL OR w.county_fips = p_county_fips
  ORDER BY w.geom <-> ST_PointOnSurface(p.geom)
  LIMIT 1
),
well_counts AS (
  SELECT
    COUNT(*) FILTER (
      WHERE ST_DWithin(w.geom::geography, p.geom::geography, 1609.344)
    )::INTEGER AS within_1_mi,
    COUNT(*) FILTER (
      WHERE ST_DWithin(w.geom::geography, p.geom::geography, 3218.688)
    )::INTEGER AS within_2_mi,
    COUNT(*) FILTER (
      WHERE ST_DWithin(w.geom::geography, p.geom::geography, 8046.72)
    )::INTEGER AS within_5_mi
  FROM bdp_rrc_wells w
  CROSS JOIN parcel p
  WHERE (p_county_fips IS NULL OR w.county_fips = p_county_fips)
    AND ST_DWithin(w.geom::geography, p.geom::geography, 8046.72)
),
nearest_pipeline AS (
  SELECT ST_Distance(pl.geom::geography, p.geom::geography) AS distance_m
  FROM bdp_rrc_pipelines pl
  CROSS JOIN parcel p
  WHERE p_county_fips IS NULL OR pl.county_fips = p_county_fips
  ORDER BY pl.geom <-> ST_PointOnSurface(p.geom)
  LIMIT 1
),
pipeline_crossings AS (
  SELECT
    COUNT(*)::INTEGER AS crossing_count,
    COALESCE(
      SUM(
        ST_Length(
          ST_CollectionExtract(ST_Intersection(pl.geom, p.geom), 2)::geography
        )
      ),
      0
    )::DOUBLE PRECISION AS length_on_parcel_m
  FROM bdp_rrc_pipelines pl
  CROSS JOIN parcel p
  WHERE (p_county_fips IS NULL OR pl.county_fips = p_county_fips)
    AND ST_Intersects(pl.geom, p.geom)
)
SELECT
  nearest_well.distance_m AS nearest_well_m,
  COALESCE(well_counts.within_1_mi, 0) AS wells_within_1_mi,
  COALESCE(well_counts.within_2_mi, 0) AS wells_within_2_mi,
  COALESCE(well_counts.within_5_mi, 0) AS wells_within_5_mi,
  nearest_pipeline.distance_m AS nearest_pipeline_m,
  COALESCE(pipeline_crossings.crossing_count, 0) AS pipeline_crossing_count,
  COALESCE(pipeline_crossings.length_on_parcel_m, 0) AS pipeline_length_on_parcel_m
FROM well_counts
FULL JOIN nearest_well ON TRUE
FULL JOIN nearest_pipeline ON TRUE
FULL JOIN pipeline_crossings ON TRUE;
$$;
