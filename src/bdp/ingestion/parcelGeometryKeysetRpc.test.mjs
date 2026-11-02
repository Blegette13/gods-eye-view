import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRIVATE_PARCEL_KEYSET_RPC_SQL } from './parcelKeysetPagination.js';
import { PARCEL_GEOMETRY_SNAPSHOT_SQL } from './parcelGeometrySnapshotPlan.js';

const sql = readFileSync(new URL(
  './sql/parcelGeometryKeysetRpcFoundation.sql', import.meta.url), 'utf8');
const body = sql.split('AS $ldos_geometry_keyset_rpc$')[1]
  ?.split('$ldos_geometry_keyset_rpc$;')[0]?.trim();
const after = `    AND $9::text ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
    AND $10::bigint > 0
    AND (
      pv.source_parcel_id COLLATE "C" > ($9::text COLLATE "C")
      OR (
        pv.source_parcel_id COLLATE "C" = ($9::text COLLATE "C")
        AND pv.id > $10::bigint
      )
    )`;

const sealedJoin = `  JOIN bdp_parcel_index.parcel_run_seals AS seal
    ON seal.ingest_run_id = ir.id
    AND seal.source_id = ir.source_id
    AND seal.county_fips = sr.county_fips
    AND seal.source_version = ir.source_version
    AND seal.indexed_records = ir.received_records
    AND seal.sealed_at >= ir.finished_at
`;
const sealedEvidence = `    AND ir.outcome = 'complete'
    AND ir.received_records IS NOT NULL
    AND ir.omitted_unidentified = 0
    AND ir.source_reported_truncated = FALSE`;

test('keyset retains original snapshot query except for fixed position and seal gates', () => {
  assert.ok(body);
  const unsealed = body
    .replace(sealedJoin, '')
    .replace('\n' + after, '')
    .replace('    AND seal.sealed_at IS NOT NULL\n', '')
    .replace(sealedEvidence, "    AND ir.outcome IN ('complete', 'partial')");
  assert.equal(unsealed, PARCEL_GEOMETRY_SNAPSHOT_SQL,
    'Changing source, bounds or publication rights must update keyset SQL');
});

test('unsealed and partially ingested runs cannot qualify for continuation', () => {
  assert.ok(body.includes(sealedJoin));
  assert.ok(body.includes(sealedEvidence));
  assert.match(body, /JOIN bdp_parcel_index\.parcel_run_seals AS seal/);
  assert.match(body, /seal\.ingest_run_id = ir\.id/);
  assert.match(body, /seal\.indexed_records = ir\.received_records/);
  assert.match(body, /seal\.source_version = ir\.source_version/);
  assert.match(body, /seal\.county_fips = sr\.county_fips/);
  assert.match(body, /seal\.sealed_at >= ir\.finished_at/);
  assert.doesNotMatch(body, /ir\.outcome IN \('complete', 'partial'\)/);
});

test('seal foundation must be installed first and does not create a public grant', () => {
  assert.match(sql, /Run-seal foundation must be installed BEFORE this draft/);
  assert.doesNotMatch(sql, /^\s*GRANT\s/mi);
});

