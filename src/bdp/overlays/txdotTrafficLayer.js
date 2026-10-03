import * as Cesium from 'cesium';
import { TXDOT_AADT_LAYER_URL } from '../transportation/txdotContract.js';

const QUERY_INTERVAL_MS = 5 * 60_000;
const MAX_VIEW_SPAN_DEGREES = 0.35;
const MAX_FEATURES = 2_000;

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

export function buildTxdotTrafficQueryUrl(bounds, { limit = MAX_FEATURES } = {}) {
  if (!bounds) throw new Error('bounds are required');
  const values = [bounds.west, bounds.south, bounds.east, bounds.north].map(Number);
  if (values.some((value) => !Number.isFinite(value))) throw new Error('finite WGS84 bounds are required');
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) throw new Error('invalid WGS84 bounds');

  const resultRecordCount = Math.max(1, Math.min(MAX_FEATURES, Math.floor(Number(limit) || MAX_FEATURES)));
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'RTE_NM,RTE_PRFX,RTE_NBR,RDBD_TYPE,AADT_CUR,SYSTEM,EXT_DATE',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(resultRecordCount),
    f: 'geojson',
  });
  return `${TXDOT_AADT_LAYER_URL}/query?${params.toString()}`;
}

export function trafficStyleForAadt(value) {
  const aadt = Number(value);
  if (!Number.isFinite(aadt) || aadt < 0) {
    return Object.freeze({ width: 1.1, alpha: 0.25 });
  }
  if (aadt >= 50_000) return Object.freeze({ width: 4.2, alpha: 0.95 });
  if (aadt >= 20_000) return Object.freeze({ width: 3.2, alpha: 0.82 });
  if (aadt >= 5_000) return Object.freeze({ width: 2.2, alpha: 0.68 });
  if (aadt >= 1_000) return Object.freeze({ width: 1.6, alpha: 0.52 });
  return Object.freeze({ width: 1.2, alpha: 0.36 });
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
    if (!entity.polyline) continue;
    const style = trafficStyleForAadt(propertyValue(entity, 'AADT_CUR'));
    entity.polyline.width = style.width;
    entity.polyline.material = Cesium.Color.fromCssColorString('#6fdcff').withAlpha(style.alpha);
    entity.polyline.clampToGround = true;
  }
}

export function createTxdotTrafficLayer({ fetchImpl = globalThis.fetch } = {}) {
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
      stroke: Cesium.Color.fromCssColorString('#6fdcff').withAlpha(0.55),
      strokeWidth: 1.5,
    });
    next.name = 'BDP TxDOT AADT Traffic';
    next.show = enabled;
    styleEntities(next);

    await viewer.dataSources.add(next);
    const previous = dataSource;
    dataSource = next;
    if (previous) viewer.dataSources.remove(previous, true);
    count = geojson.features.length;
  }

  return {
    id: 'bdp-txdot-traffic',
    name: 'BDP · TxDOT Traffic',
    icon: '⇄',
    source: 'TxDOT AADT',
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
        const response = await fetchImpl(buildTxdotTrafficQueryUrl(bounds), {
          headers: { accept: 'application/geo+json,application/json' },
          signal: requestController.signal,
        });
        if (!response.ok) throw new Error(`TxDOT AADT HTTP ${response.status}`);
        const geojson = await response.json();
        if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
          throw new Error('Malformed TxDOT AADT GeoJSON response');
        }
        if (geojson.features.length >= MAX_FEATURES) {
          throw new Error('TxDOT AADT viewport result is capped; zoom in for reliable display');
        }
        await replaceSnapshot(geojson);
        lastBoundsKey = key;
        lastUpdate = Date.now();
        status = 'nominal';
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        lastError = error instanceof Error ? error.message : String(error);
        status = dataSource ? 'degraded' : 'unavailable';
        console.warn('[BDP:TxDOTTraffic] refresh failed:', error);
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
        source: 'TxDOT AADT · roadway traffic volume',
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

export const txdotTrafficLayer = createTxdotTrafficLayer();
export default txdotTrafficLayer;
