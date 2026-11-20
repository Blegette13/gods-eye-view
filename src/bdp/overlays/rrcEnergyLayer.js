import * as Cesium from 'cesium';
import { fetchRrcFeatures } from '../rrc/client.js';
import { RRC_MAX_VIEW_SPAN_DEGREES } from '../rrc/apiContract.js';

const QUERY_INTERVAL_MS = 60_000;
const BEXAR_COUNTY_FIPS = '48029';

function rectangleToBounds(rectangle) {
  if (!rectangle) return null;
  return {
    west: Cesium.Math.toDegrees(rectangle.west),
    south: Cesium.Math.toDegrees(rectangle.south),
    east: Cesium.Math.toDegrees(rectangle.east),
    north: Cesium.Math.toDegrees(rectangle.north),
  };
}

function isCloseEnough(bounds) {
  if (!bounds) return false;
  return (
    bounds.east - bounds.west <= RRC_MAX_VIEW_SPAN_DEGREES
    && bounds.north - bounds.south <= RRC_MAX_VIEW_SPAN_DEGREES
  );
}

function boundsKey(bounds) {
  if (!bounds) return '';
  return [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((value) => Number(value).toFixed(3))
    .join(':');
}

function mergeCollections(payload) {
  return {
    type: 'FeatureCollection',
    features: [
      ...(payload?.pipelines?.features || []),
      ...(payload?.wells?.features || []),
    ],
  };
}

function propertyValue(entity, key) {
  const property = entity?.properties?.[key];
  if (!property) return null;
  return typeof property.getValue === 'function'
    ? property.getValue(Cesium.JulianDate.now())
    : property;
}

function styleEntities(dataSource) {
  for (const entity of dataSource.entities.values) {
    const kind = propertyValue(entity, 'kind');
    if (kind === 'pipeline' && entity.polyline) {
      entity.polyline.width = 2.25;
      entity.polyline.material = Cesium.Color.fromCssColorString('#d6d6d6').withAlpha(0.88);
      entity.polyline.clampToGround = true;
    }
    if (kind === 'well') {
      if (entity.billboard) {
        entity.billboard.scale = 0.62;
        entity.billboard.color = Cesium.Color.fromCssColorString('#f0f0f0').withAlpha(0.92);
      }
      if (entity.point) {
        entity.point.pixelSize = 7;
        entity.point.color = Cesium.Color.fromCssColorString('#f0f0f0').withAlpha(0.92);
        entity.point.outlineWidth = 1;
      }
    }
  }
}

export function createRrcEnergyLayer({ fetchFeatures = fetchRrcFeatures } = {}) {
  let viewer = null;
  let dataSource = null;
  let enabled = false;
  let loading = false;
  let status = 'idle';
  let wellCount = 0;
  let pipelineCount = 0;
  let lastUpdate = null;
  let lastError = null;
  let lastBoundsKey = '';
  let requestController = null;

  async function replaceSnapshot(payload) {
    const collection = mergeCollections(payload);
    const next = await Cesium.GeoJsonDataSource.load(collection, {
      clampToGround: true,
      stroke: Cesium.Color.fromCssColorString('#d6d6d6').withAlpha(0.82),
      strokeWidth: 2,
      markerColor: Cesium.Color.fromCssColorString('#f0f0f0').withAlpha(0.92),
      markerSize: 18,
    });
    next.name = 'BDP Texas RRC Energy';
    next.show = enabled;
    styleEntities(next);

    await viewer.dataSources.add(next);
    const previous = dataSource;
    dataSource = next;
    if (previous) viewer.dataSources.remove(previous, true);

    wellCount = payload.wells.features.length;
    pipelineCount = payload.pipelines.features.length;
  }

  return {
    id: 'bdp-rrc-energy',
    name: 'BDP · RRC Wells & Pipelines',
    icon: '⌁',
    source: 'Railroad Commission of Texas GIS',
    updateInterval: QUERY_INTERVAL_MS,

    init(targetViewer) {
      viewer = targetViewer;
      enabled = false;
      loading = false;
      status = 'idle';
      wellCount = 0;
      pipelineCount = 0;
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
      const rectangle = viewer?.camera?.computeViewRectangle(viewer.scene.globe.ellipsoid);
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
        const payload = await fetchFeatures(bounds, {
          countyFips: BEXAR_COUNTY_FIPS,
          signal: requestController.signal,
        });
        await replaceSnapshot(payload);
        lastBoundsKey = key;
        lastUpdate = Date.now();
        status = 'nominal';
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        lastError = error instanceof Error ? error.message : String(error);
        status = dataSource ? 'degraded' : 'unavailable';
        console.warn('[BDP:RRC Energy] refresh failed:', error);
        return false;
      } finally {
        loading = false;
      }
    },

    getStats() {
      return {
        count: wellCount + pipelineCount,
        wellCount,
        pipelineCount,
        loading,
        status,
        source: 'Railroad Commission of Texas GIS · screening',
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

export const rrcEnergyLayer = createRrcEnergyLayer();
export default rrcEnergyLayer;
