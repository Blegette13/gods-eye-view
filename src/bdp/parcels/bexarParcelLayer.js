import * as Cesium from 'cesium';
import bexarCadAdapter from '../cad/bexarAdapter.js';
import { createBdpPropertyCard } from '../ui/propertyCard.js';

const MAX_VIEW_SPAN_DEGREES = 0.12;
const QUERY_INTERVAL_MS = 30_000;

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
    .map((value) => Number(value).toFixed(4))
    .join(':');
}

function isCloseEnough(bounds) {
  if (!bounds) return false;
  return (bounds.east - bounds.west) <= MAX_VIEW_SPAN_DEGREES
    && (bounds.north - bounds.south) <= MAX_VIEW_SPAN_DEGREES;
}

function parcelFeature(parcel) {
  return {
    type: 'Feature',
    id: parcel.id,
    geometry: parcel.property.geometry,
    properties: {
      bdpParcelId: parcel.id,
      parcelId: parcel.parcelId,
      owner: parcel.owner?.name || '',
      acres: parcel.property?.acres,
      county: parcel.county,
    },
  };
}

function featureCollection(parcels) {
  return {
    type: 'FeatureCollection',
    features: parcels
      .filter((parcel) => parcel.property?.geometry)
      .map(parcelFeature),
  };
}

function propertyValue(entity, key) {
  const property = entity?.properties?.[key];
  if (!property) return null;
  return typeof property.getValue === 'function'
    ? property.getValue(Cesium.JulianDate.now())
    : property;
}

export function createBexarParcelLayer({
  adapter = bexarCadAdapter,
  propertyCardFactory = createBdpPropertyCard,
} = {}) {
  let viewer = null;
  let dataSource = null;
  let clickHandler = null;
  let propertyCard = null;
  let enabled = false;
  let loading = false;
  let status = 'idle';
  let count = 0;
  let lastUpdate = null;
  let lastError = null;
  let lastBoundsKey = '';
  let requestController = null;
  const parcelById = new Map();

  async function replaceSnapshot(parcels) {
    const next = await Cesium.GeoJsonDataSource.load(featureCollection(parcels), {
      clampToGround: true,
      stroke: Cesium.Color.fromCssColorString('#f2f2f2').withAlpha(0.82),
      fill: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.055),
      strokeWidth: 1.5,
    });
    next.name = 'BDP Bexar Parcels';
    next.show = enabled;

    await viewer.dataSources.add(next);
    const previous = dataSource;
    dataSource = next;
    if (previous) viewer.dataSources.remove(previous, true);

    parcelById.clear();
    for (const parcel of parcels) parcelById.set(parcel.id, parcel);
    count = parcels.length;
  }

  const layer = {
    id: 'bdp-bexar-parcels',
    name: 'BDP · Bexar Parcels',
    icon: '▦',
    source: 'Bexar County / BCAD',
    updateInterval: QUERY_INTERVAL_MS,

    init(targetViewer) {
      viewer = targetViewer;
      propertyCard = propertyCardFactory();
      clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      clickHandler.setInputAction((movement) => {
        if (!enabled) return;
        const picked = viewer.scene.pick(movement.position);
        const entity = picked?.id;
        const id = propertyValue(entity, 'bdpParcelId') || entity?.id;
        const parcel = parcelById.get(String(id));
        if (parcel) propertyCard.show(parcel);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
    },

    disable() {
      enabled = false;
      if (dataSource) dataSource.show = false;
      propertyCard?.hide();
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
        const parcels = await adapter.fetchParcelsInBounds(bounds, {
          limit: 1000,
          signal: requestController.signal,
        });
        await replaceSnapshot(parcels);
        lastBoundsKey = key;
        lastUpdate = Date.now();
        status = 'nominal';
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        lastError = error instanceof Error ? error.message : String(error);
        status = dataSource ? 'degraded' : 'unavailable';
        console.warn('[BDP:BexarParcels] refresh failed:', error);
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
        source: 'Bexar County ArcGIS REST · BCAD',
        lastUpdate,
        lastError,
        error: lastError,
        available: status !== 'unavailable',
      };
    },

    destroy() {
      requestController?.abort();
      requestController = null;
      clickHandler?.destroy();
      clickHandler = null;
      propertyCard?.destroy();
      propertyCard = null;
      if (dataSource && viewer) viewer.dataSources.remove(dataSource, true);
      dataSource = null;
      parcelById.clear();
      viewer = null;
      enabled = false;
    },
  };

  return layer;
}

export const bexarParcelLayer = createBexarParcelLayer();
export default bexarParcelLayer;
