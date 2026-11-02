-- Step 40C-24: DBA-REVIEW-ONLY draft of source-bound private keyset RPC.
-- This migration is NOT applied by the application, build, or dev scripts.
-- The existing metadata-only LOGIN must NEVER receive EXECUTE or raw SELECT.
-- No source is automatically approved for GIS geometry redistribution.
--
-- The inner query mirrors Step 40C-18's exact source/run, county, bounds,
-- independent geometry-publication and source-caching rights checks; it
-- additionally constrains the keyset AFTER (source_parcel_id, parcel_version_id).
-- Ordering is source_parcel_id COLLATE "C", then BIGINT parcel version ID.
--
-- Tokens are verified by a future trusted server BEFORE this RPC is called.
-- A cursor is not authorization or an immutable MVCC snapshot. Production
-- deployment requires an independently audited function owner and geometry
-- reader role, frozen per-run parcel data, post-query revocation, and rights.
BEGIN;

CREATE FUNCTION bdp_parcel_index.parcel_geometry_keyset_rpc(
  p_county_fips text,
  p_source_id text,
  p_run_id bigint,
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_probe_limit integer,
  p_after_source_parcel_id text,
  p_after_parcel_version_id bigint
)
RETURNS TABLE (
  parcel_version_id bigint,
  source_parcel_id text,
  source_version text,
  source_geometry_sha256 text,
  ingest_run_id bigint,
  source_id text,
  county_fips text,
  geometry_vertices integer,
  geometry_memory_bytes integer,
  geometry json
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $ldos_geometry_keyset_rpc$
WITH bounded AS MATERIALIZED (
  SELECT
    pv.id AS parcel_version_id,
    pv.source_parcel_id,
    pv.source_version,
    pv.source_geometry_sha256,
    ir.id AS ingest_run_id,
    pv.source_id,
    pv.county_fips::text AS county_fips,
    public.ST_NPoints(pv.geometry) AS geometry_vertices,
    public.ST_MemSize(pv.geometry) AS geometry_memory_bytes,
    pv.geometry AS raw_geometry
  FROM bdp_parcel_index.source_registry AS sr
  JOIN bdp_parcel_index.geometry_publication_reviews AS rights
    ON rights.source_id = sr.source_id
    AND rights.county_fips = sr.county_fips
  JOIN bdp_parcel_index.ingest_runs AS ir
    ON ir.source_id = sr.source_id
  JOIN bdp_parcel_index.parcel_versions AS pv
    ON pv.ingest_run_id = ir.id
    AND pv.source_id = sr.source_id
    AND pv.county_fips = sr.county_fips
    AND pv.source_version = ir.source_version
  WHERE $1::text ~ '^48[0-9]{3}$'
    AND sr.county_fips = $1::char(5)
    AND sr.source_id = $2::text
    AND ir.id = $3::bigint
    AND ir.finished_at IS NOT NULL
    AND ir.outcome IN ('complete', 'partial')
    AND sr.rights_state = 'approved'
    AND sr.approved_caching_until > pg_catalog.clock_timestamp()
    AND rights.review_state = 'approved'
    AND rights.allow_geometry_redistribution = TRUE
    AND rights.review_reference IS NOT NULL
    AND rights.reviewed_at IS NOT NULL
    AND rights.reviewed_at <= pg_catalog.clock_timestamp()
    AND rights.expires_at > pg_catalog.clock_timestamp()
    AND rights.expires_at <= sr.approved_caching_until
    AND $4::double precision >= -180
    AND $6::double precision <= 180
    AND $5::double precision >= -90
    AND $7::double precision <= 90
    AND $4::double precision < $6::double precision
    AND $5::double precision < $7::double precision
    AND ($6::double precision - $4::double precision) <= 0.12
    AND ($7::double precision - $5::double precision) <= 0.12
    AND $8::integer BETWEEN 2 AND 201
    AND $9::text ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}
    AND pv.geometry OPERATOR(public.&&)
      public.ST_MakeEnvelope($4::double precision, $5::double precision,
        $6::double precision, $7::double precision, 4326)
    AND public.ST_Intersects(pv.geometry,
      public.ST_MakeEnvelope($4::double precision, $5::double precision,
        $6::double precision, $7::double precision, 4326))
  ORDER BY pv.source_parcel_id COLLATE "C" ASC, pv.id ASC
  LIMIT $8::integer
)
SELECT
  parcel_version_id, source_parcel_id, source_version,
  source_geometry_sha256, ingest_run_id, source_id, county_fips,
  geometry_vertices, geometry_memory_bytes,
  CASE WHEN row_number() OVER (
    ORDER BY source_parcel_id COLLATE "C" ASC, parcel_version_id ASC
  ) < $8::integer
    AND geometry_vertices BETWEEN 1 AND 8000
    AND geometry_memory_bytes BETWEEN 1 AND 524288
    THEN public.ST_AsGeoJSON(raw_geometry, 9, 0)::json
    ELSE NULL
  END AS geometry
