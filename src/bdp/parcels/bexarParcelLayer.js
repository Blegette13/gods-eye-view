import * as Cesium from 'cesium';
import bexarCadAdapter from '../cad/bexarAdapter.js';
import { createBdpPropertyCard } from '../ui/propertyCard.js';
import { parcelGeoJsonWithBoundaries } from './parcelGeojson.js';
import { styleSelectedParcelEntities, recommendedParcelFocusRange } from './parcelSelectionStyle.js';
import { shouldDiscoverFreeParcels } from '../map/freeBrowseParcels.js';

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
  let viewportCoverageWarning = '';
  let lastBoundsKey = '';
  let requestController = null;
  let selectedParcelId = null;
  let focusedLookupToken = null;
  const parcelById = new Map();
  const normalOutline = Cesium.Color.fromCssColorString('#f2f2f2').withAlpha(0.82);
  const selectedOutline = Cesium.Color.fromCssColorString('#42c5ed').withAlpha(0.98);
  const normalFill = Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.055);
  const selectedFill = Cesium.Color.fromCssColorString('#2289bd').withAlpha(0.24);

  function refreshParcelSelection() {
    if (!dataSource) return;
    styleSelectedParcelEntities(dataSource.entities.values, selectedParcelId, {
      parcelIdForEntity: (entity) => propertyValue(entity, 'bdpParcelId'),
      defaultOutline: normalOutline,
      defaultFill: normalFill,
      selectedOutline,
      selectedFill,
    });
    // A card-only click changes entity materials without camera movement.
    // Explicitly request a frame so stale selected outlines cannot linger in
    // Cesium scenes configured for request-on-demand rendering.
    viewer?.scene?.requestRender?.();
  }

  function showSelectedParcel(parcel) {
    selectedParcelId = parcel?.id || null;
    refreshParcelSelection();
    if (parcel) propertyCard?.show(parcel);
    else propertyCard?.hide();
  }
  function assertActive(signal) {
    if (signal?.aborted || !enabled || !viewer) throw new DOMException('Parcel request cancelled', 'AbortError');
  }

  function notifyViewportCandidates(parcels, complete = false, reason = 'not-complete') {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent('land:parcel-viewport', {
      detail: {
        county: adapter.county,
        complete,
        reason,
        // Only successful bounded source snapshots contribute actual parcels.
        parcels: complete || reason === 'partial' ? parcels : [],
      },
    }));
  }

  async function replaceSnapshot(parcels, { signal, sourceKind = 'viewport', completeView = true } = {}) {
    assertActive(signal);
    const next = await Cesium.GeoJsonDataSource.load(parcelGeoJsonWithBoundaries(parcels), {
      clampToGround: true,
      stroke: normalOutline,
      fill: normalFill,
      strokeWidth: 2,
    });
    // Terrain-clamped polygon outlines are unsupported in Cesium; separate
    // GeoJSON LineStrings provide visible, pickable ground-clamped borders.
    for (const entity of next.entities.values) {
      if (entity.polygon) entity.polygon.outline = false;
    }
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
    refreshParcelSelection();
    if (sourceKind === 'viewport') notifyViewportCandidates(parcels, completeView,
      completeView ? 'complete' : 'partial');
    else notifyViewportCandidates([], false, 'focused-search');
  }

  async function focusSnapshot(parcels, { signal, selectedParcel = null, cameraRangeMultiplier = 1 } = {}) {
    selectedParcelId = selectedParcel?.id || null;
    await replaceSnapshot(parcels, { signal, sourceKind: 'focused' });
    lastBoundsKey = '';
    lastUpdate = Date.now();
    viewportCoverageWarning = '';
    status = parcels.length ? 'nominal' : 'empty';
    if (dataSource && parcels.length) {
      const focusRange = selectedParcel
        ? recommendedParcelFocusRange(selectedParcel.property?.geometry)
        : null;
      // An explicit parcel lookup frames the actual GIS polygon rather than
      // remaining at a regional-scale camera altitude. A multi-result owner
      // search still fits the full datasource as before.
      const offset = focusRange === null
        ? undefined
        : new Cesium.HeadingPitchRange(0, -Cesium.Math.toRadians(70), focusRange * cameraRangeMultiplier);
      await viewer.flyTo(dataSource, {
        duration: 1.15,
        ...(offset ? { offset } : {}),
      });
    }
    assertActive(signal);
  }

  async function focusParcel(parcelOrAccountId, { signal, cameraRangeMultiplier = 1 } = {}) {
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

      await focusSnapshot([parcel], {
        signal, selectedParcel: parcel,
        cameraRangeMultiplier: Number.isFinite(cameraRangeMultiplier)
          ? Math.max(1, Math.min(3, cameraRangeMultiplier)) : 1,
      });
      showSelectedParcel(parcel);
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

    // Exact parcel/owner lookups must not be blocked by an unrelated,
    // potentially truncated countywide viewport query during setEnabled().
    // The data manager still owns enable/disable, guards and state restore.
    // A token-scoped release prevents an earlier aborted search from clearing
    // the next lookup's reservation.
    beginFocusedLookup() {
      const token = Symbol('county-focused-search');
      focusedLookupToken = token;
      return () => {
        if (focusedLookupToken === token) focusedLookupToken = null;
      };
    },

    init(targetViewer) {
      viewer = targetViewer;
      propertyCard = propertyCardFactory({
        onHide: () => {
          selectedParcelId = null;
          refreshParcelSelection();
        },
      });
      clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      clickHandler.setInputAction((movement) => {
        if (!enabled) return;
        const picked = viewer.scene.pick(movement.position);
        const entity = picked?.id;
        const id = propertyValue(entity, 'bdpParcelId') || entity?.id;
        const parcel = parcelById.get(String(id));
        if (parcel) showSelectedParcel(parcel);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
    },

    disable() {
      enabled = false;
      notifyViewportCandidates([], false);
      selectedParcelId = null;
      refreshParcelSelection();
      if (dataSource) dataSource.show = false;
      propertyCard?.hide();
      requestController?.abort();
      requestController = null;
    },

    focusParcel,
    focusOwner,
    hideCard() {
      selectedParcelId = null;
      refreshParcelSelection();
      propertyCard?.hide();
    },

    async update(targetViewer) {
      // Called by DataManager immediately after enable(). A direct parcel or
      // owner search should fetch the requested ID first, not preflight a dense
      // viewport that can exceed the ArcGIS response limit or be temporarily
      // unavailable. Never synthesize data or mark that viewport as complete.
      if (!enabled || loading || focusedLookupToken !== null) return true;
      viewer = targetViewer || viewer;
      // Auto-loaded Free Explorer GIS polygons are rendered only at <=1.3 km
      // WGS84 camera height; source query area/caps still govern completeness.
      const freeMode = typeof document !== 'undefined'
        && document.body?.dataset?.landProfile === 'browse';
      const height = viewer?.camera?.positionCartographic?.height;
      if (freeMode && !shouldDiscoverFreeParcels(height)) {
        if (dataSource) dataSource.show = false;
        lastBoundsKey = '';
        status = 'zoom-in';
        notifyViewportCandidates([], false, 'zoom-in');
        viewer?.scene?.requestRender?.();
        return true;
      }
      if (dataSource) dataSource.show = true;
      const rectangle = viewer?.camera?.computeViewRectangle(viewer.scene.globe.ellipsoid);
      const bounds = rectangleToBounds(rectangle);

      if (!isCloseEnough(bounds)) {
        status = viewportCoverageWarning ? 'degraded' : 'zoom-in';
        notifyViewportCandidates([], false, 'zoom-in');
        lastError = null;
        return true;
      }

      const key = boundsKey(bounds);
      if (key === lastBoundsKey && dataSource) {
        status = viewportCoverageWarning ? 'degraded' : 'nominal';
        return true;
      }

      loading = true;
      status = 'loading';
      notifyViewportCandidates([], false, 'loading');
      lastError = null;
      requestController?.abort();
      requestController = new AbortController();

      try {
        const parcels = await adapter.fetchParcelsInBounds(bounds, {
          limit: adapter.county === 'Bexar' ? 1000 : 500,
          signal: requestController.signal,
        });
        const coverage = parcels.viewportCoverage;
        if (coverage?.overLimit === true) {
          // The provider explicitly reported that this viewport was cut off
          // (or returned more than the request cap). Never display a subset as
          // full GIS coverage. Keep the layer active and inform the operator
          // that they must zoom closer or use a bounded parcel-ID search.
          // Existing explicitly selected source parcels are not invented,
          // changed or relabeled as a complete neighborhood snapshot.
          notifyViewportCandidates([], false, 'over-limit');
          viewportCoverageWarning = 'INCOMPLETE COVERAGE · Travis GIS parcel response exceeds the map request limit. Zoom closer or search by county parcel ID; boundaries for this view are not loaded.';
          lastUpdate = Date.now();
          lastError = null;
          status = 'degraded';
          return true;
        }
        const omitted = coverage?.omittedUnidentified || 0;
        if (omitted) {
          // A mapped polygon without a valid parcel ID is NOT a verified tract.
          // Show identifiable parcels, but never imply the viewport is complete.
          const warning = `PARTIAL: ${omitted} of ${parcels.viewportCoverage.receivedCount} source polygons lack valid parcel IDs and are not displayed; map coverage is incomplete.`;
          for (const parcel of parcels) {
            parcel.source.sourceNotice = [parcel.source.sourceNotice, warning].filter(Boolean).join(' ');
          }
        }
        await replaceSnapshot(parcels, { signal: requestController.signal, completeView: !omitted });
        viewportCoverageWarning = omitted
          ? `PARTIAL · ${omitted} unidentified source polygons omitted; parcel coverage incomplete`
          : '';
        lastBoundsKey = key;
        lastUpdate = Date.now();
        status = omitted ? 'degraded' : 'nominal';
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        notifyViewportCandidates([], false, 'error');
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
        loadingLabel: viewportCoverageWarning || undefined,
        degraded: Boolean(viewportCoverageWarning),
        lastError,
        error: lastError,
        available: status !== 'unavailable',
      };
    },

    destroy() {
      selectedParcelId = null;
      focusedLookupToken = null;
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
