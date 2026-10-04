-- BDP Land Intelligence: parcel-level TCEQ MSW screening
--
-- A TCEQ point on a parcel is not proof that the entire facility/disposal area
-- lies on the parcel because published coordinates may be a gate, benchmark,
-- centroid, or other point. Treat all outputs as due-diligence screening.

CREATE OR REPLACE FUNCTION bdp_tceq_parcel_msw_metrics(
  p_parcel geometry
)
RETURNS TABLE (
  nearest_msw_site_m DOUBLE PRECISION,
  nearest_site_name TEXT,
  nearest_site_dataset TEXT,
  nearest_site_type TEXT,
  nearest_site_status TEXT,
  msw_points_on_parcel INTEGER,
  active_landfills_within_1_mi INTEGER,
  active_landfills_within_3_mi INTEGER,
  closed_sites_within_1_mi INTEGER,
  closed_sites_within_3_mi INTEGER,
  unauthorized_sites_within_1_mi INTEGER,
  unauthorized_sites_within_3_mi INTEGER,
  hazardous_history_sites_within_3_mi INTEGER,
  all_msw_sites_within_5_mi INTEGER
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
  SELECT
    s.*,
    ST_Distance(s.geom::geography, p.geom::geography) AS distance_m,
    ST_Intersects(s.geom, p.geom) AS on_parcel,
    (
      s.source_dataset = 'facilities'
      AND LOWER(COALESCE(s.physical_status, '')) = 'active'
      AND (
        LOWER(COALESCE(s.facility_type, '')) LIKE '%landfill%'
        OR LOWER(COALESCE(s.facility_type, '')) SIMILAR TO '%(1|1ae|2|3|4|4ae)%'
      )
    ) AS is_active_landfill,
    (s.source_dataset = 'closed' OR LOWER(COALESCE(s.physical_status, '')) IN ('closed', 'post closure')) AS is_closed,
    (s.unauthorized IS TRUE OR s.source_dataset = 'unnumbered') AS is_unauthorized_history,
    (
      s.hazardous_waste_confirmed IS TRUE
      OR s.hazardous_waste_probable IS TRUE
    ) AS has_hazardous_history
  FROM bdp_tceq_msw_sites s
  CROSS JOIN parcel p
  WHERE s.geom IS NOT NULL
    AND ST_DWithin(s.geom::geography, p.geom::geography, 8046.72)
),
nearest AS (
  SELECT * FROM nearby ORDER BY distance_m LIMIT 1
),
summary AS (
  SELECT
    COUNT(*) FILTER (WHERE on_parcel)::INTEGER AS on_parcel_count,
    COUNT(*) FILTER (WHERE is_active_landfill AND distance_m <= 1609.344)::INTEGER AS active_1,
    COUNT(*) FILTER (WHERE is_active_landfill AND distance_m <= 4828.032)::INTEGER AS active_3,
    COUNT(*) FILTER (WHERE is_closed AND distance_m <= 1609.344)::INTEGER AS closed_1,
    COUNT(*) FILTER (WHERE is_closed AND distance_m <= 4828.032)::INTEGER AS closed_3,
    COUNT(*) FILTER (WHERE is_unauthorized_history AND distance_m <= 1609.344)::INTEGER AS unauth_1,
    COUNT(*) FILTER (WHERE is_unauthorized_history AND distance_m <= 4828.032)::INTEGER AS unauth_3,
    COUNT(*) FILTER (WHERE has_hazardous_history AND distance_m <= 4828.032)::INTEGER AS haz_3,
    COUNT(*)::INTEGER AS all_5
  FROM nearby
)
SELECT
  n.distance_m,
  n.site_name,
  n.source_dataset,
  n.facility_type,
  n.physical_status,
  COALESCE(s.on_parcel_count, 0),
  COALESCE(s.active_1, 0),
  COALESCE(s.active_3, 0),
  COALESCE(s.closed_1, 0),
  COALESCE(s.closed_3, 0),
  COALESCE(s.unauth_1, 0),
  COALESCE(s.unauth_3, 0),
  COALESCE(s.haz_3, 0),
  COALESCE(s.all_5, 0)
FROM summary s
LEFT JOIN nearest n ON true;
$$;
