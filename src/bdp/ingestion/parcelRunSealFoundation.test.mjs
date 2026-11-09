import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL(
  './sql/parcelRunSealFoundation.sql', import.meta.url), 'utf8');
const seal = sql.split('AS $ldos_run_seal_insert$')[1]
  ?.split('$ldos_run_seal_insert$;')[0];
const mutation = sql.split('AS $ldos_sealed_run_mutation$')[1]
  ?.split('$ldos_sealed_run_mutation$;')[0];

test('staged seal is a manual transactional migration, never a live service grant', () => {
  assert.match(sql, /DRAFT ONLY \/ DBA REVIEW \/ NOT AUTO-MIGRATED/);
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
  assert.doesNotMatch(sql, /^\s*GRANT\s/mi);
  assert.doesNotMatch(sql, /^\s*(?:CREATE ROLE|CREATE USER|CREATE SERVER|COPY)\b/mi);
  assert.match(sql, /REVOKE ALL ON TABLE bdp_parcel_index\.parcel_run_seals FROM PUBLIC/);
});

test('one immutable seal identifies one run and its exact source/version/county', () => {
  assert.match(sql, /CREATE TABLE bdp_parcel_index\.parcel_run_seals/);
  assert.match(sql, /ingest_run_id BIGINT PRIMARY KEY/);
  assert.match(sql, /REFERENCES bdp_parcel_index\.ingest_runs\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /source_id TEXT NOT NULL/);
  assert.match(sql, /county_fips CHAR\(5\) NOT NULL/);
  assert.match(sql, /source_version TEXT NOT NULL/);
  assert.match(sql, /indexed_records BIGINT NOT NULL CHECK \(indexed_records >= 0\)/);
});

test('seal only accepts fully completed and evidenced source runs', () => {
  assert.ok(seal);
  assert.match(seal, /v_outcome IS DISTINCT FROM 'complete'/);
  assert.match(seal, /v_finished IS NULL/);
  assert.match(seal, /v_omitted IS DISTINCT FROM 0/);
  assert.match(seal, /v_truncated IS DISTINCT FROM FALSE/);
  assert.match(seal, /v_received IS NULL OR v_received < 0/);
});

test('seal verifies the same source, county, version and indexed record count', () => {
  for (const frag of [
    'NEW.source_id IS DISTINCT FROM v_source',
    'NEW.county_fips IS DISTINCT FROM v_county',
    'NEW.source_version IS DISTINCT FROM v_version',
    'pv.ingest_run_id = NEW.ingest_run_id',
    'pv.source_id = v_source',
    'pv.county_fips = v_county',
    'pv.source_version = v_version',
    'v_indexed IS DISTINCT FROM v_received',
    'NEW.indexed_records IS DISTINCT FROM v_indexed',
  ]) assert.ok(seal.includes(frag), frag);
});

test('sealing serializes with writers via the parent run row lock', () => {
  assert.match(seal, /FOR UPDATE OF ir/);
  assert.match(mutation, /WHERE id = v_old_id FOR SHARE/);
  assert.match(mutation, /WHERE id = v_new_id FOR SHARE/);
  assert.match(mutation, /v_new_id IS DISTINCT FROM v_old_id/);
});

test('sealed parcel rows cannot be inserted, updated, deleted or moved between runs', () => {
  assert.match(sql, /CREATE TRIGGER parcel_versions_sealed_run_guard\s+BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(mutation, /IF TG_OP = 'INSERT' THEN/);
  assert.match(mutation, /ELSIF TG_OP = 'DELETE' THEN/);
  assert.match(mutation, /v_old_id := OLD\.ingest_run_id/);
  assert.match(mutation, /v_new_id := NEW\.ingest_run_id/);
  assert.match(mutation, /SELECT 1 FROM bdp_parcel_index\.parcel_run_seals/);
  assert.match(mutation, /Sealed parcel run is immutable/);
  assert.match(mutation, /Cannot add or move records into a sealed parcel run/);
});

test('sealed source-window records cannot mutate, preventing false historical coverage', () => {
  assert.match(sql, /CREATE TRIGGER coverage_windows_sealed_run_guard\s+BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(sql, /EXECUTE FUNCTION bdp_parcel_index\.guard_sealed_parcel_run_mutation\(\)/);
});

test('finalized run metadata cannot mutate once sealed', () => {
  assert.match(sql, /CREATE TRIGGER ingest_runs_sealed_run_guard\s+BEFORE UPDATE OR DELETE/);
  assert.match(mutation, /IF TG_TABLE_NAME = 'ingest_runs' THEN/);
  assert.match(mutation, /v_old_id := OLD\.id/);
});

test('seal records cannot be updated/deleted or assigned an attacker-supplied date', () => {
  assert.match(sql, /CREATE TRIGGER parcel_run_seal_guard\s+BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(seal, /IF TG_OP <> 'INSERT' THEN/);
  assert.match(seal, /Run seal cannot be changed/);
  assert.match(seal, /NEW\.sealed_at := clock_timestamp\(\)/);
});

test('function search paths and privileges remain constrained', () => {
  assert.equal((sql.match(/LANGUAGE plpgsql SECURITY INVOKER/g) || []).length, 2);
  assert.equal((sql.match(/SET search_path = pg_catalog, pg_temp/g) || []).length, 2);
  assert.match(sql, /REVOKE ALL ON FUNCTION bdp_parcel_index\.guard_parcel_run_seal_insert\(\)\s+FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON FUNCTION bdp_parcel_index\.guard_sealed_parcel_run_mutation\(\)\s+FROM PUBLIC/);
  assert.doesNotMatch(sql, /SECURITY DEFINER/);
});

test('proof is deliberately only immutable snapshot evidence, not legal approval or complete map', () => {
  assert.match(sql, /not redistribution rights, a legal survey, or a cross-request MVCC snapshot/);
  assert.match(sql, /Future geometry RPCs MUST independently REQUIRE a valid seal/);
  assert.match(sql, /staged[\s\S]*RPCs from 40C-18 and 40C-24 do NOT enforce this yet/i);
});

test('no persistent source GIS data or browser connection is created', () => {
  assert.doesNotMatch(sql, /\b(?:CREATE EXTENSION|INSERT INTO bdp_parcel_index\.parcel_versions)\b/i);
  assert.doesNotMatch(sql, /^\s*(?:ALTER DEFAULT PRIVILEGES|GRANT|CREATE MATERIALIZED VIEW)\b/mi);
  assert.match(sql, /REVOKE ALL ON TABLE bdp_parcel_index\.parcel_run_seals FROM PUBLIC/);
});
