import * as Cesium from 'cesium';
import {
  GROWTH_RADAR_MAX_FEATURES,
  SAN_ANTONIO_MTP_URL,
  SAN_ANTONIO_PRELIMINARY_PLAT_URL,
  SAN_ANTONIO_REGIONAL_CENTERS_URL,
} from '../growth/sanAntonioGrowthContract.js';

const QUERY_INTERVAL_MS = 30 * 60_000;
const MAX_VIEW_SPAN_DEGREES = 1.25;

export const GROWTH_MAP_SOURCES = Object.freeze({
  thoroughfares: Object.freeze({
    id: 'mtp',
    url: SAN_ANTONIO_MTP_URL,
    fields: 'StreetName,CurrentRow,PropRow,ChangeCode,Type,Ordinance',
  }),
  preliminaryPlats: Object.freeze({
    id: 'preliminary-plats',
    url: SAN_ANTONIO_PRELIMINARY_PLAT_URL,
    fields: 'PlatNumber,PlatName,created_date,last_edited_date',
  }),
  regionalCenters: Object.freeze({
    id: 'regional-centers',
    url: SAN_ANTONIO_REGIONAL_CENTERS_URL,
    fields: 'Name,Phase,PlanType,SubPlanID',
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

export function buildGrowthMapUrl(
  source,
  bounds,
  { limit = GROWTH_RADAR_MAX_FEATURES } = {},
) {
  if (!source?.url) throw new Error('growth map source is required');
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
    Math.min(GROWTH_RADAR_MAX_FEATURES, Math.floor(Number(limit) || GROWTH_RADAR_MAX_FEATURES)),
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

function styleMtp(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polyline) continue;
    entity.polyline.width = 2.5;
    entity.polyline.material = Cesium.Color.fromCssColorString('#7ee6ff').withAlpha(0.85);
    entity.polyline.clampToGround = true;
  }
}

function stylePlats(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    entity.polygon.material = Cesium.Color.fromCssColorString('#a8ffb8').withAlpha(0.045);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.fromCssColorString('#a8ffb8').withAlpha(0.55);
  }
}

function styleCenters(dataSource) {
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    entity.polygon.material = Cesium.Color.fromCssColorString('#f4c87d').withAlpha(0.025);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.fromCssColorString('#f4c87d').withAlpha(0.5);
  }
}

async function loadGeoJson(geojson, sourceId) {
  const dataSource = await Cesium.GeoJsonDataSource.load(geojson, {
    clampToGround: true,
    stroke: Cesium.Color.WHITE.withAlpha(0.4),
    strokeWidth: 1.2,
    fill: Cesium.Color.WHITE.withAlpha(0.02),
  });
  if (sourceId === 'mtp') styleMtp(dataSource);
  else if (sourceId === 'preliminary-plats') stylePlats(dataSource);
  else styleCenters(dataSource);
  return dataSource;
}

export function createSanAntonioGrowthLayer({ fetchImpl = globalThis.fetch } = {}) {
  let viewer = null;
  let enabled = false;
  let loading = false;
  let status = 'idle';
  let lastUpdate = null;
  let lastError = null;
  let lastBoundsKey = '';
  let requestController = null;
  const dataSources = new Map();
  const counts = { thoroughfares: 0, preliminaryPlats: 0, regionalCenters: 0 };

  async function replaceSource(key, source, geojson) {
    const next = await loadGeoJson(geojson, source.id);
    next.name = `BDP Growth Radar · ${source.id}`;
    next.show = enabled;
    await viewer.dataSources.add(next);
    const previous = dataSources.get(key);
    dataSources.set(key, next);
    if (previous) viewer.dataSources.remove(previous, true);
    counts[key] = geojson.features.length;
  }

  async function refreshOne(key, source, bounds, signal) {
    const response = await fetchImpl(buildGrowthMapUrl(source, bounds), {
      headers: { accept: 'application/geo+json,application/json' },
      signal,
    });
    if (!response.ok) throw new Error(`${source.id} HTTP ${response.status}`);
    const geojson = await response.json();
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error(`Malformed ${source.id} GeoJSON response`);
    }
    if (geojson.features.length >= GROWTH_RADAR_MAX_FEATURES) {
      throw new Error(`${source.id} viewport result is capped; zoom in for reliable display`);
    }
    await replaceSource(key, source, geojson);
  }

  return {
    id: 'bdp-san-antonio-growth',
    name: 'BDP · San Antonio Growth Radar',
    icon: '⌁',
    source: 'City of San Antonio MTP / Preliminary Plats / Regional Centers',
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
        const entries = Object.entries(GROWTH_MAP_SOURCES);
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
        console.warn('[BDP:GrowthRadarLayer] refresh failed:', error);
        return false;
      } finally {
        loading = false;
      }
    },

    getStats() {
      return {
        count: counts.thoroughfares + counts.preliminaryPlats + counts.regionalCenters,
        counts: { ...counts },
        loading,
        status,
        source: 'City of San Antonio Growth Radar screening',
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

export const sanAntonioGrowthLayer = createSanAntonioGrowthLayer();
export default sanAntonioGrowthLayer;
