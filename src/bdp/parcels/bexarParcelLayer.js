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

export function createCountyParcelLayer({
  adapter = bexarCadAdapter,
  propertyCardFactory = createBdpPropertyCard,
  id = 'bdp-bexar-parcels',
  name = 'BDP · Bexar Parcels',
  source = 'Bexar County ArcGIS REST · BCAD',
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
  function assertActive(signal) {
    if (signal?.aborted || !enabled || !viewer) throw new DOMException('Parcel request cancelled', 'AbortError');
  }

  async function replaceSnapshot(parcels, { signal } = {}) {
    assertActive(signal);
    const next = await Cesium.GeoJsonDataSource.load(featureCollection(parcels), {
      clampToGround: true,
      stroke: Cesium.Color.fromCssColorString('#f2f2f2').withAlpha(0.82),
      fill: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.055),
      strokeWidth: 1.5,
    });
    next.name = name;
    assertActive(signal);
    next.show = enabled;

    await viewer.dataSources.add(next);
    if (signal?.aborted || !enabled || !viewer) {
      viewer?.dataSources.remove(next, true);
      throw new DOMException('Parcel request cancelled', 'AbortError');
    }
    const previous = dataSource;
    dataSource = next;
    if (previous) viewer.dataSources.remove(previous, true);

    parcelById.clear();
    for (const parcel of parcels) parcelById.set(parcel.id, parcel);
    count = parcels.length;
  }

  async function focusSnapshot(parcels, { signal } = {}) {
    await replaceSnapshot(parcels, { signal });
    lastBoundsKey = '';
    lastUpdate = Date.now();
    status = parcels.length ? 'nominal' : 'empty';
    if (dataSource && parcels.length) {
      await viewer.flyTo(dataSource, { duration: 1.15 });
    }
    assertActive(signal);
  }

  async function focusParcel(parcelOrAccountId, { signal } = {}) {
    if (!viewer || !propertyCard) throw new Error(`${adapter.county} parcel layer is not initialized`);
    if (!enabled) throw new Error(`${adapter.county} parcel layer must be enabled before parcel lookup`);

    loading = true;
    status = 'loading';
    lastError = null;
    try {
      const parcel = await adapter.fetchParcel(parcelOrAccountId, { signal });
      assertActive(signal);
      if (!parcel) {
        status = dataSource ? 'nominal' : 'empty';
        return null;
      }

      await focusSnapshot([parcel], { signal });
      propertyCard.show(parcel);
      return parcel;
    } catch (error) {
      if (error?.name === 'AbortError') {
        status = enabled ? (dataSource ? 'nominal' : 'empty') : 'idle';
        throw error;
      }
      lastError = error instanceof Error ? error.message : String(error);
      status = dataSource ? 'degraded' : 'unavailable';
      throw error;
    } finally {
      loading = false;
    }
  }

  async function focusOwner(ownerName, { signal, limit = 100 } = {}) {
    if (!viewer || !propertyCard) throw new Error(`${adapter.county} parcel layer is not initialized`);
    if (!enabled) throw new Error(`${adapter.county} parcel layer must be enabled before owner lookup`);

    loading = true;
    status = 'loading';
    lastError = null;
    try {
      const parcels = await adapter.fetchParcelsByOwner(ownerName, { signal, limit });
      assertActive(signal);
      if (!parcels.length) {
        propertyCard.hide();
        status = dataSource ? 'nominal' : 'empty';
        return [];
      }
      await focusSnapshot(parcels, { signal });
      propertyCard.hide();
      return parcels;
    } catch (error) {
      if (error?.name === 'AbortError') {
        status = enabled ? (dataSource ? 'nominal' : 'empty') : 'idle';
        throw error;
      }
      lastError = error instanceof Error ? error.message : String(error);
      status = dataSource ? 'degraded' : 'unavailable';
      throw error;
    } finally {
      loading = false;
    }
  }

  const layer = {
    id,
    name,
    icon: '▦',
    source,
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

    focusParcel,
    focusOwner,
    hideCard() {
      propertyCard?.hide();
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
          limit: adapter.county === 'Bexar' ? 1000 : 500,
          signal: requestController.signal,
        });
        await replaceSnapshot(parcels, { signal: requestController.signal });
        lastBoundsKey = key;
        lastUpdate = Date.now();
        status = 'nominal';
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        lastError = error instanceof Error ? error.message : String(error);
        status = dataSource ? 'degraded' : 'unavailable';
        console.warn(`[BDP:${adapter.county}Parcels] refresh failed:`, error);
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
        source,
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

export const createBexarParcelLayer = createCountyParcelLayer;
export const bexarParcelLayer = createCountyParcelLayer();
export default bexarParcelLayer;
