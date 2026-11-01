-- Step 40C-9: RESTRICTED, UNROUTED PARCEL METADATA RPC FOUNDATION.
-- MANUAL DBA REVIEW ONLY. Apply AFTER parcelIndexFoundation.sql and PostGIS,
-- to a disposable database first. Does not import GIS, create a LOGIN,
-- open an API, grant browser rights, or approve a county data license.
--
-- SECURITY NOTE: the NOLOGIN role has USAGE + EXECUTE on two tightly
-- parameterized SECURITY DEFINER functions; it has NO raw table grants.
-- Server authentication, per-user county entitlements and revocation must
-- be established OUTSIDE these functions before using them with any client.
-- Do NOT add a login/member or attach these functions to the public API here.
--
-- These functions expect PostGIS installed in schema public (as in the
-- disposable PostGIS image). Check that schema is DBA controlled; the
-- extension calls and spatial index operator are fully schema qualified.

BEGIN;

DO $ldos_role$
DECLARE
  role_row pg_catalog.pg_roles%ROWTYPE;
  extension_schema text;
BEGIN
  SELECT n.nspname INTO extension_schema
  FROM pg_catalog.pg_extension AS e
  JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
  WHERE e.extname = 'postgis';

  IF extension_schema IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION 'PostGIS must be installed in reviewed schema public for this staged RPC';
  END IF;

  SELECT * INTO role_row FROM pg_catalog.pg_roles
    WHERE rolname = 'ldos_parcel_rpc_client';
  IF NOT FOUND THEN
    CREATE ROLE ldos_parcel_rpc_client NOLOGIN NOINHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  ELSIF role_row.rolcanlogin OR role_row.rolinherit OR role_row.rolsuper
      OR role_row.rolcreatedb OR role_row.rolcreaterole OR role_row.rolreplication THEN
    RAISE EXCEPTION 'Existing parcel RPC role has unsafe attributes: DBA review required';
  END IF;
END;
$ldos_role$;

-- Any previously granted raw rights (if present) must be revoked. A DBA
-- must separately inspect memberships, PUBLIC grants and existing RLS.
REVOKE ALL ON ALL TABLES IN SCHEMA bdp_parcel_index FROM ldos_parcel_rpc_client;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA bdp_parcel_index FROM ldos_parcel_rpc_client;
REVOKE ALL ON SCHEMA bdp_parcel_index FROM ldos_parcel_rpc_client;
GRANT USAGE ON SCHEMA bdp_parcel_index TO ldos_parcel_rpc_client;

