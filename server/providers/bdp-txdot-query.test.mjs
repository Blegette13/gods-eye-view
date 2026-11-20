import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchCompleteTxdotCollection } from './bdp-txdot-query.js';
import {
  normalizeTxdotAadt,
  buildTxdotParcelMetricsSql,
} from '../../src/bdp/transportation/txdotContract.js';

const BASE = 'https://example.org/arcgis/rest/services/AADT/FeatureServer/0/query?geometry=-97.8,30.2,-97.7,30.3&geometryType=esriGeometryEnvelope&resultRecordCount=2000&outFields=OBJECTID,AADT_CUR&f=geojson';

function queryParams(url, options = {}) {
  if (options.method === 'POST') {
    assert.equal(new URL(url).search, '');
    assert.match(options.headers?.['content-type'] || '', /application\/x-www-form-urlencoded/i);
    return new URLSearchParams(options.body);
  }
  return new URL(url).searchParams;
}
function mockResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  };
}
function line(id) {
  return {
    type: 'Feature',
    id,
    properties: { OBJECTID: id, AADT_CUR: 20000 },
    geometry: { type: 'LineString', coordinates: [[-97.75, 30.25], [-97.74, 30.25]] },
  };
}
const sampleParcel = {
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-97.76, 30.24], [-97.75, 30.24], [-97.75, 30.25],
      [-97.76, 30.25], [-97.76, 30.24],
    ]],
  },
};

test('retrieves all 2,001 matching AADT records without treating the 2,000 limit as complete', async () => {
  const ids = Array.from({ length: 2001 }, (_, n) => n + 1);
  let requestedPages = 0;
  const fakeFetch = async (u, options) => {
    const params = queryParams(u, options);
    if (params.get('returnIdsOnly') === 'true') {
      assert.equal(options.method, 'GET');
      assert.equal(params.get('f'), 'json');
      assert.equal(params.has('resultRecordCount'), false);
      return mockResponse({ objectIdFieldName: 'OBJECTID', objectIds: ids });
    }
    requestedPages += 1;
    assert.equal(options.method, 'POST');
    const pageIds = params.get('objectIds').split(',').map(Number);
    assert.ok(pageIds.length <= 400);
    assert.equal(params.get('f'), 'geojson');
    assert.equal(params.get('geometry'), '-97.8,30.2,-97.7,30.3');
    return mockResponse({ type: 'FeatureCollection', features: pageIds.map(line) });
  };
  const result = await fetchCompleteTxdotCollection(BASE, 'AADT', normalizeTxdotAadt, {
    fetchImpl: fakeFetch,
  });
  assert.equal(result.features.length, 2001);
  assert.equal(result.bdpFullObjectIdCoverage, true);
  assert.equal(requestedPages, 6);
  assert.match(buildTxdotParcelMetricsSql(sampleParcel, {
    roadways: { type: 'FeatureCollection', features: [] },
    aadt: result,
    history: { type: 'FeatureCollection', features: [] },
  }), /nearest_aadt_current/);
});

test('rejects oversized ID inventory before fetching any AADT geometry', async () => {
  let calls = 0;
  await assert.rejects(fetchCompleteTxdotCollection(BASE, 'AADT', normalizeTxdotAadt, {
    fetchImpl: async () => {
      calls += 1;
      return mockResponse({
        objectIdFieldName: 'OBJECTID',
        objectIds: Array.from({ length: 12001 }, (_, i) => i),
      });
    },
  }), /too many/);
  assert.equal(calls, 1);
});

test('rejects missing pages, duplicated IDs, and missing geometry rather than implying zero traffic', async () => {
  for (const scenario of ['missing-id', 'duplicate-id', 'bad-geometry']) {
    const mockFetch = async (u, options) => {
      const query = queryParams(u, options);
      if (query.get('returnIdsOnly') === 'true') {
        return mockResponse({ objectIdFieldName: 'OBJECTID', objectIds: [1, 2] });
      }
      const features = [line(1), line(2)];
      if (scenario === 'missing-id') features.pop();
      if (scenario === 'duplicate-id') features[1] = line(1);
      if (scenario === 'bad-geometry') features[1] = { ...line(2), geometry: null };
      return mockResponse({ type: 'FeatureCollection', features });
    };
    await assert.rejects(
      fetchCompleteTxdotCollection(BASE, 'AADT', normalizeTxdotAadt, { fetchImpl: mockFetch }),
      /incomplete|missing|geometry|unexpected|repeated/,
      scenario,
    );
  }
});

test('zero-result ID inventory is an empty geometry set, not a failed source', async () => {
  const result = await fetchCompleteTxdotCollection(BASE, 'AADT', normalizeTxdotAadt, {
    fetchImpl: async () => mockResponse({ objectIdFieldName: 'OBJECTID', objectIds: [] }),
  });
  assert.equal(result.features.length, 0);
  assert.equal(result.bdpFullObjectIdCoverage, true);
});

test('geometry pages avoid oversized query URLs and preserve all original spatial filters', async () => {
  const ids = Array.from({ length: 400 }, (_, i) => 100000 + i);
  let pageCalls = 0;
  const fakeFetch = async (url, options) => {
    const params = queryParams(url, options);
    if (options.method === 'GET') {
      return mockResponse({ objectIdFieldName: 'OBJECTID', objectIds: ids });
    }
    pageCalls += 1;
    assert.equal(options.method, 'POST');
    assert.ok(new URL(url).toString().length < 2000);
    assert.ok(options.body.length > 2000);
    assert.equal(params.get('geometryType'), 'esriGeometryEnvelope');
    assert.equal(params.get('returnGeometry'), null); // BASE fixture omits optional flag.
    assert.equal(params.get('outFields'), 'OBJECTID,AADT_CUR');
    const pageIds = params.get('objectIds').split(',').map(Number);
    return mockResponse({ type: 'FeatureCollection', features: pageIds.map(line) });
  };
  const result = await fetchCompleteTxdotCollection(BASE, 'AADT', normalizeTxdotAadt, {
    fetchImpl: fakeFetch,
  });
  assert.equal(pageCalls, 1);
  assert.equal(result.features.length, 400);
  assert.equal(result.bdpFullObjectIdCoverage, true);
});
