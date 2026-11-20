-- Step 40C-30: DBA-REVIEW-ONLY; staged, unrouted SEALED initial parcel page.
-- Applies only inside an explicitly opted-in disposable synthetic PostGIS test.
-- NEVER apply automatically to an existing or production database.
-- The 40C-26 parcelRunSealFoundation.sql and independent redistribution rights
-- review foundation MUST exist first. No production role or data is approved.
--
-- Kept in strict parity with the 40C-29 sealed keyset query, with ONLY the
-- after-position filter removed, so initial and continuation pages share
-- source, county, sealed run, independent cache/publication rights, bounds,
-- C collation, feature-size budgets, and null-geometry overflow sentinel.
-- SQL SECURITY DEFINER is NOT session authentication, an independent legal
-- right to publish GIS, an MVCC snapshot, or evidence of complete viewport.
BEGIN;

CREATE FUNCTION bdp_parcel_index.parcel_geometry_sealed_initial_rpc(
  p_county_fips text,
  p_source_id text,
  p_run_id bigint,
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_probe_limit integer
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
AS $ldos_sealed_initial_rpc$
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
  JOIN bdp_parcel_index.parcel_run_seals AS seal
    ON seal.ingest_run_id = ir.id
    AND seal.source_id = ir.source_id
    AND seal.county_fips = sr.county_fips
    AND seal.source_version = ir.source_version
    AND seal.indexed_records = ir.received_records
    AND seal.sealed_at >= ir.finished_at
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
    AND seal.sealed_at IS NOT NULL
    AND ir.outcome = 'complete'
    AND ir.received_records IS NOT NULL
    AND ir.omitted_unidentified = 0
    AND ir.source_reported_truncated = FALSE
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
$ldos_sealed_initial_rpc$;

-- Both revocations are atomic with CREATE, protecting against PostgreSQL's
-- default PUBLIC EXECUTE on newly created functions.
REVOKE ALL ON FUNCTION bdp_parcel_index.parcel_geometry_sealed_initial_rpc(
  text,text,bigint,double precision,double precision,double precision,
  double precision,integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION bdp_parcel_index.parcel_geometry_sealed_initial_rpc(
  text,text,bigint,double precision,double precision,double precision,
  double precision,integer
) FROM ldos_parcel_rpc_client;
-- No GRANTs whatsoever; a distinct NOLOGIN role may receive rights only
-- inside the separate disposable verification container.
COMMENT ON FUNCTION bdp_parcel_index.parcel_geometry_sealed_initial_rpc(
  text,text,bigint,double precision,double precision,double precision,
  double precision,integer
) IS
  'STAGED ONLY: sealed run, rights-gated bounded first parcel page; no public delivery or confirmed viewport coverage.';

COMMIT;
