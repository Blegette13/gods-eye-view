import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import {
  PRIVATE_SEALED_INITIAL_RPC_SQL,
  buildPrivateSealedInitialRpcStatement,
} from './parcelSealedInitialPagePlan.js';

const initial = readFileSync(new URL(
  './sql/parcelGeometrySealedInitialRpcFoundation.sql', import.meta.url), 'utf8');
const keyset = readFileSync(new URL(
  './sql/parcelGeometryKeysetRpcFoundation.sql', import.meta.url), 'utf8');
const initialBody = initial.split('AS $ldos_sealed_initial_rpc$')[1]
  ?.split('$ldos_sealed_initial_rpc$;')[0]?.trim();
const keysetBody = keyset.split('AS $ldos_geometry_keyset_rpc$')[1]
  ?.split('$ldos_geometry_keyset_rpc$;')[0]?.trim();
const after = [
  "    AND $9::text ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'",
  '    AND $10::bigint > 0',
  '    AND (',
  '      pv.source_parcel_id COLLATE "C" > ($9::text COLLATE "C")',
  '      OR (',
  '        pv.source_parcel_id COLLATE "C" = ($9::text COLLATE "C")',
  '        AND pv.id > $10::bigint',
  '      )',
  '    )',
].join('\n');

const plan = () => parseBoundedParcelPageRequest({
  countyFips: '48453', limit: 2,
  bounds: { west: -97.76, south: 30.24, east: -97.71, north: 30.27 },
});
const statement = (overrides = {}) => buildPrivateSealedInitialRpcStatement({
  plan: plan(), trustedSourceId: 'travis-cad', trustedRunId: 42, ...overrides,
});

test('first page is identical to sealed keyset SQL except strictly-after keyset filter', () => {
  assert.ok(initialBody);
  assert.ok(keysetBody);
  assert.equal(keysetBody.replace('\n' + after, ''), initialBody);
  assert.ok(!initialBody.includes('$9::'));
  assert.ok(!initialBody.includes('$10::'));
});

test('first page requires matching sealed, complete, untruncated indexed run', () => {
  for (const fragment of [
    'JOIN bdp_parcel_index.parcel_run_seals AS seal',
    'seal.ingest_run_id = ir.id',
    'seal.source_id = ir.source_id',
    'seal.county_fips = sr.county_fips',
    'seal.source_version = ir.source_version',
    'seal.indexed_records = ir.received_records',
    'seal.sealed_at >= ir.finished_at',
    "ir.outcome = 'complete'",
    'ir.omitted_unidentified = 0',
    'ir.source_reported_truncated = FALSE',
  ]) assert.ok(initialBody.includes(fragment), fragment);
  assert.doesNotMatch(initialBody, /ir\.outcome IN \('complete', 'partial'\)/);
});

test('current cache and independent geometry-publication rights still gate initial page', () => {
  for (const fragment of [
    "sr.rights_state = 'approved'",
    'sr.approved_caching_until > pg_catalog.clock_timestamp()',
    "rights.review_state = 'approved'",
    'rights.allow_geometry_redistribution = TRUE',
    'rights.review_reference IS NOT NULL',
    'rights.expires_at > pg_catalog.clock_timestamp()',
    'rights.expires_at <= sr.approved_caching_until',
    'ir.id = $3::bigint',
    'sr.source_id = $2::text',
    'sr.county_fips = $1::char(5)',
  ]) assert.ok(initialBody.includes(fragment), fragment);
});

test('initial page respects bounded WGS84, stable order, bounded geometry and null overflow', () => {
  for (const fragment of [
    '($6::double precision - $4::double precision) <= 0.12',
    '($7::double precision - $5::double precision) <= 0.12',
    '$8::integer BETWEEN 2 AND 201',
    'pv.geometry OPERATOR(public.&&)',
    'public.ST_Intersects(pv.geometry',
    'ORDER BY pv.source_parcel_id COLLATE "C" ASC, pv.id ASC',
    'geometry_vertices BETWEEN 1 AND 8000',
    'geometry_memory_bytes BETWEEN 1 AND 524288',
    'ELSE NULL',
    'LIMIT $8::integer',
  ]) assert.ok(initialBody.includes(fragment), fragment);
});

