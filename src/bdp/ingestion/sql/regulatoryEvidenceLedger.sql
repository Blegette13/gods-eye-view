-- BDP preliminary regulatory evidence journal — initial schema (Step 41).
-- Append-only supporting document index; NEVER a legal zoning clearance.
-- Apply once with psql "service=bdp" -v ON_ERROR_STOP=1 -f
--   src/bdp/ingestion/sql/regulatoryEvidenceLedger.sql
--
-- This CREATE-only migration does not alter existing GIS/parcel/screening data.
-- PostgreSQL owners/superusers can still alter tables/triggers: a future
-- dedicated least-privilege app role and external archival/audit system are
-- required before describing this as tamper-proof.

BEGIN;

CREATE TABLE IF NOT EXISTS bdp_regulatory_evidence_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  county_fips CHAR(5) NOT NULL,
  parcel_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_url TEXT,
  source_title TEXT,
  source_date DATE,
  source_sha256 TEXT,
  notes TEXT NOT NULL,
  entered_by TEXT NOT NULL,
  verification_state TEXT NOT NULL DEFAULT 'unverified',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT bdp_reg_evidence_county_check
    CHECK (county_fips ~ '^48[0-9]{3}$'),
  CONSTRAINT bdp_reg_evidence_parcel_id_check
    CHECK (parcel_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'),
  CONSTRAINT bdp_reg_evidence_task_id_check
    CHECK (task_id ~ '^[a-z][a-z0-9-]{2,79}$'),
  CONSTRAINT bdp_reg_evidence_event_type_check
    CHECK (event_type IN ('document-indexed', 'review-note', 'correction-note')),
  CONSTRAINT bdp_reg_evidence_url_check
    CHECK (source_url IS NULL OR (
      LENGTH(source_url) <= 2048 AND source_url ~ '^https://[^[:space:]]+$'
      AND source_url !~ '^https://[^/]*@')),
  CONSTRAINT bdp_reg_evidence_title_check
    CHECK (source_title IS NULL OR (
      LENGTH(source_title) BETWEEN 1 AND 250 AND source_title = BTRIM(source_title))),
  CONSTRAINT bdp_reg_evidence_source_hash_check
    CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT bdp_reg_evidence_note_check
    CHECK (LENGTH(notes) BETWEEN 1 AND 4000 AND notes = BTRIM(notes)),
  CONSTRAINT bdp_reg_evidence_actor_check
    CHECK (LENGTH(entered_by) BETWEEN 1 AND 120 AND entered_by = BTRIM(entered_by)),
  CONSTRAINT bdp_reg_evidence_document_check
    CHECK (event_type <> 'document-indexed'
      OR (source_url IS NOT NULL AND source_title IS NOT NULL)),
  CONSTRAINT bdp_reg_evidence_unverified_only
    CHECK (verification_state = 'unverified')
);

CREATE INDEX IF NOT EXISTS bdp_reg_evidence_parcel_date_idx
  ON bdp_regulatory_evidence_events (county_fips, parcel_id, recorded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS bdp_reg_evidence_parcel_task_idx
  ON bdp_regulatory_evidence_events (county_fips, parcel_id, task_id, id DESC);

-- Ensure timestamps are allocated by the server, not submitted by clients.
CREATE OR REPLACE FUNCTION bdp_reg_evidence_recorded_at()
RETURNS trigger LANGUAGE plpgsql AS $bdp$
BEGIN
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END;
$bdp$;

-- Corrections/superseding reviews are inserted as NEW immutable events.
-- This trigger prevents ordinary UPDATE and DELETE statements; it is not a
-- cryptographic audit trail or protection against database administrators.
CREATE OR REPLACE FUNCTION bdp_reg_evidence_block_rewrites()
RETURNS trigger LANGUAGE plpgsql AS $bdp$
BEGIN
  RAISE EXCEPTION 'BDP regulatory evidence journal is append-only; insert a correction-note event'
    USING ERRCODE = '55000';
END;
$bdp$;

DO $bdp$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bdp_reg_evidence_timestamp_insert'
    AND tgrelid = 'bdp_regulatory_evidence_events'::regclass) THEN
    CREATE TRIGGER bdp_reg_evidence_timestamp_insert
      BEFORE INSERT ON bdp_regulatory_evidence_events
      FOR EACH ROW EXECUTE FUNCTION bdp_reg_evidence_recorded_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bdp_reg_evidence_no_update_delete'
    AND tgrelid = 'bdp_regulatory_evidence_events'::regclass) THEN
    CREATE TRIGGER bdp_reg_evidence_no_update_delete
      BEFORE UPDATE OR DELETE ON bdp_regulatory_evidence_events
      FOR EACH ROW EXECUTE FUNCTION bdp_reg_evidence_block_rewrites();
  END IF;
END;
$bdp$;

COMMENT ON TABLE bdp_regulatory_evidence_events IS
  'Unverified parcel-specific regulatory evidence index. Append-only supporting research; no automatic zoning, title, jurisdiction or development clearance.';

COMMIT;
