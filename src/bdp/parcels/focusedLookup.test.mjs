import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual shared county layer lifecycle without starting Cesium,
// touching official county services, or altering manager source registration.
function layerFixture() {
  const source = readFileSync(new URL('./bexarParcelLayer.js', import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/^export default .*;\s*$/gm, '')
    .replace(/^export /gm, '');

  const calls = { viewport: 0, specific: 0, render: 0, cards: [], camera: [] };
  const parcel = {
    id: '48453:302959',
    parcelId: '302959',
    county: 'Travis',
    property: { geometry: { type: 'Polygon', coordinates: [[
      [-97.758, 30.246], [-97.757, 30.246],
      [-97.757, 30.247], [-97.758, 30.246],
    ]] } },
  };
  const adapter = {
    county: 'Travis',
    async fetchParcel(value) {
      calls.specific += 1;
      assert.equal(value, '302959');
      return parcel;
    },
    async fetchParcelsByOwner() { return [parcel]; },
    async fetchParcelsInBounds() {
      calls.viewport += 1;
      throw new Error('Travis parcel service returned malformed or truncated GeoJSON');
    },
  };
  const fakeCesium = {
    Color: { fromCssColorString: (color) => ({ withAlpha: (alpha) => ({ color, alpha }) }) },
    Math: { toRadians: (value) => value * Math.PI / 180, toDegrees: (value) => value },
    JulianDate: { now: () => null },
    ScreenSpaceEventHandler: class {
      setInputAction() {}
      destroy() {}
    },
    ScreenSpaceEventType: { LEFT_CLICK: 1 },
    HeadingPitchRange: class {
      constructor(heading, pitch, range) { Object.assign(this, { heading, pitch, range }); }
    },
    GeoJsonDataSource: {
      async load() {
        calls.render += 1;
        return { entities: { values: [] }, show: false, name: '' };
      },
    },
  };
  const context = {
    Cesium: fakeCesium,
    DOMException,
    AbortController,
    console: { warn() {} },
    bexarCadAdapter: adapter,
    createBdpPropertyCard: () => ({
      show: (record) => calls.cards.push(record.parcelId),
      hide: () => calls.cards.push('hidden'),
      destroy() {},
    }),
    parcelGeoJsonWithBoundaries: () => ({ type: 'FeatureCollection', features: [] }),
    styleSelectedParcelEntities: () => 0,
    recommendedParcelFocusRange: () => 450,
  };
  runInNewContext(source + '\nthis.createLayerForTest = createCountyParcelLayer;', context);
  const layer = context.createLayerForTest({
    adapter,
    propertyCardFactory: context.createBdpPropertyCard,
    id: 'bdp-travis-parcels',
    name: 'Travis Parcels',
    source: 'Travis County GIS',
  });
  const viewer = {
    scene: { canvas: {}, globe: { ellipsoid: {} } },
    camera: { computeViewRectangle: () => ({ west: -97.8, east: -97.7, south: 30.2, north: 30.3 }) },
    dataSources: { add: async () => {}, remove: () => {} },
    flyTo: async (_target, options) => calls.camera.push(options),
  };
  return { layer, calls, viewer, adapter };
}

test('direct parcel lookup bypasses malformed dense viewport query during enable', async () => {
  const { layer, calls, viewer } = layerFixture();
  const release = layer.beginFocusedLookup();
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(viewer), true, 'manager first update should not preflight the viewport');
  assert.equal(calls.viewport, 0, 'no dense viewport request made');
  const result = await layer.focusParcel('302959');
  assert.equal(result.parcelId, '302959');
  assert.deepEqual(calls.cards, ['302959']);
  assert.equal(calls.specific, 1);
  assert.equal(calls.render, 1);
  assert.equal(calls.camera.length, 1);
  release();
  assert.equal(await layer.update(viewer), false, 'a later ordinary viewport failure stays visible');
  assert.equal(calls.viewport, 1);
  assert.match(layer.getStats().lastError, /malformed or truncated GeoJSON/);
  assert.equal(layer.getStats().status, 'degraded', 'retain prior selected snapshot');
  layer.destroy();
});

test('stale search cancellation cannot clear a newer focused-lookup reservation', async () => {
  const { layer, calls, viewer } = layerFixture();
  layer.init(viewer);
  layer.enable();
  const releaseOld = layer.beginFocusedLookup();
  const releaseLatest = layer.beginFocusedLookup();
  releaseOld();
  assert.equal(await layer.update(viewer), true);
  assert.equal(calls.viewport, 0);
  releaseLatest();
  assert.equal(await layer.update(viewer), false);
  assert.equal(calls.viewport, 1);
  layer.destroy();
});

test('ordinary manual layer enable still reports truncated provider results as unavailable', async () => {
  const { layer, calls, viewer } = layerFixture();
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(viewer), false);
  assert.equal(calls.viewport, 1);
  assert.equal(layer.getStats().status, 'unavailable');
  assert.equal(layer.getStats().available, false);
  layer.destroy();
});

test('dense viewport stays available but warns of incomplete GIS coverage', async () => {
  const { layer, calls, viewer, adapter } = layerFixture();
  adapter.fetchParcelsInBounds = async () => {
    calls.viewport += 1;
    const parcels = [];
    Object.defineProperty(parcels, 'viewportCoverage', {
      value: Object.freeze({ overLimit: true, receivedCount: 501, omittedUnidentified: 0 }),
    });
    return parcels;
  };
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(viewer), true, 'over-limit status must not disable county layer');
  const stats = layer.getStats();
  assert.equal(stats.status, 'degraded');
  assert.equal(stats.available, true);
  assert.equal(stats.count, 0);
  assert.equal(stats.lastError, null);
  assert.match(stats.loadingLabel, /INCOMPLETE COVERAGE.*Zoom closer/);
  assert.equal(calls.render, 0, 'not even a visually empty source snapshot is synthesized');
  assert.equal(calls.viewport, 1);
  // A subsequent exact parcel request still uses the original GIS provider.
  const parcel = await layer.focusParcel('302959');
  assert.equal(parcel.parcelId, '302959');
  assert.equal(calls.specific, 1);
  layer.destroy();
});
