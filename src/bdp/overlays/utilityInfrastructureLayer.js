import * as Cesium from 'cesium';
import {
  PUCT_WATER_CCN_URL,
  TWDB_WATER_SERVICE_AREAS_URL,
  US_GOV_TRANSMISSION_ARCHIVE_URL,
} from '../utilities/utilityContract.js';

const QUERY_INTERVAL_MS = 30 * 60_000;
const MAX_VIEW_SPAN_DEGREES = 0.35;
const MAX_FEATURES = 2_000;

export const UTILITY_MAP_SOURCES = Object.freeze({
  waterService: Object.freeze({
    id: 'water-service',
    url: TWDB_WATER_SERVICE_AREAS_URL,
    fields: 'PWSName,PWSId,Active,LUpDateTime',
  }),
  waterCcn: Object.freeze({
    id: 'water-ccn-archive',
    url: PUCT_WATER_CCN_URL,
    fields: 'CCN_NO,UTILITY,STATUS,CCN_TYPE',
  }),
  currentWaterCcn: Object.freeze({
    id: 'water-ccn',
    url: '/api/bdp/utilities/water-ccn-map',
  }),
  sewerCcn: Object.freeze({
    id: 'sewer-ccn',
    url: '/api/bdp/utilities/sewer-ccn-map',
  }),
  transmission: Object.freeze({
    id: 'transmission',
    url: US_GOV_TRANSMISSION_ARCHIVE_URL,
    fields: '*',
  }),
});

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
    bounds.east - bounds.west <= MAX_VIEW_SPAN_DEGREES
    && bounds.north - bounds.south <= MAX_VIEW_SPAN_DEGREES
  );
}

export function buildUtilityMapQueryUrl(source, bounds, { limit = MAX_FEATURES } = {}) {
  if (!source?.url) throw new Error('utility map source is required');
  if (!bounds) throw new Error('bounds are required');

  const values = [bounds.west, bounds.south, bounds.east, bounds.north].map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('finite WGS84 bounds are required');
  }
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new Error('invalid WGS84 bounds');
  }
  if (source.url.startsWith('/api/bdp/utilities/')) {
    const params = new URLSearchParams(Object.fromEntries(
      ['west', 'south', 'east', 'north'].map((key) => [key, String(bounds[key])]),
    ));
    return `${source.url}?${params}`;
  }

  const resultRecordCount = Math.max(
    1,
    Math.min(MAX_FEATURES, Math.floor(Number(limit) || MAX_FEATURES)),
  );
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: source.fields || '*',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(resultRecordCount),
    f: 'geojson',
  });
  return `${source.url}/query?${params.toString()}`;
}

function styleWaterService(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    entity.polygon.material = Cesium.Color.fromCssColorString('#6fdcff').withAlpha(0.08);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.fromCssColorString('#6fdcff').withAlpha(0.5);
  }
}

function styleWaterCcn(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    entity.polygon.material = Cesium.Color.WHITE.withAlpha(0.025);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.WHITE.withAlpha(0.42);
  }
}

function styleCurrentWaterCcn(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    entity.polygon.material = Cesium.Color.fromCssColorString('#f1d477').withAlpha(0.05);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.fromCssColorString('#f1d477').withAlpha(0.7);
  }
}

function styleSewerCcn(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    entity.polygon.material = Cesium.Color.fromCssColorString('#d590f8').withAlpha(0.05);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.fromCssColorString('#d590f8').withAlpha(0.7);
  }
}

function styleTransmission(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polyline) continue;
    entity.polyline.width = 2;
    entity.polyline.material = Cesium.Color.fromCssColorString('#d9f6ff').withAlpha(0.8);
    entity.polyline.clampToGround = true;
  }
}

async function loadGeoJson(geojson, sourceId) {
  const source = await Cesium.GeoJsonDataSource.load(geojson, {
    clampToGround: true,
    stroke: Cesium.Color.WHITE.withAlpha(0.45),
    strokeWidth: 1.5,
    fill: Cesium.Color.WHITE.withAlpha(0.02),
  });

  if (sourceId === 'water-service') styleWaterService(source);
  else if (sourceId === 'water-ccn-archive') styleWaterCcn(source);
  else if (sourceId === 'water-ccn') styleCurrentWaterCcn(source);
  else if (sourceId === 'sewer-ccn') styleSewerCcn(source);
  else if (sourceId === 'transmission') styleTransmission(source);

  return source;
}

