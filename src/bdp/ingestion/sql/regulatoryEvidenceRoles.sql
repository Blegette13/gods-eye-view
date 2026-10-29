-- Step 46: separate NOLOGIN privileges for BDP regulatory evidence.
-- Requires Step 41 regulatoryEvidenceLedger.sql.
-- Run using the trusted local owner/admin connection with psql -v ON_ERROR_STOP=1.
-- Does NOT create credentials, logins, user sessions, or grant membership.
-- Existing local bdp/PostGIS connections and Cesium UI are unchanged.
--
-- Reader: SELECT only safe indexed metadata columns (never notes, URLs,
-- reviewer names or geometry). This is NOT a row-level parcel restriction.
-- Appender: EXECUTE ONLY on fixed SECURITY DEFINER unverified-append RPC.
-- No raw INSERT/UPDATE/DELETE or SELECT on the base table.
--
-- Do not connect a public web endpoint with owner/superuser credentials.
-- Deploying this migration is a prerequisite, NOT sufficient, for production.

BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bdp_evidence_reader') THEN
    CREATE ROLE bdp_evidence_reader NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bdp_evidence_appender') THEN
    CREATE ROLE bdp_evidence_appender NOLOGIN;
  END IF;
END;
$roles$;

-- Existing roles with the same names should remain NOLOGIN if re-applied.
ALTER ROLE bdp_evidence_reader NOLOGIN;
ALTER ROLE bdp_evidence_appender NOLOGIN;

REVOKE ALL PRIVILEGES ON TABLE public.bdp_regulatory_evidence_events FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.bdp_regulatory_evidence_events
  FROM bdp_evidence_reader, bdp_evidence_appender;
GRANT USAGE ON SCHEMA public TO bdp_evidence_reader, bdp_evidence_appender;
GRANT SELECT (
  id, county_fips, parcel_id, task_id, event_type, source_title,
  source_date, source_sha256, verification_state, recorded_at
) ON public.bdp_regulatory_evidence_events TO bdp_evidence_reader;

-- This RPC accepts a fixed document/research record JSON envelope, never
-- SQL supplied by a caller. The table constrains unverified status and the
-- ordinary UPDATE/DELETE trigger blocks mutating historical entries.
-- The server-side identity gate MUST authorize parcel scope before calling.
CREATE OR REPLACE FUNCTION public.bdp_evidence_append_unverified(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $append$
DECLARE
  v_row public.bdp_regulatory_evidence_events%ROWTYPE;
  v_key TEXT;
  v_source_date TEXT;
BEGIN
  IF p_event IS NULL OR pg_catalog.jsonb_typeof(p_event) <> 'object' THEN
    RAISE EXCEPTION 'BDP evidence payload must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  -- Reject verification, actor privilege, source-geometry and every
  -- other unsupported field, even if its value is null.
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_event) LOOP
    IF v_key <> ALL(ARRAY[
      'countyFips','parcelId','taskId','eventType',
      'sourceUrl','sourceTitle','sourceDate','sourceSha256',
      'notes','enteredBy'
    ]) THEN
      RAISE EXCEPTION 'Unsupported BDP evidence payload field'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_source_date := p_event->>'sourceDate';
  IF v_source_date IS NOT NULL AND
    (v_source_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
    RAISE EXCEPTION 'Source date must be ISO YYYY-MM-DD or null'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bdp_regulatory_evidence_events
    (county_fips, parcel_id, task_id, event_type,
     source_url, source_title, source_date, source_sha256,
     notes, entered_by)
  VALUES
    (p_event->>'countyFips', p_event->>'parcelId',
     p_event->>'taskId', p_event->>'eventType',
     p_event->>'sourceUrl', p_event->>'sourceTitle',
     v_source_date::date, p_event->>'sourceSha256',
     p_event->>'notes', p_event->>'enteredBy')
  RETURNING * INTO v_row;

  RETURN pg_catalog.jsonb_build_object(
    'eventId', v_row.id,
    'countyFips', BTRIM(v_row.county_fips),
    'parcelId', v_row.parcel_id,
    'taskId', v_row.task_id,
    'eventType', v_row.event_type,
    'verificationState', v_row.verification_state,
    'recordedAt', v_row.recorded_at,
    'legalClearance', NULL,
    'acquisitionRecommendation', NULL
  );
END;
$append$;

-- PostgreSQL functions default to public EXECUTE unless explicitly revoked.
-- REVOKE and GRANT live in the same transaction as CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.bdp_evidence_append_unverified(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bdp_evidence_append_unverified(jsonb)
  FROM bdp_evidence_reader, bdp_evidence_appender;
GRANT EXECUTE ON FUNCTION public.bdp_evidence_append_unverified(jsonb)
  TO bdp_evidence_appender;

COMMENT ON FUNCTION public.bdp_evidence_append_unverified(jsonb) IS
  'Restricted append-only UNVERIFIED evidence research journal. Requires external, trusted parcel authorization; never legal clearance.';

COMMIT;