FROM bounded
ORDER BY source_parcel_id COLLATE "C" ASC, parcel_version_id ASC
    AND $10::bigint > 0
    AND (
      pv.source_parcel_id COLLATE "C" > ($9::text COLLATE "C")
      OR (
        pv.source_parcel_id COLLATE "C" = ($9::text COLLATE "C")
        AND pv.id > $10::bigint
      )
    )
    AND pv.geometry OPERATOR(public.&&)
      public.ST_MakeEnvelope($4::double precision, $5::double precision,
        $6::double precision, $7::double precision, 4326)
    AND public.ST_Intersects(pv.geometry,
      public.ST_MakeEnvelope($4::double precision, $5::double precision,
        $6::double precision, $7::double precision, 4326))
  ORDER BY pv.source_parcel_id COLLATE "C" ASC, pv.id ASC
  LIMIT $8::integer
)
SELECT
  parcel_version_id, source_parcel_id, source_version,
  source_geometry_sha256, ingest_run_id, source_id, county_fips,
  geometry_vertices, geometry_memory_bytes,
  CASE WHEN row_number() OVER (
    ORDER BY source_parcel_id COLLATE "C" ASC, parcel_version_id ASC
  ) < $8::integer
    AND geometry_vertices BETWEEN 1 AND 8000
    AND geometry_memory_bytes BETWEEN 1 AND 524288
    THEN public.ST_AsGeoJSON(raw_geometry, 9, 0)::json
    ELSE NULL
  END AS geometry
FROM bounded
ORDER BY source_parcel_id COLLATE "C" ASC, parcel_version_id ASC
$ldos_geometry_keyset_rpc$;

-- PostgreSQL may grant EXECUTE to PUBLIC by default at CREATE time.
-- Both REVOKEs occur in the same DDL transaction, before the COMMIT.
REVOKE ALL ON FUNCTION bdp_parcel_index.parcel_geometry_keyset_rpc(
  text,text,bigint,double precision,double precision,double precision,
  double precision,integer,text,bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION bdp_parcel_index.parcel_geometry_keyset_rpc(
  text,text,bigint,double precision,double precision,double precision,
  double precision,integer,text,bigint
) FROM ldos_parcel_rpc_client;

-- Deliberately ZERO GRANTs to any production application or metadata role.
-- A disposable synthetic NOLOGIN probe role may be granted EXECUTE only
-- by the separate opt-in test harness (never by this foundation).
COMMENT ON FUNCTION bdp_parcel_index.parcel_geometry_keyset_rpc(
  text,text,bigint,double precision,double precision,double precision,
  double precision,integer,text,bigint
) IS
  'STAGED only: bounded, rights-gated keyset geometry; no public grant, authorization or verified viewport completeness.';

COMMIT;
