import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSyntheticParcelProbeSmokeSql,
  DISPOSABLE_IMAGE,
  runDisposableParcelSmoke,
} from '../../../scripts/bdp/parcel-index-disposable-smoke.mjs';
import { PARCEL_VIEWPORT_PROBE_SQL } from './parcelViewportReadPlan.js';

test('disposable validation embeds exact source-controlled SQL and checks real spatial/rights behavior', () => {
  const sql = createSyntheticParcelProbeSmokeSql();
  assert.ok(sql.includes(PARCEL_VIEWPORT_PROBE_SQL));
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /\nROLLBACK;\n$/);
  assert.match(sql, /ST_Intersects\(pv.geometry, b.bounds\)/);
  assert.match(sql, /revoked source remained readable/);
  assert.match(sql, /expired source remained readable/);
  assert.match(sql, /spatially intersecting synthetic parcel/);
  assert.match(sql, /example\.invalid/);
  assert.equal(DISPOSABLE_IMAGE, 'postgis/postgis:17-3.5');
});

test('generator rejects missing or adulterated spatial queries', () => {
  assert.throws(() => createSyntheticParcelProbeSmokeSql('SELECT 1'), TypeError);
  assert.throws(() => createSyntheticParcelProbeSmokeSql(PARCEL_VIEWPORT_PROBE_SQL + ' $ldos_probe$'), TypeError);
});

test('accidental invocation is denied before Docker is contacted', async () => {
  await assert.rejects(runDisposableParcelSmoke([]), /Refusing to run/);
  await assert.rejects(runDisposableParcelSmoke(['--production']), /Refusing to run/);
});
