import * as Cesium from 'cesium';
import {
  THC_CEMETERY_MAX_VIEW_SPAN_DEGREES,
} from '../cultural/cemeteryContract.js';
import { fetchThcCemeteryFeatures } from '../cultural/client.js';

const QUERY_INTERVAL_MS = 30 * 60_000;

function rectangleToBounds(rectangle) {
  if (!rectangle) return null;
  return {
    west: Cesium.Math.toDegrees(rectangle.west),
    south: Cesium.Math.toDegrees(rectangle.south),
    east: Cesium.Math.toDegrees(rectangle.east),
    north: Cesium.Math.toDegrees(rectangle.north),
  };
}

function boundsKey(bounds) {
  if (!bounds) return '';
  return [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((value) => Number(value).toFixed(3))
    .join(':');
}

function isCloseEnough(bounds) {
  if (!bounds) return false;
  return (
    bounds.east - bounds.west <= THC_CEMETERY_MAX_VIEW_SPAN_DEGREES
    && bounds.north - bounds.south <= THC_CEMETERY_MAX_VIEW_SPAN_DEGREES
  );
}

function styleEntities(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    entity.polygon.material = Cesium.Color.fromCssColorString('#c7f4d1').withAlpha(0.08);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.fromCssColorString('#d9ffe0').withAlpha(0.72);
  }
}

export function createThcCemeteryLayer({
  featureLoader = fetchThcCemeteryFeatures,
} = {}) {
  let viewer = null;
  let dataSource = null;
  let enabled = false;
  let loading = false;
  let status = 'idle';
  let count = 0;
  let lastUpdate = null;
  let lastError = null;
  let lastBoundsKey = '';
  let requestController = null;

  async function replaceSnapshot(geojson) {
    const next = await Cesium.GeoJsonDataSource.load(geojson, {
      clampToGround: true,
      stroke: Cesium.Color.fromCssColorString('#d9ffe0').withAlpha(0.72),
      strokeWidth: 1.5,
      fill: Cesium.Color.fromCssColorString('#c7f4d1').withAlpha(0.08),
    });
    next.name = 'BDP THC Cemeteries';
    next.show = enabled;
    styleEntities(next);

    await viewer.dataSources.add(next);
    const previous = dataSource;
    dataSource = next;
    if (previous) viewer.dataSources.remove(previous, true);
    count = geojson.features.length;
  }

  return {
    id: 'bdp-thc-cemeteries',
    name: 'BDP · THC Cemeteries',
    icon: '✦',
    source: 'Texas Historical Commission Historic Sites Atlas',
    updateInterval: QUERY_INTERVAL_MS,

    init(targetViewer) {
      viewer = targetViewer;
      enabled = false;
      loading = false;
      status = 'idle';
      count = 0;
      lastUpdate = null;
      lastError = null;
      lastBoundsKey = '';
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
    },

    disable() {
      enabled = false;
      if (dataSource) dataSource.show = false;
      requestController?.abort();
      requestController = null;
    },

    async update(targetViewer) {
      if (!enabled || loading) return true;
      viewer = targetViewer || viewer;
      const rectangle = viewer?.camera?.computeViewRectangle(
        viewer.scene.globe.ellipsoid,
      );
      const bounds = rectangleToBounds(rectangle);

      if (!isCloseEnough(bounds)) {
        status = 'zoom-in';
        lastError = null;
        return true;
      }

      const key = boundsKey(bounds);
      if (key === lastBoundsKey && dataSource) {
        status = 'nominal';
        return true;
      }

      loading = true;
      status = 'loading';
      lastError = null;
      requestController?.abort();
      requestController = new AbortController();

      try {
        const geojson = await featureLoader(bounds, {
          signal: requestController.signal,
        });
        if (requestController.signal.aborted) return false;
        await replaceSnapshot(geojson);
        lastBoundsKey = key;
        lastUpdate = Date.now();
        status = 'nominal';
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        lastError = error instanceof Error ? error.message : String(error);
        status = dataSource ? 'degraded' : 'unavailable';
        console.warn('[BDP:THCCemeteries] refresh failed:', error);
        return false;
      } finally {
        loading = false;
      }
    },

    getStats() {
      return {
        count,
        loading,
        status,
        source: 'THC Historic Sites Atlas · public cemetery polygons',
        lastUpdate,
        lastError,
        error: lastError,
        available: status !== 'unavailable',
      };
    },

    destroy() {
      requestController?.abort();
      requestController = null;
      if (dataSource && viewer) viewer.dataSources.remove(dataSource, true);
      dataSource = null;
      viewer = null;
      enabled = false;
      loading = false;
    },
  };
}

export const thcCemeteryLayer = createThcCemeteryLayer();
export default thcCemeteryLayer;