test('exact 10-argument SQL signature matches the existing cursor planner', () => {
  const args = sql.match(
    /CREATE FUNCTION bdp_parcel_index\.parcel_geometry_keyset_rpc\(([\s\S]*?)\)\s*RETURNS TABLE/)?.[1];
  assert.ok(args);
  assert.deepEqual(args.match(/p_[a-z_]+\s+(?:text|bigint|double precision|integer)/g), [
    'p_county_fips text','p_source_id text','p_run_id bigint',
    'p_west double precision','p_south double precision',
    'p_east double precision','p_north double precision',
    'p_probe_limit integer','p_after_source_parcel_id text',
    'p_after_parcel_version_id bigint',
  ]);
  assert.equal((PRIVATE_PARCEL_KEYSET_RPC_SQL.match(/\$\d+::/g) || []).length, 10);
  assert.match(PRIVATE_PARCEL_KEYSET_RPC_SQL, /parcel_geometry_keyset_rpc\(/);
});

test('cursor comparison is strictly after the last accepted parcel using C collation and bigint', () => {
  assert.ok(body.includes(after));
  assert.match(body, /pv\.source_parcel_id COLLATE "C" > \(\$9::text COLLATE "C"\)/);
  assert.match(body, /pv\.id > \$10::bigint/);
  assert.match(body, /ORDER BY pv\.source_parcel_id COLLATE "C" ASC, pv\.id ASC/);
  assert.match(body, /ORDER BY source_parcel_id COLLATE "C" ASC, parcel_version_id ASC/);
  assert.match(body, /LIMIT \$8::integer/);
  assert.match(body, /AND \$10::bigint > 0/);
  assert.match(body, /AND \$9::text ~ '\^\[A-Za-z0-9\]/);
});

test('cache and independent redistribution-rights gates are mandatory on every next page', () => {
  for (const fragment of [
    "sr.rights_state = 'approved'",
    "sr.approved_caching_until > pg_catalog.clock_timestamp()",
    "rights.review_state = 'approved'",
    'rights.allow_geometry_redistribution = TRUE',
    'rights.expires_at > pg_catalog.clock_timestamp()',
    'rights.expires_at <= sr.approved_caching_until',
    "ir.outcome = 'complete'",
    'AND ir.id = $3::bigint',
    "sr.county_fips = $1::char(5)",
    'sr.source_id = $2::text',
  ]) assert.ok(body.includes(fragment), fragment);
});

test('bounded spatial predicate, strict overflow and feature budget survive pagination', () => {
  for (const fragment of [
    '($6::double precision - $4::double precision) <= 0.12',
    '($7::double precision - $5::double precision) <= 0.12',
    'AND $8::integer BETWEEN 2 AND 201',
    'pv.geometry OPERATOR(public.&&)',
    'public.ST_Intersects(pv.geometry,',
    'geometry_vertices BETWEEN 1 AND 8000',
    'geometry_memory_bytes BETWEEN 1 AND 524288',
    'ELSE NULL',
  ]) assert.ok(body.includes(fragment), fragment);
  assert.match(body, /row_number\(\) OVER \(/);
  assert.match(body, /\) < \$8::integer/);
});

test('new SECURITY DEFINER function has a pinned search path and no dynamic SQL', () => {
  assert.match(sql, /LANGUAGE sql VOLATILE SECURITY DEFINER/);
  assert.match(sql, /SET search_path = pg_catalog, pg_temp/);
  assert.match(sql, /^CREATE FUNCTION bdp_parcel_index\.parcel_geometry_keyset_rpc\(/m);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION/);
  assert.doesNotMatch(body, /\bEXECUTE\s|\bPREPARE\s|format\s*\(/i);
});

test('no public, metadata-only or application role gains EXECUTE privileges', () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
  assert.doesNotMatch(sql, /^\s*GRANT\s/mi);
  assert.match(sql, /REVOKE ALL ON FUNCTION bdp_parcel_index\.parcel_geometry_keyset_rpc\([\s\S]*?\) FROM PUBLIC;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION bdp_parcel_index\.parcel_geometry_keyset_rpc\([\s\S]*?\) FROM ldos_parcel_rpc_client;/);
  assert.doesNotMatch(sql, /^\s*(?:CREATE ROLE|ALTER ROLE|CREATE USER)\b/mi);
});

test('function only returns whitelisted indexed source and geometry metadata', () => {
  const returns = sql.match(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE sql/)?.[1];
  assert.ok(returns);
  assert.match(returns, /parcel_version_id bigint/);
  assert.match(returns, /source_geometry_sha256 text/);
  assert.match(returns, /geometry json/);
  assert.doesNotMatch(returns, /owner|appraisal|sale|market|zoning|title|address/i);
});

test('draft creates no connection, GIS licence, endpoint, cookie or database role', () => {
  assert.doesNotMatch(sql, /^\s*(?:CREATE USER|CREATE ROLE|GRANT|COPY|CREATE SERVER)\b/mi);
  assert.doesNotMatch(sql, /\bhttps?:\/\//i);
  assert.match(sql, /DBA-REVIEW-ONLY/);
  assert.match(sql, /not authorization|not an immutable MVCC snapshot/i);
});
