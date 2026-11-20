import assert from 'node:assert/strict';
import test from 'node:test';
import { screenBdpParcelAustinZoning } from './bdp-austin-zoning.js';

const parcel = { geometry: {
  type: 'Polygon',
  coordinates: [[
    [-97.758, 30.246], [-97.757, 30.246], [-97.757, 30.247],
    [-97.758, 30.247], [-97.758, 30.246],
  ]],
} };

function mockSource(url, { incomplete = false } = {}) {
  const zoning = String(url).includes('Zoning_1');
  const field = zoning ? { ZONING_ZTYPE: 'SF-3-NP', ZONING_BASE: 'SF' }
    : { ZONING_OVERLAY_NAME: 'ETOD Overlay Eligibility', ZONING_OVERLAY_SUB_NAME: 'Subdistrict 2', ZONING_STATUS: 'Eligible' };
  return {
    ok: true, status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({
      type: 'FeatureCollection',
      exceededTransferLimit: incomplete,
      features: [{
        type: 'Feature', properties: field, geometry: parcel.geometry,
      }],
    }),
  };
}

function mockSql() {
  return {
    status: 'preliminary-intersections-only',
    exactGeometryIntersectionsCalculated: true,
    parcelGeometryValid: true,
    allCandidateGeometriesValid: true,
    parcelAreaM2: 735.55,
    overlaps: [
      { sourceName: 'zoning', attributes: { ZONING_ZTYPE: 'SF-3-NP' },
        intersectsParcel: true, sourceGeometryValid: true, areaM2: 735.55, parcelPercent: 100 },
      { sourceName: 'etodOverlay', attributes: { ZONING_STATUS: 'Eligible' },
        intersectsParcel: true, sourceGeometryValid: true, areaM2: 735.55, parcelPercent: 100 },
    ],
  };
}

test('Austin pilot sends actual geometry to PostGIS but grants no zoning or purchase clearance', async () => {
  let calls = 0;
  const result = await screenBdpParcelAustinZoning(parcel, {
    fetchImpl: async (url) => {
      calls++;
      const u = new URL(url);
      assert.equal(u.searchParams.get('f'), 'geojson');
      assert.equal(u.searchParams.get('returnGeometry'), 'true');
      assert.equal(u.searchParams.get('geometryType'), 'esriGeometryEnvelope');
      return mockSource(url);
    },
    querySql: async (sql) => {
      assert.match(sql, /ST_Intersection\(p.geom, c.geom\)/);
      return mockSql();
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.status, 'preliminary-spatial-evidence');
  assert.equal(result.parcelAreaM2, 735.55);
  assert.equal(result.observations.length, 2);
  assert.equal(result.sourceCandidates.zoning, 1);
  assert.equal(result.legalZoningVerified, false);
  assert.equal(result.jurisdictionExactOverlapVerified, false);
  assert.equal(result.etodAdoptionVerified, false);
  assert.equal(result.acquisitionRecommendation, null);
});

test('a malformed or truncated Austin GIS response blocks preliminary evidence', async () => {
  let queryInvoked = false;
  await assert.rejects(
    screenBdpParcelAustinZoning(parcel, {
      fetchImpl: async (url) => mockSource(url, { incomplete: true }),
      querySql: async () => { queryInvoked = true; return mockSql(); },
    }), /truncated/,
  );
  assert.equal(queryInvoked, false);
});

test('failed PostGIS query cannot become a legal zoning conclusion', async () => {
  await assert.rejects(screenBdpParcelAustinZoning(parcel, {
    fetchImpl: async (url) => mockSource(url),
    querySql: async () => { throw new Error('Database unavailable'); },
  }), /Database unavailable/);
});
