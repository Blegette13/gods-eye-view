-- Step 40C-40 — DBA-REVIEW-ONLY durable transactional policy epochs.
-- NOT AN AUTOMATIC MIGRATION; NEVER apply to an existing BDP database
-- without DBA audit, backup/rollback plan and license/identity review.
-- First run ONLY inside the fresh, synthetic, network-disabled PostGIS
-- disposable test. No role/GRANT/public geometry service is created.
--
-- A SHA-256 of current rights alone cannot detect revoke/reapprove ABA.
-- This proof-of-concept makes every committed INSERT/UPDATE/DELETE against
-- either rights table advance a row-lock-serialized, durable BIGINT epoch.
-- It does NOT yet protect session/county grants, run sealing or delivery.
BEGIN;

CREATE TABLE bdp_parcel_index.parcel_policy_epochs (
  policy_scope text NOT NULL CHECK (
    policy_scope IN ('source_cache','geometry_publication')
  ),
  source_id text NOT NULL CHECK (
    source_id ~ '^[a-z][a-z0-9_-]{2,79}$'
  ),
  epoch bigint NOT NULL CHECK (epoch > 0),
  modified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (policy_scope,source_id)
);

REVOKE ALL ON TABLE bdp_parcel_index.parcel_policy_epochs FROM PUBLIC;
REVOKE ALL ON TABLE bdp_parcel_index.parcel_policy_epochs
  FROM ldos_parcel_rpc_client;

-- Backfill existing records in the same transaction BEFORE installing
-- triggers. Initial epoch=1 means only "initially known", NOT historical
-- proof: historical rights changes cannot be reconstructed.
INSERT INTO bdp_parcel_index.parcel_policy_epochs
  (policy_scope,source_id,epoch)
SELECT 'source_cache',source_id,1
FROM bdp_parcel_index.source_registry;

INSERT INTO bdp_parcel_index.parcel_policy_epochs
  (policy_scope,source_id,epoch)
SELECT 'geometry_publication',source_id,1
FROM bdp_parcel_index.geometry_publication_reviews;

-- Database-owned, fully qualified write; no caller-supplied scope/epoch.
-- Each UPSERT takes a transactional row lock and increments from the
-- COMMITTED previous value. Unlike nextval(), rollback cannot consume a
-- version and out-of-order commits cannot assign decreasing epochs to the
-- same policy key. Any overflow fails the rights write closed.
CREATE FUNCTION bdp_parcel_index.bump_parcel_policy_epoch()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $ldos_policy_epoch_trigger$
DECLARE
  v_scope text;
  v_source text;
BEGIN
  IF TG_TABLE_SCHEMA IS DISTINCT FROM 'bdp_parcel_index' THEN
    RAISE EXCEPTION 'Unrecognized policy trigger schema'
      USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME = 'source_registry' THEN
    v_scope := 'source_cache';
  ELSIF TG_TABLE_NAME = 'geometry_publication_reviews' THEN
    v_scope := 'geometry_publication';
  ELSE
    RAISE EXCEPTION 'Unrecognized policy trigger table'
      USING ERRCODE='42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_source := OLD.source_id;
  ELSIF TG_OP IN ('INSERT','UPDATE') THEN
    v_source := NEW.source_id;
  ELSE
    RAISE EXCEPTION 'Unrecognized policy trigger operation'
      USING ERRCODE='42501';
  END IF;

  IF v_source IS NULL OR v_source !~ '^[a-z][a-z0-9_-]{2,79}$' THEN
    RAISE EXCEPTION 'Malformed source policy key'
      USING ERRCODE='23514';
  END IF;

  INSERT INTO bdp_parcel_index.parcel_policy_epochs AS existing
    (policy_scope,source_id,epoch,modified_at)
  VALUES (v_scope,v_source,1,clock_timestamp())
  ON CONFLICT (policy_scope,source_id)
  DO UPDATE SET
    epoch = existing.epoch + 1,
    modified_at = clock_timestamp();

  -- On an attempted primary-key move, invalidate the previous source
  -- as well; never silently reuse a stale revision for the old identity.
  IF TG_OP = 'UPDATE' AND OLD.source_id IS DISTINCT FROM NEW.source_id THEN
    INSERT INTO bdp_parcel_index.parcel_policy_epochs AS existing
      (policy_scope,source_id,epoch,modified_at)
    VALUES (v_scope,OLD.source_id,1,clock_timestamp())
    ON CONFLICT (policy_scope,source_id)
    DO UPDATE SET
      epoch = existing.epoch + 1,
      modified_at = clock_timestamp();
  END IF;
  RETURN NULL;
END;
$ldos_policy_epoch_trigger$;

REVOKE ALL ON FUNCTION bdp_parcel_index.bump_parcel_policy_epoch()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION bdp_parcel_index.bump_parcel_policy_epoch()
  FROM ldos_parcel_rpc_client;

CREATE TRIGGER source_cache_epoch_increment
  AFTER INSERT OR UPDATE OR DELETE
  ON bdp_parcel_index.source_registry
  FOR EACH ROW EXECUTE FUNCTION
    bdp_parcel_index.bump_parcel_policy_epoch();

CREATE TRIGGER geometry_publication_epoch_increment
  AFTER INSERT OR UPDATE OR DELETE
  ON bdp_parcel_index.geometry_publication_reviews
  FOR EACH ROW EXECUTE FUNCTION
    bdp_parcel_index.bump_parcel_policy_epoch();

COMMENT ON TABLE bdp_parcel_index.parcel_policy_epochs IS
  'DRAFT synthetic-only monotonic rights-change counters. A current approved row is still required; epoch alone never authorizes geometry or user access. Not a production rights oracle.';

COMMIT;
