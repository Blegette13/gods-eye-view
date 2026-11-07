-- Step 40C-43 — DBA REVIEW ONLY. Separate synthetic account/session
-- county-grant epoch store, not the actual authentication or MFA service.
-- NEVER auto-run this on an existing database or interpret these rows as
-- production login, county entitlement, GIS license or polygon delivery.
-- The real session authority must transactionally maintain these counters.
BEGIN;
CREATE SCHEMA ldos_private_auth;
REVOKE ALL ON SCHEMA ldos_private_auth FROM PUBLIC;

-- SYNTHETIC stand-in for a strongly current account/county-grant store.
-- All flags default FALSE. Even all TRUE flags are NOT authoritative until
-- real session issuance, logout, MFA and account lifecycle are integrated.
CREATE TABLE ldos_private_auth.session_county_decisions (
  session_digest text NOT NULL CHECK (session_digest ~ '^[0-9a-f]{64}$'),
  county_fips char(5) NOT NULL CHECK (county_fips ~ '^48[0-9]{3}$'),
  account_active boolean NOT NULL DEFAULT FALSE,
  mfa_verified boolean NOT NULL DEFAULT FALSE,
  session_active boolean NOT NULL DEFAULT FALSE,
  allow_discovery boolean NOT NULL DEFAULT FALSE,
  PRIMARY KEY (session_digest,county_fips)
);
CREATE TABLE ldos_private_auth.session_county_epochs (
  session_digest text NOT NULL CHECK (session_digest ~ '^[0-9a-f]{64}$'),
  county_fips char(5) NOT NULL CHECK (county_fips ~ '^48[0-9]{3}$'),
  epoch bigint NOT NULL CHECK (epoch > 0),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (session_digest,county_fips)
);
REVOKE ALL ON ALL TABLES IN SCHEMA ldos_private_auth FROM PUBLIC;

-- The old key is IMMUTABLE. Delete + reinsert increments one durable
-- epoch row and therefore cannot reuse the original approval version.
CREATE FUNCTION ldos_private_auth.track_session_county_epoch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $ldos_account_epoch$
DECLARE
  k_digest text;
  k_county char(5);
BEGIN
  IF TG_TABLE_SCHEMA <> 'ldos_private_auth'
     OR TG_TABLE_NAME <> 'session_county_decisions' THEN
    RAISE EXCEPTION 'Unexpected session epoch trigger target'
      USING ERRCODE='42501';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Session grant TRUNCATE prohibited'
      USING ERRCODE='42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.session_digest IS DISTINCT FROM NEW.session_digest
      OR OLD.county_fips IS DISTINCT FROM NEW.county_fips THEN
      RAISE EXCEPTION 'Session grant identity cannot change'
        USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_WHEN = 'BEFORE' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    k_digest := OLD.session_digest;
    k_county := OLD.county_fips;
  ELSE
    k_digest := NEW.session_digest;
    k_county := NEW.county_fips;
  END IF;
  IF k_digest !~ '^[0-9a-f]{64}$' OR k_county !~ '^48[0-9]{3}$' THEN
    RAISE EXCEPTION 'Invalid session county revision key'
      USING ERRCODE='23514';
  END IF;
  INSERT INTO ldos_private_auth.session_county_epochs AS current_epoch
    (session_digest,county_fips,epoch,changed_at)
  VALUES (k_digest,k_county,1,clock_timestamp())
  ON CONFLICT (session_digest,county_fips)
  DO UPDATE SET epoch=current_epoch.epoch+1,
                changed_at=clock_timestamp();
  RETURN NULL;
END;
$ldos_account_epoch$;
REVOKE ALL ON FUNCTION ldos_private_auth.track_session_county_epoch()
  FROM PUBLIC;
CREATE TRIGGER county_grant_prevent_identity_change
  BEFORE UPDATE ON ldos_private_auth.session_county_decisions
  FOR EACH ROW EXECUTE FUNCTION ldos_private_auth.track_session_county_epoch();
CREATE TRIGGER county_grant_track_insert_update_delete
  AFTER INSERT OR UPDATE OR DELETE ON ldos_private_auth.session_county_decisions
  FOR EACH ROW EXECUTE FUNCTION ldos_private_auth.track_session_county_epoch();
CREATE TRIGGER county_grant_deny_truncate
  BEFORE TRUNCATE ON ldos_private_auth.session_county_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION ldos_private_auth.track_session_county_epoch();

COMMENT ON TABLE ldos_private_auth.session_county_epochs IS
  'SYNTHETIC unmounted account/session county revision history. Never directly authorize a user or GIS geometry.';
COMMIT;
