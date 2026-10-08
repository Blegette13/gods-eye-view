-- PUCT sewer CCN mapped service territories. These are not current retail
-- service boundaries, collection mains, capacity, tap availability, or a
-- will-serve commitment. No import means coverage unknown.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS bdp_puct_sewer_ccn (
  id BIGSERIAL PRIMARY KEY,
  ccn_no TEXT,
  utility TEXT,
  dba_name TEXT,
  county TEXT,
  status TEXT,
  ccn_type TEXT,
  geom geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS bdp_puct_sewer_ccn_geom_gix ON bdp_puct_sewer_ccn USING GIST (geom);

CREATE TABLE IF NOT EXISTS bdp_puct_sewer_ccn_snapshot (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  source_url TEXT NOT NULL,
  source_last_modified TIMESTAMPTZ,
  checksum_sha256 TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  feature_count INTEGER NOT NULL CHECK (feature_count > 0)
);

CREATE OR REPLACE FUNCTION bdp_puct_sewer_ccn_metrics(parcel geometry)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE result JSONB;
BEGIN
  IF parcel IS NULL OR ST_IsEmpty(parcel) OR ST_SRID(parcel) <> 4326
     OR ST_GeometryType(parcel) NOT IN ('ST_Polygon','ST_MultiPolygon') THEN
    RAISE EXCEPTION 'A WGS84 parcel polygon is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bdp_puct_sewer_ccn_snapshot WHERE singleton) THEN
    RETURN jsonb_build_object('sewer_ccn_coverage', 'not-ingested',
      'sewer_ccn_overlap_percent', NULL, 'sewer_ccn_utilities', '[]'::jsonb,
      'sewer_ccn_numbers', '[]'::jsonb, 'sewer_ccn_source_last_modified', NULL);
  END IF;
  WITH p AS (
    SELECT ST_CollectionExtract(ST_MakeValid(parcel), 3) AS geom
  ), hits AS (
    SELECT c.* FROM bdp_puct_sewer_ccn c CROSS JOIN p
    WHERE c.geom && p.geom AND ST_Intersects(c.geom, p.geom)
  ), cover AS (
    SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom FROM hits
  )
  SELECT jsonb_build_object(
    'sewer_ccn_coverage', CASE WHEN (SELECT source_last_modified FROM bdp_puct_sewer_ccn_snapshot WHERE singleton)
      IS NULL OR (SELECT source_last_modified FROM bdp_puct_sewer_ccn_snapshot WHERE singleton) < NOW() - INTERVAL '180 days'
      THEN 'stale-or-unverified' ELSE 'mapped-snapshot' END,
    'sewer_ccn_count', (SELECT COUNT(*) FROM hits),
    'sewer_ccn_utilities', (SELECT COALESCE(jsonb_agg(DISTINCT utility) FILTER (WHERE utility IS NOT NULL), '[]'::jsonb) FROM hits),
    'sewer_ccn_numbers', (SELECT COALESCE(jsonb_agg(DISTINCT ccn_no) FILTER (WHERE ccn_no IS NOT NULL), '[]'::jsonb) FROM hits),
    'sewer_ccn_overlap_percent', CASE WHEN c.geom IS NULL OR ST_Area(p.geom::geography) <= 0 THEN 0
      ELSE LEAST(100.0, 100.0 * ST_Area(ST_Intersection(p.geom, c.geom)::geography) / ST_Area(p.geom::geography)) END,
    'sewer_ccn_source_last_modified', (SELECT source_last_modified FROM bdp_puct_sewer_ccn_snapshot WHERE singleton)
  ) INTO result FROM p CROSS JOIN cover c;
  RETURN result;
END $$;
