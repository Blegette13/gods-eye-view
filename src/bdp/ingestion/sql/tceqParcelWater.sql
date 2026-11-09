-- BDP Land Intelligence: parcel-level TCEQ surface-water screening
--
-- These metrics describe spatial proximity to mapped TCEQ water-right points.
-- They do NOT establish that a parcel owns, conveys, or may exercise a water
-- right. Ownership/authorization must be verified from TCEQ records and title.

CREATE OR REPLACE FUNCTION bdp_tceq_parcel_water_metrics(
  p_parcel geometry
)
RETURNS TABLE (
  nearest_water_right_point_m DOUBLE PRECISION,
  water_right_points_on_parcel INTEGER,
  water_right_points_within_1_mi INTEGER,
  water_right_points_within_5_mi INTEGER,
  distinct_water_rights_within_5_mi INTEGER
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
nearby AS (
  SELECT pnt.*,
    ST_Distance(pnt.geom::geography, p.geom::geography) AS distance_m,
    ST_Intersects(pnt.geom, p.geom) AS on_parcel
  FROM bdp_tceq_water_right_points pnt
  CROSS JOIN parcel p
  WHERE ST_DWithin(pnt.geom::geography, p.geom::geography, 8046.72)
),
summary AS (
  SELECT
    MIN(distance_m) AS nearest_m,
    COUNT(*) FILTER (WHERE on_parcel)::INTEGER AS on_parcel_count,
    COUNT(*) FILTER (WHERE distance_m <= 1609.344)::INTEGER AS within_1_mi,
    COUNT(*)::INTEGER AS within_5_mi,
    COUNT(DISTINCT water_right_id) FILTER (WHERE water_right_id IS NOT NULL)::INTEGER
      AS distinct_rights_within_5_mi
  FROM nearby
)
SELECT
  nearest_m,
  COALESCE(on_parcel_count, 0),
  COALESCE(within_1_mi, 0),
  COALESCE(within_5_mi, 0),
  COALESCE(distinct_rights_within_5_mi, 0)
FROM summary;
$$;
