import * as Cesium from 'cesium';

export const EPA_CLEANUP_LAYER_URL =
  'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Cleanups_in_my_Community_Sites/FeatureServer/0';
export const EPA_CLEANUP_QUERY_URL = `${EPA_CLEANUP_LAYER_URL}/query`;

const QUERY_INTERVAL_MS = 15 * 60_000;
const MAX_VIEW_SPAN_DEGREES = 1.25;
const MAX_FEATURES = 2_000;
const OUT_FIELDS = [
  'OBJECTID',
  'REGISTRY_ID',
  'PRIMARY_NAME',
  'LOCATION_ADDRESS',
  'CITY_NAME',
  'STATE_CODE',
  'COUNTY_NAME',
  'MAP_SYMBOL_CODE',
  'URL',
  'EPA_ID',
  'SF_SITE_NAME',
  'SF_NPL_CODE_F',
  'SF_NPL_CODE_D',
  'SF_NON_NPL_STATUS',
  'RCRA_HANDLER_NAME',
  'RCRA_GPRA_CA',
  'BF_PROPERTY_NAME',
  'EPAOSC_SITE_ID',
  'EPAOSC_STATUS',
  'EPAOSC_INCI_CATEG',
  'LUST_ID',
  'UST_STATUS',
  'DATA_REFRESH_DT',
  'GIS_REFRESH_DT',
].join(',');

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

function present(value) {
  return String(value ?? '').trim().length > 0;
}

export function classifyEpaCleanupFeature(feature) {
  const properties = feature?.properties || {};
  const programs = [];
  if (present(properties.SF_SITE_NAME)) programs.push('superfund');
  if (present(properties.RCRA_HANDLER_NAME) || present(properties.RCRA_GPRA_CA)) programs.push('rcra');
  if (present(properties.BF_PROPERTY_NAME)) programs.push('brownfields');
  if (present(properties.EPAOSC_SITE_ID) || present(properties.EPAOSC_STATUS)) programs.push('response');
  if (present(properties.LUST_ID) || present(properties.UST_STATUS)) programs.push('storage-tank');
  if (!programs.length) programs.push('cleanup');
  return Object.freeze(programs);
}

function markerStyle(programs) {
  if (programs.includes('superfund')) {
    return { color: '#ff7184', outline: '#ffd4da', size: 9 };
  }
  if (programs.includes('rcra')) {
    return { color: '#ff9f68', outline: '#ffe0c7', size: 8 };
  }
  if (programs.includes('brownfields')) {
    return { color: '#ffdc78', outline: '#fff0ba', size: 7 };
  }
  if (programs.includes('response')) {
    return { color: '#d98cff', outline: '#f2d3ff', size: 8 };
  }
  return { color: '#a7bcc5', outline: '#e1e8eb', size: 6 };
}

export function buildEpaCleanupQueryUrl(bounds, { limit = MAX_FEATURES } = {}) {
  if (!bounds) throw new Error('bounds are required');
  const values = [bounds.west, bounds.south, bounds.east, bounds.north].map(Number);
  if (values.some((value) => !Number.isFinite(value))) throw new Error('finite WGS84 bounds are required');
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) throw new Error('invalid WGS84 bounds');

  const resultRecordCount = Math.max(1, Math.min(MAX_FEATURES, Math.floor(Number(limit) || MAX_FEATURES)));
  const params = new URLSearchParams({
    where: "STATE_CODE='TX'",
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(resultRecordCount),
    f: 'geojson',
  });
  return `${EPA_CLEANUP_QUERY_URL}?${params.toString()}`;
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
    if (!entity.position) continue;
    const programs = classifyEpaCleanupFeature({
      properties: {
        SF_SITE_NAME: propertyValue(entity, 'SF_SITE_NAME'),
        RCRA_HANDLER_NAME: propertyValue(entity, 'RCRA_HANDLER_NAME'),
        RCRA_GPRA_CA: propertyValue(entity, 'RCRA_GPRA_CA'),
        BF_PROPERTY_NAME: propertyValue(entity, 'BF_PROPERTY_NAME'),
        EPAOSC_SITE_ID: propertyValue(entity, 'EPAOSC_SITE_ID'),
        EPAOSC_STATUS: propertyValue(entity, 'EPAOSC_STATUS'),
        LUST_ID: propertyValue(entity, 'LUST_ID'),
        UST_STATUS: propertyValue(entity, 'UST_STATUS'),
      },
    });
    const style = markerStyle(programs);
    entity.point = new Cesium.PointGraphics({
      color: Cesium.Color.fromCssColorString(style.color).withAlpha(0.9),
      outlineColor: Cesium.Color.fromCssColorString(style.outline).withAlpha(0.95),
      outlineWidth: 1,
      pixelSize: style.size,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: 30_000,
    });
  }
}

export function createEpaCleanupLayer({ fetchImpl = globalThis.fetch } = {}) {
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
      markerColor: Cesium.Color.fromCssColorString('#ff9f68').withAlpha(0.9),
      markerSize: 8,
    });
    next.name = 'BDP EPA Cleanup Sites';
    next.show = enabled;
    styleEntities(next);

    await viewer.dataSources.add(next);
    const previous = dataSource;
    dataSource = next;
    if (previous) viewer.dataSources.remove(previous, true);
    count = geojson.features.length;
  }

  return {
    id: 'bdp-epa-cleanups',
    name: 'BDP · EPA Cleanup Sites',
    icon: '⚠',
    source: 'US EPA · Cleanups in My Community',
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
        const response = await fetchImpl(buildEpaCleanupQueryUrl(bounds), {
          signal: requestController.signal,
        });
        if (!response.ok) throw new Error(`EPA cleanup service HTTP ${response.status}`);
        const geojson = await response.json();
        if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
          throw new Error('Malformed EPA cleanup GeoJSON response');
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
        console.warn('[BDP:EPACleanups] refresh failed:', error);
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
        source: 'US EPA Cleanups in My Community',
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

export const epaCleanupLayer = createEpaCleanupLayer();
export default epaCleanupLayer;
