import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const foundation = readFileSync(new URL('./sql/parcelRestrictedRpcFoundation.sql', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('./sql/parcelRestrictedRpcSmoke.sql', import.meta.url), 'utf8');

test('restricted metadata role is NOLOGIN and cannot be used as a direct GIS reader', () => {
  assert.match(foundation, /CREATE ROLE ldos_parcel_rpc_client NOLOGIN NOINHERIT/);
  assert.match(foundation, /REVOKE ALL ON ALL TABLES IN SCHEMA bdp_parcel_index FROM ldos_parcel_rpc_client/);
  assert.match(foundation, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA bdp_parcel_index FROM ldos_parcel_rpc_client/);
});

test('two fixed PostGIS metadata functions enforce bounds and expiry', () => {
  assert.match(foundation, /approved_sources_rpc/);
  assert.match(foundation, /parcel_viewport_probe_rpc/);
  assert.match(foundation, /SET search_path = pg_catalog, pg_temp/);
  assert.match(foundation, /p_probe_limit BETWEEN 2 AND 201/);
  assert.match(foundation, /p_east - p_west <= 0\.12/);
  assert.match(foundation, /p_north - p_south <= 0\.12/);
  assert.match(foundation, /sr\.approved_caching_until > pg_catalog\.clock_timestamp\(\)/);
  assert.doesNotMatch(foundation, /ST_AsGeoJSON|ST_AsMVT/);
});

test('approved-source function uses valid PostgreSQL EXTRACT special syntax', () => {
  // EXTRACT(EPOCH FROM timestamp) is PostgreSQL grammar, not a normal
  // schema-qualified function call. Qualifying it with pg_catalog.extract
  // causes a runtime syntax error near FROM when the function is created.
  assert.match(foundation,
    /FLOOR\(EXTRACT\(EPOCH FROM sr\.approved_caching_until\) \* 1000\)::double precision/);
  assert.doesNotMatch(foundation, /pg_catalog\.extract\s*\(/i);
});

test('isolated fixture always rolls back invented parcel data', () => {
  assert.match(fixture, /BEGIN;/);
  assert.match(fixture, /ROLLBACK;/);
  assert.match(fixture, /example\.invalid/);
  assert.match(fixture, /revoked source still available/);
  assert.match(fixture, /bounded spatial query mismatch/);
});
