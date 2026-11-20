import * as Cesium from 'cesium';
import { TCEQ_MSW_MAX_VIEW_SPAN_DEGREES } from '../environment/mswContract.js';
import { fetchTceqMswFeatures } from '../environment/client.js';

const QUERY_INTERVAL_MS = 5 * 60_000;

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
    .map((value) => Number(value).toFixed(2))
    .join(':');
}

function isCloseEnough(bounds) {
  if (!bounds) return false;
  return (
    bounds.east - bounds.west <= TCEQ_MSW_MAX_VIEW_SPAN_DEGREES
    && bounds.north - bounds.south <= TCEQ_MSW_MAX_VIEW_SPAN_DEGREES
  );
}

function propertyValue(entity, key) {
  const property = entity?.properties?.[key];
  if (!property) return null;
  return typeof property.getValue === 'function'
    ? property.getValue(Cesium.JulianDate.now())
    : property;
}

function markerStyle(entity) {
  const dataset = String(propertyValue(entity, 'dataset') || '').toLowerCase();
  const status = String(propertyValue(entity, 'physicalStatus') || '').toLowerCase();
  const unauthorized = propertyValue(entity, 'unauthorized') === true;
  const hazardous = propertyValue(entity, 'hazardousConfirmed') === true
    || propertyValue(entity, 'hazardousProbable') === true;

  if (hazardous || unauthorized || dataset === 'unnumbered') {
    return { color: '#f28cff', outline: '#ffe1ff', size: 9 };
  }
  if (dataset === 'closed' || status === 'closed' || status === 'post closure') {
    return { color: '#ffb16f', outline: '#ffe1c5', size: 8 };
  }
  if (dataset === 'revoked') {
    return { color: '#d8c17b', outline: '#f4e9be', size: 7 };
  }
  if (status === 'active') {
    return { color: '#ff7184', outline: '#ffd4da', size: 9 };
  }
  return { color: '#a7bcc5', outline: '#e1e8eb', size: 6 };
}

function styleEntities(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.position) continue;
    const style = markerStyle(entity);
    entity.point = new Cesium.PointGraphics({
      color: Cesium.Color.fromCssColorString(style.color).withAlpha(0.92),
      outlineColor: Cesium.Color.fromCssColorString(style.outline).withAlpha(0.95),
      outlineWidth: 1,
      pixelSize: style.size,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: 30_000,
    });
  }
}

export function createTceqMswLayer({
  featureLoader = fetchTceqMswFeatures,
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
      markerColor: Cesium.Color.fromCssColorString('#ff7184'),
      markerSize: 8,
    });
    next.name = 'BDP TCEQ MSW Sites';
    next.show = enabled;
    styleEntities(next);

    await viewer.dataSources.add(next);
    const previous = dataSource;
    dataSource = next;
    if (previous) viewer.dataSources.remove(previous, true);
    count = geojson.features.length;
  }

  return {
    id: 'bdp-tceq-msw',
    name: 'BDP · TCEQ Landfills / MSW',
    icon: '◆',
    source: 'TCEQ municipal-solid-waste data',
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
      if (key === lastBoundsKey && dataSource && Date.now() - lastUpdate < QUERY_INTERVAL_MS) {
        return true;
      }

      loading = true;
      status = 'loading';
      lastError = null;
      requestController?.abort();
      requestController = new AbortController();
      const controller = requestController;

      try {
        const payload = await featureLoader(bounds, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return false;
        await replaceSnapshot(payload.points);
        lastBoundsKey = key;
        lastUpdate = Date.now();
        status = payload.coverage?.complete === false || payload.truncated
          ? 'degraded' : 'nominal';
        if (status === 'degraded') lastError = 'MSW coverage incomplete/stale or viewport capped; no clearance implied';
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        lastError = error instanceof Error ? error.message : String(error);
        status = dataSource ? 'degraded' : 'unavailable';
        console.warn('[BDP:TCEQMSW] refresh failed:', error);
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
        source: 'TCEQ municipal-solid-waste data · point screening',
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

export const tceqMswLayer = createTceqMswLayer();
export default tceqMswLayer;