test('new security definer function has fixed 8-argument signature and zero grants', () => {
  assert.match(initial, /^BEGIN;/m);
  assert.match(initial, /^COMMIT;/m);
  assert.match(initial, /^CREATE FUNCTION bdp_parcel_index\.parcel_geometry_sealed_initial_rpc\(/m);
  assert.match(initial, /LANGUAGE sql VOLATILE SECURITY DEFINER/);
  assert.match(initial, /SET search_path = pg_catalog, pg_temp/);
  assert.match(initial, /REVOKE ALL ON FUNCTION bdp_parcel_index\.parcel_geometry_sealed_initial_rpc\([\s\S]*?\) FROM PUBLIC;/);
  assert.match(initial, /REVOKE ALL ON FUNCTION bdp_parcel_index\.parcel_geometry_sealed_initial_rpc\([\s\S]*?\) FROM ldos_parcel_rpc_client;/);
  assert.doesNotMatch(initial, /^\s*GRANT\s/mi);
  assert.doesNotMatch(initial, /CREATE OR REPLACE FUNCTION|CREATE ROLE|CREATE USER|COPY /);
  assert.doesNotMatch(initialBody, /\bEXECUTE\s|format\s*\(/i);
  assert.equal((PRIVATE_SEALED_INITIAL_RPC_SQL.match(/\$\d+::/g) || []).length, 8);
});

test('initial RPC result contains only whitelisted fields, not inferred title or prices', () => {
  const returned = initial.match(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE sql/)?.[1];
  assert.ok(returned);
  for (const field of [
    'parcel_version_id bigint', 'source_parcel_id text',
    'source_version text', 'source_geometry_sha256 text',
    'ingest_run_id bigint', 'source_id text', 'county_fips text',
    'geometry_vertices integer', 'geometry_memory_bytes integer', 'geometry json',
  ]) assert.ok(returned.includes(field), field);
  assert.doesNotMatch(returned, /owner|appraisal|sale|price|market|title|zoning/i);
});

test('trusted bounded plan produces exact, parameterized first-page RPC query only', () => {
  const result = statement();
  assert.ok(result);
  assert.equal(result.text, PRIVATE_SEALED_INITIAL_RPC_SQL);
  assert.deepEqual(result.values, [
    '48453', 'travis-cad', 42, -97.76, 30.24, -97.71, 30.27, 3,
  ]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.values));
  assert.equal(result.publishAuthorized, false);
  assert.equal(result.geometryDelivered, false);
  assert.equal(result.viewportCoverage, 'unknown');
});

test('malformed county, source/run, source-supplied SQL and unbounded requests deny planning', () => {
  const current = plan();
  for (const overrides of [
    { trustedSourceId: 'TRAVIS-CAD' },
    { trustedSourceId: "'; DROP TABLE" },
    { trustedRunId: 0 },
    { trustedRunId: '42' },
    { plan: { ...current, countyFips: '06037' } },
    { plan: { ...current, limit: 300, probeLimit: 301 } },
    { plan: { ...current, bounds: { ...current.bounds, east: -96.5 } } },
  ]) assert.equal(statement(overrides), null);
});

test('extra or forged cursor, coverage, publication or network controls fail closed', () => {
  const current = plan();
  for (const extra of [
    { cursor: 'untrusted' }, { publishAuthorized: true },
    { viewportCoverage: 'complete' }, { geometryDelivered: true },
    { trustedSourceId: 'other' },
  ]) assert.equal(statement({ plan: { ...current, ...extra } }), null);
  assert.equal(statement({
    plan: { ...current, bounds: { ...current.bounds, sql: 'select *' } },
  }), null);
  assert.equal(statement({ plan: { ...current, probeLimit: current.probeLimit + 1 } }), null);
});

test('first page is staged, does not expose HTTP or authorize a completed viewport', () => {
  assert.match(initial, /DBA-REVIEW-ONLY/);
  assert.match(initial, /NOT session authentication/);
  assert.match(initial, /an MVCC snapshot/i);
  assert.doesNotMatch(PRIVATE_SEALED_INITIAL_RPC_SQL, /CREATE |GRANT |COPY |EXECUTE /);
  assert.match(initial, /no public delivery or confirmed viewport coverage/);
});
