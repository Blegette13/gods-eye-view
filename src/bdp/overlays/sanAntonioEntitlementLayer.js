import * as Cesium from 'cesium';
import {
  ENTITLEMENT_MAX_SOURCE_FEATURES,
  SAN_ANTONIO_ETJ_URL,
  SAN_ANTONIO_FUTURE_LAND_USE_URL,
  SAN_ANTONIO_ZONING_URL,
} from '../entitlement/sanAntonioContract.js';

const QUERY_INTERVAL_MS = 30 * 60_000;
const MAX_VIEW_SPAN_DEGREES = 1.25;

export const SAN_ANTONIO_ENTITLEMENT_MAP_SOURCES = Object.freeze({
  zoning: Object.freeze({
    id: 'zoning',
    url: SAN_ANTONIO_ZONING_URL,
    fields: 'Base,Zoning,SpecDistrict,SpecCondition,ZoningDetail',
  }),
  etj: Object.freeze({
    id: 'etj',
    url: SAN_ANTONIO_ETJ_URL,
    fields: 'Name',
  }),
  futureLandUse: Object.freeze({
    id: 'future-land-use',
    url: SAN_ANTONIO_FUTURE_LAND_USE_URL,
    fields: 'PlanName,LandUse,CenterTiers',
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
    .map((value) => Number(value).toFixed(2))
    .join(':');
}

function isCloseEnough(bounds) {
  if (!bounds) return false;
  return (
    bounds.east - bounds.west <= MAX_VIEW_SPAN_DEGREES
    && bounds.north - bounds.south <= MAX_VIEW_SPAN_DEGREES
  );
}

export function buildSanAntonioEntitlementMapUrl(
  source,
  bounds,
  { limit = ENTITLEMENT_MAX_SOURCE_FEATURES } = {},
) {
  if (!source?.url) throw new Error('entitlement map source is required');
  if (!bounds) throw new Error('bounds are required');
  const values = [bounds.west, bounds.south, bounds.east, bounds.north].map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('finite WGS84 bounds are required');
  }
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new Error('invalid WGS84 bounds');
  }

  const resultRecordCount = Math.max(
    1,
    Math.min(
      ENTITLEMENT_MAX_SOURCE_FEATURES,
      Math.floor(Number(limit) || ENTITLEMENT_MAX_SOURCE_FEATURES),
    ),
  );
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: source.fields,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(resultRecordCount),
    f: 'geojson',
  });
  return `${source.url}/query?${params.toString()}`;
}

function styleZoning(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    entity.polygon.material = Cesium.Color.fromCssColorString('#6fdcff').withAlpha(0.05);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.fromCssColorString('#6fdcff').withAlpha(0.55);
  }
}

function styleEtj(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    entity.polygon.material = Cesium.Color.fromCssColorString('#ffd27a').withAlpha(0.025);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.fromCssColorString('#ffd27a').withAlpha(0.7);
  }
}

function styleFutureLandUse(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    entity.polygon.material = Cesium.Color.fromCssColorString('#c49cff').withAlpha(0.035);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.fromCssColorString('#c49cff').withAlpha(0.5);
  }
}

async function loadGeoJson(geojson, sourceId) {
  const dataSource = await Cesium.GeoJsonDataSource.load(geojson, {
    clampToGround: true,
    stroke: Cesium.Color.WHITE.withAlpha(0.45),
    strokeWidth: 1.2,
    fill: Cesium.Color.WHITE.withAlpha(0.02),
  });
  if (sourceId === 'zoning') styleZoning(dataSource);
  else if (sourceId === 'etj') styleEtj(dataSource);
  else styleFutureLandUse(dataSource);
  return dataSource;
}

export function createSanAntonioEntitlementLayer({
  fetchImpl = globalThis.fetch,
} = {}) {
  let viewer = null;
  let enabled = false;
  let loading = false;
  let status = 'idle';
  let lastUpdate = null;
  let lastError = null;
  let lastBoundsKey = '';
  let requestController = null;
  const dataSources = new Map();
  const counts = { zoning: 0, etj: 0, futureLandUse: 0 };

  async function replaceSource(key, source, geojson) {
    const next = await loadGeoJson(geojson, source.id);
    next.name = `BDP San Antonio Entitlement · ${source.id}`;
    next.show = enabled;
    await viewer.dataSources.add(next);
    const previous = dataSources.get(key);
    dataSources.set(key, next);
    if (previous) viewer.dataSources.remove(previous, true);
    counts[key] = geojson.features.length;
  }

  async function refreshOne(key, source, bounds, signal) {
    const response = await fetchImpl(buildSanAntonioEntitlementMapUrl(source, bounds), {
      headers: { accept: 'application/geo+json,application/json' },
      signal,
    });
    if (!response.ok) throw new Error(`${source.id} HTTP ${response.status}`);
    const geojson = await response.json();
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error(`Malformed ${source.id} GeoJSON response`);
    }
    if (geojson.features.length >= ENTITLEMENT_MAX_SOURCE_FEATURES) {
      throw new Error(`${source.id} viewport result is capped; zoom in for reliable display`);
    }
    await replaceSource(key, source, geojson);
  }

  return {
    id: 'bdp-san-antonio-entitlement',
    name: 'BDP · San Antonio Entitlement',
    icon: '▦',
    source: 'City of San Antonio zoning / ETJ / Future Land Use GIS',
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
        const entries = Object.entries(SAN_ANTONIO_ENTITLEMENT_MAP_SOURCES);
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

        lastBoundsKey = key;
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
        console.warn('[BDP:SanAntonioEntitlementLayer] refresh failed:', error);
        return false;
      } finally {
        loading = false;
      }
    },

    getStats() {
      return {
        count: counts.zoning + counts.etj + counts.futureLandUse,
        counts: { ...counts },
        loading,
        status,
        source: 'City of San Antonio zoning / ETJ / Future Land Use GIS',
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

export const sanAntonioEntitlementLayer = createSanAntonioEntitlementLayer();
export default sanAntonioEntitlementLayer;
