import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARCEL_GEOMETRY_SNAPSHOT_SQL } from './parcelGeometrySnapshotPlan.js';

const sql = readFileSync(
  new URL('./sql/parcelGeometryRestrictedRpcFoundation.sql', import.meta.url), 'utf8');
const definition = sql.match(/AS \$ldos_geometry_snapshot_rpc\$([\s\S]*?)\$ldos_geometry_snapshot_rpc\$;/)?.[1]?.trim();
const name = 'bdp_parcel_index.parcel_geometry_snapshot_rpc';

test('draft geometry RPC uses the exact reviewed bounded single-snapshot SQL', () => {
  assert.equal(definition, PARCEL_GEOMETRY_SNAPSHOT_SQL,
    'Function must be changed together with source-controlled snapshot contract');
  assert.match(definition, /WITH bounded AS MATERIALIZED/);
  assert.match(definition, /ST_AsGeoJSON\(raw_geometry, 9, 0\)::json/);
});

test('RPC is not auto-deployed or granted to public, metadata or app service', () => {
  assert.match(sql, /\bBEGIN;/);
  assert.match(sql, /\bCOMMIT;/);
  assert.match(sql, /CREATE FUNCTION bdp_parcel_index\.parcel_geometry_snapshot_rpc\(/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION/);
  assert.match(sql, /REVOKE ALL ON FUNCTION bdp_parcel_index\.parcel_geometry_snapshot_rpc\([\s\S]*?\) FROM PUBLIC;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION bdp_parcel_index\.parcel_geometry_snapshot_rpc\([\s\S]*?\) FROM ldos_parcel_rpc_client;/);
  assert.doesNotMatch(sql, /^\s*GRANT\s/mi);
  assert.doesNotMatch(sql, /^\s*(?:CREATE ROLE|ALTER ROLE|CREATE USER|CREATE SERVER)\b/mi);
});

test('fixed signature has eight bound parameters and never dynamic caller SQL', () => {
  const args = sql.match(/CREATE FUNCTION bdp_parcel_index\.parcel_geometry_snapshot_rpc\(([\s\S]*?)\)\s*RETURNS TABLE/)?.[1];
  assert.ok(args);
  assert.deepEqual(args.match(/p_[a-z_]+\s+(?:text|bigint|double precision|integer)/g), [
    'p_county_fips text', 'p_source_id text', 'p_run_id bigint',
    'p_west double precision', 'p_south double precision',
    'p_east double precision', 'p_north double precision',
    'p_probe_limit integer',
  ]);
  assert.match(sql, /LANGUAGE sql VOLATILE SECURITY DEFINER/);
  assert.match(sql, /SET search_path = pg_catalog, pg_temp/);
  assert.doesNotMatch(definition, /EXECUTE\s|format\(|PREPARE\s/i);
});

test('source and independent redistribution review are both mandatory', () => {
  for (const fragment of [
    "sr.rights_state = 'approved'",
    'sr.approved_caching_until > pg_catalog.clock_timestamp()',
    "rights.review_state = 'approved'",
    'rights.allow_geometry_redistribution = TRUE',
    'rights.review_reference IS NOT NULL',
    'rights.expires_at > pg_catalog.clock_timestamp()',
    'rights.expires_at <= sr.approved_caching_until',
    'JOIN bdp_parcel_index.geometry_publication_reviews AS rights',
  ]) assert.ok(definition.includes(fragment), fragment);
});

test('query is bounded by county, run, source, geography, and probe limit', () => {
  for (const fragment of [
    "sr.county_fips = $1::char(5)",
    'sr.source_id = $2::text',
    'ir.id = $3::bigint',
    'AND ($6::double precision - $4::double precision) <= 0.12',
    'AND ($7::double precision - $5::double precision) <= 0.12',
    'AND $8::integer BETWEEN 2 AND 201',
    'LIMIT $8::integer',
    'public.ST_Intersects(',
  ]) assert.ok(definition.includes(fragment), fragment);
});

test('overflow sentinel and huge geometries fail closed instead of silently disappearing', () => {
  assert.match(definition, /row_number\(\) OVER \(/);
  assert.match(definition, /< \$8::integer/);
  assert.match(definition, /geometry_vertices BETWEEN 1 AND 8000/);
  assert.match(definition, /geometry_memory_bytes BETWEEN 1 AND 524288/);
  assert.match(definition, /ELSE NULL/);
});

test('returns JSON geometry only, with no ownership, appraisal or legal status fields', () => {
  const returns = sql.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE sql/)?.[1];
  assert.ok(returns);
  assert.match(returns, /geometry json/);
  assert.doesNotMatch(returns, /owner|address|appraisal|zoning|value|tax|title/i);
  assert.ok(sql.includes(name));
});
