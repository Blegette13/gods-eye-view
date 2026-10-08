import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDevelopmentConstraintSql, DEVELOPMENT_CONSTRAINT_NOTICE } from './constraintFootprint.js';
import { normalizeFemaFeatureCollection, FEMA_MAX_PARCEL_FEATURES } from '../environment/floodContract.js';
import { normalizeNwiFeatureCollection, NWI_MAX_SOURCE_FEATURES } from '../environment/wetlandsContract.js';
import { createBdpEnvironmentSession } from '../../../server/providers/bdp-environment.js';

const parcel = { geometry: { type: 'Polygon', coordinates: [[[-98.5,29.4],[-98.49,29.4],[-98.49,29.41],[-98.5,29.41],[-98.5,29.4]]] } };
const empty = { type: 'FeatureCollection', features: [] };
const feature = { type: 'Feature', geometry: parcel.geometry, properties: { FLD_ZONE: 'AE', SFHA_TF: 'T' } };

test('constraint footprint uses PostGIS clipping/union and withholds verified buildable acreage', () => {
  const sql = buildDevelopmentConstraintSql(parcel, { flood: { ...empty, features: [feature] }, wetlands: empty });
  assert.match(sql, /ST_UnaryUnion/);
  assert.match(sql, /ST_Intersection/);
  assert.match(sql, /'verified_buildable_acres',NULL/);
  assert.match(sql, /'development_score_ready',false/);
  assert.match(sql, /incomplete-fema-coverage/);
  assert.match(DEVELOPMENT_CONSTRAINT_NOTICE, /not verified buildable/);
  assert.throws(() => buildDevelopmentConstraintSql(parcel, { flood: null, wetlands: empty }), /malformed/);
});

test('capped, truncated and malformed upstream polygons stay unavailable, never clear', () => {
  for (const [normalize, cap] of [[normalizeFemaFeatureCollection, FEMA_MAX_PARCEL_FEATURES], [normalizeNwiFeatureCollection, NWI_MAX_SOURCE_FEATURES]]) {
    for (const extra of [{ exceededTransferLimit: true }, { properties: { exceededTransferLimit: true } }]) {
      assert.throws(() => normalize({ ...empty, ...extra }), /capped or truncated/);
    }
    assert.throws(() => normalize({ ...empty, features: Array(cap).fill(feature) }), /capped/);
    assert.throws(() => normalize({ ...empty, features: [{ type: 'Feature', geometry: null }] }), /invalid polygon/);
  }
});

test('a request-local session fetches each source once for independent metrics and combined footprint', async () => {
  let floodCalls = 0;
  let wetlandCalls = 0;
  const queries = [];
  const session = createBdpEnvironmentSession(parcel, {
    floodFeaturesLoader: async () => { floodCalls += 1; return empty; },
    wetlandsFeaturesLoader: async () => { wetlandCalls += 1; return empty; },
    query: async (sql) => { queries.push(sql); return { valid: true }; },
  });
  const results = await Promise.all([session.screenFlood(), session.screenWetlands(), session.screenDevelopmentConstraints()]);
  assert.equal(floodCalls, 1);
  assert.equal(wetlandCalls, 1);
  assert.equal(queries.length, 3);
  assert.ok(queries.some((sql) => sql.includes('combined_mapped_constraint_acres')));
  assert.ok(results.every((result) => result.metrics.valid));
  const next = createBdpEnvironmentSession(parcel, { floodFeaturesLoader: async () => { floodCalls += 1; return empty; }, query: async () => ({}) });
  await next.screenFlood();
  assert.equal(floodCalls, 2); // No shared cache across parcels/requests.
});

test('failed flood evidence withholds combined footprint but preserves successful wetland evidence', async () => {
  const error = new Error('FEMA source unavailable');
  const session = createBdpEnvironmentSession(parcel, {
    floodFeaturesLoader: async () => { throw error; },
    wetlandsFeaturesLoader: async () => empty,
    query: async () => ({ nwi_percent: 7 }),
  });
  const results = await Promise.allSettled([session.screenFlood(), session.screenWetlands(), session.screenDevelopmentConstraints()]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].value.metrics.nwi_percent, 7);
  assert.equal(results[2].status, 'rejected');
});
