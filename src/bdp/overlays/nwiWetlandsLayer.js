import * as Cesium from 'cesium';

export const NWI_WETLANDS_LAYER_URL =
  'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query';

const QUERY_INTERVAL_MS = 10 * 60_000;
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

export function buildNwiWetlandsQueryUrl(bounds, { limit = MAX_FEATURES } = {}) {
  if (!bounds) throw new Error('bounds are required');
  const values = [bounds.west, bounds.south, bounds.east, bounds.north].map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Finite WGS84 bounds are required');
  }
  if (values[0] >= values[2] || values[1] >= values[3]) {
    throw new Error('Invalid WGS84 bounds');
  }

  const resultRecordCount = Math.max(
    1,
    Math.min(MAX_FEATURES, Math.floor(Number(limit) || MAX_FEATURES)),
  );
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${values[0]},${values[1]},${values[2]},${values[3]}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'ATTRIBUTE,WETLAND_TYPE,ACRES',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(resultRecordCount),
    f: 'geojson',
  });
  return `${NWI_WETLANDS_LAYER_URL}?${params.toString()}`;
}

export function classifyWetlandFeature(feature) {
  const properties = feature?.properties || {};
  const label = String(
    properties.WETLAND_TYPE || properties.WETLAND_TY || properties.wetland_type || '',
  ).trim().toLowerCase();
  const code = String(properties.ATTRIBUTE || properties.attribute || '')
    .trim()
    .toUpperCase();

  if (label.includes('estuarine') || label.includes('marine') || code.startsWith('E') || code.startsWith('M')) {
    return 'coastal';
  }
  if (label.includes('riverine') || code.startsWith('R')) return 'riverine';
  if (label.includes('lake') || code.startsWith('L')) return 'lake';
  if (label.includes('pond') || code.startsWith('PUB')) return 'pond';
  if (label.includes('forested') || label.includes('shrub') || code.includes('FO') || code.includes('SS')) {
    return 'forested';
  }
  if (label.includes('emergent') || code.includes('EM')) return 'emergent';
  return 'other';
}

function styleFor(kind) {
  switch (kind) {
    case 'coastal':
      return { fill: '#6e8991', outline: '#d7e2e5', alpha: 0.34 };
    case 'riverine':
      return { fill: '#78929a', outline: '#dce5e7', alpha: 0.30 };
    case 'lake':
      return { fill: '#81979e', outline: '#dce4e6', alpha: 0.27 };
    case 'pond':
      return { fill: '#8e9fa4', outline: '#dce2e3', alpha: 0.25 };
    case 'forested':
      return { fill: '#7f8b83', outline: '#d9ddd9', alpha: 0.24 };
    case 'emergent':
      return { fill: '#91968a', outline: '#dedfd9', alpha: 0.23 };
    default:
      return { fill: '#a7abad', outline: '#e1e2e3', alpha: 0.14 };
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
        ATTRIBUTE: propertyValue(entity, 'ATTRIBUTE'),
        WETLAND_TYPE:
          propertyValue(entity, 'WETLAND_TYPE') || propertyValue(entity, 'WETLAND_TY'),
      },
    };
    const style = styleFor(classifyWetlandFeature(feature));
    entity.polygon.material = Cesium.Color.fromCssColorString(style.fill).withAlpha(style.alpha);
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.fromCssColorString(style.outline).withAlpha(0.72);
    entity.polygon.classificationType = Cesium.ClassificationType.BOTH;
  }
}

export function createNwiWetlandsLayer({ fetchImpl = globalThis.fetch } = {}) {
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
      stroke: Cesium.Color.fromCssColorString('#dce2e3').withAlpha(0.55),
      fill: Cesium.Color.fromCssColorString('#929b9e').withAlpha(0.2),
      strokeWidth: 1,
    });
    next.name = 'BDP USFWS NWI Wetlands';
    next.show = enabled;
    styleEntities(next);

    await viewer.dataSources.add(next);
    const previous = dataSource;
    dataSource = next;
    if (previous) viewer.dataSources.remove(previous, true);
    count = geojson.features.length;
  }

  return {
    id: 'bdp-nwi-wetlands',
    name: 'BDP · NWI Wetlands',
    icon: '≈',
    source: 'USFWS National Wetlands Inventory',
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
        const response = await fetchImpl(buildNwiWetlandsQueryUrl(bounds), {
          signal: requestController.signal,
        });
        if (!response.ok) throw new Error(`USFWS NWI HTTP ${response.status}`);
        const geojson = await response.json();
        if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
          throw new Error('Malformed USFWS NWI GeoJSON response');
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
        console.warn('[BDP:NWI] refresh failed:', error);
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
        source: 'USFWS National Wetlands Inventory',
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

export const nwiWetlandsLayer = createNwiWetlandsLayer();
export default nwiWetlandsLayer;
