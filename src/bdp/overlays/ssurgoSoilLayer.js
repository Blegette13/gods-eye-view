import * as Cesium from 'cesium';
import { SDA_WMS_URL, SSURGO_MAPUNIT_LAYER } from '../soil/ssurgoCatalog.js';

const UPDATE_INTERVAL_MS = 60 * 60_000;

export function createSsurgoSoilLayer() {
  let viewer = null;
  let imageryLayer = null;
  let enabled = false;
  let status = 'idle';
  let lastError = null;
  let lastUpdate = null;

  function ensureLayer() {
    if (!viewer || imageryLayer) return;
    try {
      const provider = new Cesium.WebMapServiceImageryProvider({
        url: SDA_WMS_URL,
        layers: SSURGO_MAPUNIT_LAYER,
        parameters: {
          transparent: true,
          format: 'image/png',
          version: '1.1.1',
          styles: '',
        },
        enablePickFeatures: false,
        credit: 'USDA NRCS Soil Data Access / SSURGO',
      });
      imageryLayer = viewer.imageryLayers.addImageryProvider(provider);
      imageryLayer.alpha = 0.55;
      imageryLayer.saturation = 0;
      imageryLayer.contrast = 1.08;
      imageryLayer.brightness = 0.9;
      imageryLayer.show = enabled;
      status = 'nominal';
      lastUpdate = Date.now();
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      status = 'unavailable';
      throw error;
    }
  }

  return {
    id: 'bdp-ssurgo-soils',
    name: 'BDP · SSURGO Soils',
    icon: '▧',
    source: 'USDA NRCS SSURGO / Soil Data Access',
    updateInterval: UPDATE_INTERVAL_MS,

    init(targetViewer) {
      viewer = targetViewer;
      enabled = false;
      status = 'idle';
      lastError = null;
      lastUpdate = null;
    },

    enable() {
      enabled = true;
      ensureLayer();
      if (imageryLayer) imageryLayer.show = true;
    },

    disable() {
      enabled = false;
      if (imageryLayer) imageryLayer.show = false;
    },

    async update(targetViewer) {
      viewer = targetViewer || viewer;
      if (!enabled) return true;
      try {
        ensureLayer();
        status = 'nominal';
        return true;
      } catch (error) {
        console.warn('[BDP:SSURGO] imagery initialization failed:', error);
        return false;
      }
    },

    getStats() {
      return {
        count: imageryLayer ? 1 : 0,
        loading: false,
        status,
        source: 'USDA NRCS Soil Data Access WMS · MapunitPoly',
        lastUpdate,
        lastError,
        error: lastError,
        available: status !== 'unavailable',
      };
    },

    destroy() {
      if (imageryLayer && viewer) viewer.imageryLayers.remove(imageryLayer, true);
      imageryLayer = null;
      viewer = null;
      enabled = false;
      status = 'idle';
    },
  };
}

export const ssurgoSoilLayer = createSsurgoSoilLayer();
export default ssurgoSoilLayer;
