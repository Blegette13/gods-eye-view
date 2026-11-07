-- BDP Step 48 / read-only regulatory evidence security audit.
-- REQUIRES Step 41, Step 46 and Step 47 migrations already applied.
-- Run as the trusted local PostGIS administrator ONLY.
-- Never use the database owner account in a deployed web service.
-- This audit checks configuration; it does not authenticate users, prove
-- source/legal facts, review evidence, or certify production security.
-- It makes NO changes and prints NO source notes or personal identities.
BEGIN READ ONLY;

DO $bdp_audit$
DECLARE
  v_group_count INTEGER;
  v_bad_role_count INTEGER;
  v_policies_count INTEGER;
  v_bad_policy_count INTEGER;
  v_active_grants BIGINT;
  v_expired_grants BIGINT;
  v_append_owner TEXT;
  v_access_owner TEXT;
  v_append_definer BOOLEAN;
  v_access_definer BOOLEAN;
BEGIN
  SELECT count(*) INTO v_group_count
    FROM pg_catalog.pg_roles WHERE rolname IN (
      'bdp_evidence_reader', 'bdp_evidence_appender',
      'bdp_evidence_owner', 'bdp_evidence_acl_owner');
  IF v_group_count <> 4 THEN
    RAISE EXCEPTION 'BDP audit failed: all four dedicated group roles must exist';
  END IF;
  SELECT count(*) INTO v_bad_role_count
    FROM pg_catalog.pg_roles
    WHERE rolname IN (
      'bdp_evidence_reader', 'bdp_evidence_appender',
      'bdp_evidence_owner', 'bdp_evidence_acl_owner')
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole
           OR rolreplication OR rolbypassrls);
  IF v_bad_role_count <> 0 THEN
    RAISE EXCEPTION 'BDP audit failed: a protected role has excess privileges';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.bdp_regulatory_evidence_events'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'BDP audit failed: evidence table RLS is disabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.bdp_evidence_parcel_acl'::regclass
      AND relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'BDP audit failed: parcel grant registry is missing';
  END IF;

  -- Required policies must remain bound to the original checked ACL helper.
  -- Presence alone is not enough: also check SELECT vs INSERT expressions.
  SELECT count(*) INTO v_policies_count
  FROM pg_catalog.pg_policy
  WHERE polrelid = 'public.bdp_regulatory_evidence_events'::regclass
    AND polname IN (
      'bdp_evidence_reader_parcel_isolation',
      'bdp_evidence_owner_insert_parcel_isolation',
      'bdp_evidence_owner_returning_parcel_isolation');
  IF v_policies_count <> 3 OR (
      SELECT count(*) FROM pg_catalog.pg_policy
      WHERE polrelid = 'public.bdp_regulatory_evidence_events'::regclass
    ) <> 3 THEN
    RAISE EXCEPTION 'BDP audit failed: required RLS policy missing or unexpected permissive policy present';
  END IF;
  SELECT count(*) INTO v_bad_policy_count
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = 'public.bdp_regulatory_evidence_events'::regclass
    AND (
      (p.polname = 'bdp_evidence_reader_parcel_isolation'
        AND (p.polcmd <> 'r' OR NOT p.polpermissive
          OR p.polroles <> ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'bdp_evidence_reader')]
          OR COALESCE(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '')
          NOT LIKE '%bdp_evidence_has_parcel_access%'))
      OR (p.polname = 'bdp_evidence_owner_insert_parcel_isolation'
        AND (p.polcmd <> 'a' OR NOT p.polpermissive
          OR p.polroles <> ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'bdp_evidence_owner')]
          OR COALESCE(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')
          NOT LIKE '%bdp_evidence_has_parcel_access%'))
      OR (p.polname = 'bdp_evidence_owner_returning_parcel_isolation'
        AND (p.polcmd <> 'r' OR NOT p.polpermissive
          OR p.polroles <> ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'bdp_evidence_owner')]
          OR COALESCE(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '')
          NOT LIKE '%bdp_evidence_has_parcel_access%'))
    );
  IF v_bad_policy_count <> 0 THEN
    RAISE EXCEPTION 'BDP audit failed: incorrect RLS policy command or missing ACL guard';
  END IF;

  SELECT r.rolname, p.prosecdef INTO v_append_owner, v_append_definer
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
  WHERE p.oid = 'public.bdp_evidence_append_unverified(jsonb)'::regprocedure;
  SELECT r.rolname, p.prosecdef INTO v_access_owner, v_access_definer
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
  WHERE p.oid = 'public.bdp_evidence_has_parcel_access(text,text,text)'::regprocedure;
  IF v_append_owner IS DISTINCT FROM 'bdp_evidence_owner'
    OR v_access_owner IS DISTINCT FROM 'bdp_evidence_acl_owner'
    OR v_append_definer IS DISTINCT FROM TRUE
    OR v_access_definer IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'BDP audit failed: unsafe evidence or ACL function ownership';
  END IF;

  IF NOT pg_catalog.has_column_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'parcel_id', 'SELECT')
    OR pg_catalog.has_column_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'notes', 'SELECT')
    OR pg_catalog.has_column_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'source_url', 'SELECT')
    OR pg_catalog.has_column_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'entered_by', 'SELECT')
    OR pg_catalog.has_table_privilege('bdp_evidence_reader',
      'public.bdp_evidence_parcel_acl', 'SELECT')
    OR pg_catalog.has_table_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'INSERT')
    OR pg_catalog.has_table_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'UPDATE')
    OR pg_catalog.has_table_privilege('bdp_evidence_reader',
      'public.bdp_regulatory_evidence_events', 'DELETE') THEN
    RAISE EXCEPTION 'BDP audit failed: reader has unexpected table privileges';
  END IF;

  IF pg_catalog.has_any_column_privilege('bdp_evidence_appender',
      'public.bdp_regulatory_evidence_events', 'SELECT')
    OR pg_catalog.has_table_privilege('bdp_evidence_appender',
      'public.bdp_regulatory_evidence_events', 'INSERT')
    OR pg_catalog.has_table_privilege('bdp_evidence_appender',
      'public.bdp_regulatory_evidence_events', 'UPDATE')
    OR pg_catalog.has_table_privilege('bdp_evidence_appender',
      'public.bdp_regulatory_evidence_events', 'DELETE')
    OR pg_catalog.has_table_privilege('bdp_evidence_appender',
      'public.bdp_evidence_parcel_acl', 'SELECT')
    OR NOT pg_catalog.has_function_privilege('bdp_evidence_appender',
      'public.bdp_evidence_append_unverified(jsonb)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('bdp_evidence_reader',
      'public.bdp_evidence_append_unverified(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'BDP audit failed: appender has excess privileges or unsafe RPC grants';
  END IF;

  IF pg_catalog.has_column_privilege('bdp_evidence_owner',
      'public.bdp_regulatory_evidence_events', 'notes', 'SELECT')
    OR pg_catalog.has_table_privilege('bdp_evidence_owner',
      'public.bdp_regulatory_evidence_events', 'UPDATE')
    OR pg_catalog.has_table_privilege('bdp_evidence_owner',
      'public.bdp_regulatory_evidence_events', 'DELETE')
    OR pg_catalog.has_table_privilege('bdp_evidence_acl_owner',
      'public.bdp_regulatory_evidence_events', 'SELECT')
    OR pg_catalog.has_table_privilege('bdp_evidence_acl_owner',
      'public.bdp_evidence_parcel_acl', 'UPDATE')
    OR pg_catalog.has_table_privilege('bdp_evidence_acl_owner',
      'public.bdp_evidence_parcel_acl', 'DELETE') THEN
    RAISE EXCEPTION 'BDP audit failed: restricted function owners have excess rights';
  END IF;

  SELECT count(*) FILTER (WHERE expires_at > CURRENT_TIMESTAMP),
         count(*) FILTER (WHERE expires_at <= CURRENT_TIMESTAMP)
    INTO v_active_grants, v_expired_grants
  FROM public.bdp_evidence_parcel_acl;

  RAISE NOTICE 'BDP Step 48 audit PASS: four NOLOGIN roles, RLS, policies, restricted RPC and metadata grants';
  RAISE NOTICE 'BDP Step 48 parcel grants: active %, expired % (aggregate counts only)',
    v_active_grants, v_expired_grants;
  RAISE NOTICE 'BDP Step 48 scope: read-only configuration audit; NOT real user authentication or legal clearance';
END;
$bdp_audit$;

ROLLBACK;