export function createUtilityInfrastructureLayer({ fetchImpl = globalThis.fetch } = {}) {
  let viewer = null;
  let enabled = false;
  let loading = false;
  let status = 'idle';
  let lastUpdate = null;
  let lastError = null;
  let lastBoundsKey = '';
  let requestController = null;
  const dataSources = new Map();
  const counts = {
    waterService: 0,
    waterCcn: 0,
    currentWaterCcn: 0,
    sewerCcn: 0,
    transmission: 0,
  };

  async function replaceSource(key, source, geojson) {
    const next = await loadGeoJson(geojson, source.id);
    next.name = `BDP Utilities · ${source.id}`;
    next.show = enabled;
    await viewer.dataSources.add(next);

    const previous = dataSources.get(key);
    dataSources.set(key, next);
    if (previous) viewer.dataSources.remove(previous, true);
    counts[key] = geojson.features.length;
  }

  async function refreshOne(key, source, bounds, signal) {
    const response = await fetchImpl(buildUtilityMapQueryUrl(source, bounds), {
      headers: { accept: 'application/geo+json,application/json' },
      signal,
    });
    if (!response.ok) throw new Error(`${source.id} HTTP ${response.status}`);

    const geojson = await response.json();
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error(`Malformed ${source.id} GeoJSON response`);
    }
    if (geojson.features.length >= MAX_FEATURES) {
      throw new Error(`${source.id} viewport result is capped; zoom in for reliable display`);
    }
    if (geojson.truncated || (source.url.startsWith('/api/bdp/utilities/') && geojson.coverage !== 'mapped-snapshot')) {
      if (source.url.startsWith('/api/bdp/utilities/')) {
        await replaceSource(key, source, { type: 'FeatureCollection', features: [] });
      }
      throw new Error(`${source.id} viewport source is incomplete or not current`);
    }

    await replaceSource(key, source, geojson);
  }

  return {
    id: 'bdp-utilities-infrastructure',
    name: 'BDP · Utilities / Infrastructure',
    icon: '⚡',
    source: 'TWDB water service + PUCT water/sewer CCN snapshots + archived water CCN/transmission',
    updateInterval: QUERY_INTERVAL_MS,

    init(targetViewer) {
      viewer = targetViewer;
      enabled = false;
      loading = false;
      status = 'idle';
      lastUpdate = null;
      lastError = null;
      lastBoundsKey = '';
    },

    enable() {
      enabled = true;
      for (const source of dataSources.values()) source.show = true;
    },

    disable() {
      enabled = false;
      for (const source of dataSources.values()) source.show = false;
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
      if (key === lastBoundsKey && dataSources.size) {
        status = 'nominal';
        return true;
      }

      loading = true;
      status = 'loading';
      lastError = null;
      requestController?.abort();
      requestController = new AbortController();

      try {
        const entries = Object.entries(UTILITY_MAP_SOURCES);
        const settled = await Promise.allSettled(
          entries.map(([sourceKey, source]) => refreshOne(
            sourceKey,
            source,
            bounds,
            requestController.signal,
          )),
        );

        if (requestController.signal.aborted) return false;

        const failures = settled
          .map((result, index) => result.status === 'rejected'
            ? `${entries[index][0]}: ${result.reason?.message || result.reason}`
            : null)
          .filter(Boolean);

        lastBoundsKey = failures.length ? '' : key;
        lastUpdate = Date.now();
        lastError = failures.length ? failures.join(' | ') : null;
        status = failures.length
          ? (dataSources.size ? 'degraded' : 'unavailable')
          : 'nominal';
        return failures.length === 0;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        lastError = error instanceof Error ? error.message : String(error);
        status = dataSources.size ? 'degraded' : 'unavailable';
        console.warn('[BDP:UtilitiesLayer] refresh failed:', error);
        return false;
      } finally {
        loading = false;
      }
    },

    getStats() {
      return {
        count: counts.waterService + counts.waterCcn + counts.currentWaterCcn + counts.sewerCcn + counts.transmission,
        counts: { ...counts },
        loading,
        status,
        source: 'TWDB retail water service + current PUCT water/sewer CCN snapshots + archived TWDB water CCN/transmission',
        lastUpdate,
        lastError,
        error: lastError,
        available: status !== 'unavailable',
      };
    },

    destroy() {
      requestController?.abort();
      requestController = null;
      for (const source of dataSources.values()) {
        if (viewer) viewer.dataSources.remove(source, true);
      }
      dataSources.clear();
      viewer = null;
      enabled = false;
      loading = false;
    },
  };
}

export const utilityInfrastructureLayer = createUtilityInfrastructureLayer();
export default utilityInfrastructureLayer;
