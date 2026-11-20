import * as Cesium from 'cesium';

export const FEMA_NFHL_FLOOD_HAZARD_URL =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

const QUERY_INTERVAL_MS = 5 * 60_000;
const MAX_VIEW_SPAN_DEGREES = 0.3;
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
    bounds.east - bounds.west <= MAX_VIEW_SPAN_DEGREES &&
    bounds.north - bounds.south <= MAX_VIEW_SPAN_DEGREES
  );
}

export function buildFemaFloodQueryUrl(bounds, { limit = MAX_FEATURES } = {}) {
  if (!bounds) throw new Error('bounds are required');
  const resultRecordCount = Math.max(1, Math.min(MAX_FEATURES, Math.floor(Number(limit) || MAX_FEATURES)));
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,VELOCITY',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(resultRecordCount),
    f: 'geojson',
  });
  return `${FEMA_NFHL_FLOOD_HAZARD_URL}?${params.toString()}`;
}

export function classifyFloodFeature(feature) {
  const properties = feature?.properties || {};
  const zone = String(properties.FLD_ZONE || '').trim().toUpperCase();
  const subtype = String(properties.ZONE_SUBTY || '').trim().toUpperCase();
  const sfha = String(properties.SFHA_TF || '').trim().toUpperCase() === 'T';
  const isFloodway = subtype.includes('FLOODWAY');
  const isModerate = zone === 'X' && subtype.includes('0.2 PCT');

  if (isFloodway) return 'floodway';
  if (sfha) return 'sfha';
  if (isModerate) return 'moderate';
  return 'other';
}

function featureStyle(kind) {
  switch (kind) {
    case 'floodway':
      return {
        fill: Cesium.Color.fromCssColorString('#5c7f91').withAlpha(0.34),
        outline: Cesium.Color.fromCssColorString('#c8d8df').withAlpha(0.9),
      };
    case 'sfha':
      return {
        fill: Cesium.Color.fromCssColorString('#7897a6').withAlpha(0.26),
        outline: Cesium.Color.fromCssColorString('#d3e0e5').withAlpha(0.74),
      };
    case 'moderate':
      return {
        fill: Cesium.Color.fromCssColorString('#a7b7be').withAlpha(0.15),
        outline: Cesium.Color.fromCssColorString('#d6dde0').withAlpha(0.5),
      };
    default:
      return {
        fill: Cesium.Color.fromCssColorString('#c1c7ca').withAlpha(0.07),
        outline: Cesium.Color.fromCssColorString('#e1e4e5').withAlpha(0.25),
      };
  }
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
    if (!entity.polygon) continue;
    const feature = {
      properties: {
        FLD_ZONE: propertyValue(entity, 'FLD_ZONE'),
        ZONE_SUBTY: propertyValue(entity, 'ZONE_SUBTY'),
        SFHA_TF: propertyValue(entity, 'SFHA_TF'),
      },
    };
    const kind = classifyFloodFeature(feature);
    const style = featureStyle(kind);
    entity.polygon.material = style.fill;
    entity.polygon.outline = true;
    entity.polygon.outlineColor = style.outline;
    entity.polygon.classificationType = Cesium.ClassificationType.BOTH;
  }
}

export function createFemaFloodLayer({ fetchImpl = globalThis.fetch } = {}) {
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
      stroke: Cesium.Color.fromCssColorString('#dce3e6').withAlpha(0.5),
      fill: Cesium.Color.fromCssColorString('#91a7b2').withAlpha(0.18),
      strokeWidth: 1,
    });
    next.name = 'BDP FEMA Flood Hazard';
    next.show = enabled;
    styleEntities(next);

    await viewer.dataSources.add(next);
    const previous = dataSource;
    dataSource = next;
    if (previous) viewer.dataSources.remove(previous, true);
    count = geojson.features.length;
  }

  return {
    id: 'bdp-fema-flood',
    name: 'BDP · FEMA Flood Hazard',
    icon: '≋',
    source: 'FEMA NFHL · S_FLD_HAZ_AR',
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
        const response = await fetchImpl(buildFemaFloodQueryUrl(bounds), {
          signal: requestController.signal,
        });
        if (!response.ok) throw new Error(`FEMA NFHL HTTP ${response.status}`);
        const geojson = await response.json();
        if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
          throw new Error('Malformed FEMA NFHL GeoJSON response');
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
        console.warn('[BDP:FEMAFlood] refresh failed:', error);
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
        source: 'FEMA National Flood Hazard Layer',
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

export const femaFloodLayer = createFemaFloodLayer();
export default femaFloodLayer;