-- "approved" represents explicit reviewed SOURCE RIGHTS, not an auth
-- claim by the user; no username, roles, emails or parcel polygons exposed.
CREATE OR REPLACE FUNCTION bdp_parcel_index.approved_sources_rpc(
  p_county_fips text
)
RETURNS TABLE (
  source_id text,
  county_fips text,
  rights_state text,
  approved_caching_until_ms double precision,
  run_id bigint
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $parcel_sources_rpc$
  SELECT
    sr.source_id,
    sr.county_fips::text,
    sr.rights_state,
    FLOOR(EXTRACT(EPOCH FROM sr.approved_caching_until) * 1000)::double precision,
    latest.id
  FROM bdp_parcel_index.source_registry AS sr
  JOIN LATERAL (
    SELECT ir.id
    FROM bdp_parcel_index.ingest_runs AS ir
    WHERE ir.source_id = sr.source_id
      AND ir.finished_at IS NOT NULL
      AND ir.outcome IN ('complete', 'partial')
    ORDER BY ir.finished_at DESC, ir.id DESC
    LIMIT 1
  ) AS latest ON true
  WHERE p_county_fips ~ '^48[0-9]{3}$'
    AND sr.county_fips = p_county_fips::char(5)
    AND sr.rights_state = 'approved'
    AND sr.approved_caching_until > pg_catalog.clock_timestamp()
  ORDER BY sr.source_id COLLATE "C" ASC
  LIMIT 2;
$parcel_sources_rpc$;

-- Data-only, capped metadata probe. No geometry serialization; a one-row
-- overflow probe uses p_probe_limit 2..201. Source/run IDs are trusted
-- SERVER-SIDE decisions, never browser parameters. A bounded query cannot
-- prove full source-window coverage or ownership/title/buildability.
CREATE OR REPLACE FUNCTION bdp_parcel_index.parcel_viewport_probe_rpc(
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
  source_currency text,
  source_modified_at timestamptz,
  geometry_vertices integer,
  geometry_memory_bytes integer,
  ingest_run_id bigint
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $parcel_view_rpc$
  SELECT
    pv.id,
    pv.source_parcel_id,
    pv.source_version,
    pv.source_geometry_sha256,
    pv.source_currency,
    pv.source_modified_at,
    public.ST_NPoints(pv.geometry),
    public.ST_MemSize(pv.geometry),
    ir.id
  FROM bdp_parcel_index.source_registry AS sr
  JOIN bdp_parcel_index.ingest_runs AS ir
    ON ir.source_id = sr.source_id
  JOIN bdp_parcel_index.parcel_versions AS pv
    ON pv.ingest_run_id = ir.id
    AND pv.source_id = sr.source_id
    AND pv.county_fips = sr.county_fips
    AND pv.source_version = ir.source_version
  WHERE p_county_fips ~ '^48[0-9]{3}$'
    AND p_source_id ~ '^[a-z][a-z0-9_-]{2,79}$'
    AND p_run_id > 0
    -- Min/max and strict ordering also fail closed for NaN and infinities.
    AND p_west >= -180 AND p_east <= 180
    AND p_south >= -90 AND p_north <= 90
    AND p_west < p_east AND p_south < p_north
    AND p_east - p_west <= 0.12
    AND p_north - p_south <= 0.12
    AND p_probe_limit BETWEEN 2 AND 201
    AND sr.county_fips = p_county_fips::char(5)
    AND sr.source_id = p_source_id
    AND ir.id = p_run_id
    AND ir.finished_at IS NOT NULL
    AND ir.outcome IN ('complete', 'partial')
    AND sr.rights_state = 'approved'
    AND sr.approved_caching_until > pg_catalog.clock_timestamp()
    AND pv.geometry OPERATOR(public.&&)
      public.ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326)
    AND public.ST_Intersects(
      pv.geometry, public.ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326)
    )
  ORDER BY pv.source_parcel_id COLLATE "C" ASC, pv.id ASC
  LIMIT LEAST(GREATEST(p_probe_limit, 0), 201);
$parcel_view_rpc$;

-- Functions default to PUBLIC EXECUTE on many PostgreSQL installations.
-- REVOKE in the same transaction, then grant ONLY to the NOLOGIN role.
REVOKE ALL ON FUNCTION bdp_parcel_index.approved_sources_rpc(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bdp_parcel_index.parcel_viewport_probe_rpc(
  text,text,bigint,double precision,double precision,double precision,
  double precision,integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION bdp_parcel_index.approved_sources_rpc(text)
  TO ldos_parcel_rpc_client;
GRANT EXECUTE ON FUNCTION bdp_parcel_index.parcel_viewport_probe_rpc(
  text,text,bigint,double precision,double precision,double precision,
  double precision,integer
) TO ldos_parcel_rpc_client;

COMMENT ON FUNCTION bdp_parcel_index.approved_sources_rpc(text) IS
  'Server-only, rights-expiring and county-bounded approved source/run lookup. No authentication or license grant.';
COMMENT ON FUNCTION bdp_parcel_index.parcel_viewport_probe_rpc(
  text,text,bigint,double precision,double precision,double precision,
  double precision,integer
) IS 'Server-only metadata probe, max 201 source rows. NOT a map API, title report or coverage certification.';

COMMIT;
