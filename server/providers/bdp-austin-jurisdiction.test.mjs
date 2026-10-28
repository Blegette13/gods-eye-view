import assert from 'node:assert/strict';
import test from 'node:test';
import { screenBdpParcelAustinJurisdiction } from './bdp-austin-jurisdiction.js';

const geometry = { type: 'Polygon', coordinates: [[
  [-97.758,30.246],[-97.756,30.246],[-97.756,30.248],
  [-97.758,30.248],[-97.758,30.246],
]] };
const feature = (id = 1326) => ({
  attributes: {
    OBJECTID: id, CITY_NAME: 'CITY OF AUSTIN',
    JURISDICTION_TYPE: 'FULL', JURISDICTION_TYPE_SPECIFICS: 'FULL PURPOSE',
  },
});
function reply(data) {
  return {
    ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify(data),
  };
}

test('Austin envelope jurisdiction preview returns GIS evidence, never legal clearance', async () => {
  let calls = 0;
  const metrics = await screenBdpParcelAustinJurisdiction({ geometry }, {
    fetchImpl: async (url) => {
      calls++;
      const u = new URL(url);
      assert.equal(u.searchParams.get('returnGeometry'), 'false');
      assert.equal(u.searchParams.get('geometryType'), 'esriGeometryEnvelope');
      assert.equal(u.searchParams.get('f'), 'json');
      assert.equal(u.searchParams.get('inSR'), '4326');
      return reply({ features: [feature()] });
    },
  });
  assert.equal(calls, 2);
  assert.equal(metrics.status, 'single-gis-feature-contains-parcel-envelope');
  assert.equal(metrics.candidateJurisdictions[0].specifics, 'FULL PURPOSE');
  assert.equal(metrics.sourceGeometryDownloaded, false);
  assert.equal(metrics.parcelIntersectionAreaCalculated, false);
  assert.equal(metrics.exactParcelJurisdictionVerified, false);
  assert.equal(metrics.legalJurisdictionVerified, false);
  assert.equal(metrics.sourceCurrencyVerified, false);
  assert.equal(metrics.zoningJurisdictionDetermined, false);
  assert.equal(metrics.parcelWideControllingJurisdiction, null);
  assert.equal(metrics.acquisitionRecommendation, null);
});

test('boundary ambiguity cannot be reported as one controlling city', async () => {
  const metrics = await screenBdpParcelAustinJurisdiction({ geometry }, {
    fetchImpl: async (url) => reply({ features: url.searchParams.get('spatialRel') === 'esriSpatialRelWithin'
      ? [feature()] : [feature(), {
        attributes: { ...feature(8).attributes, JURISDICTION_TYPE: 'ETJ', JURISDICTION_TYPE_SPECIFICS: 'ETJ' },
      }] }),
  });
  assert.equal(metrics.status, 'multiple-jurisdiction-features-boundary-review');
  assert.equal(metrics.parcelWideControllingJurisdiction, null);
  assert.equal(metrics.legalJurisdictionVerified, false);
});

test('failed, malformed or inconsistent ArcGIS relations reject and cannot grant clearance', async () => {
  await assert.rejects(screenBdpParcelAustinJurisdiction({ geometry }, {
    fetchImpl: async () => ({ ok: false, status: 502 }),
  }), /failed/);
  await assert.rejects(screenBdpParcelAustinJurisdiction({ geometry }, {
    fetchImpl: async () => reply({ features: [{ attributes: { CITY_NAME: 'AUSTIN' } }] }),
  }), /required GIS fields/);
  await assert.rejects(screenBdpParcelAustinJurisdiction({ geometry }, {
    fetchImpl: async (url) => reply({ features:
      [feature(url.searchParams.get('spatialRel') === 'esriSpatialRelWithin' ? 44 : 22)] }),
  }), /inconsistent/);
});
