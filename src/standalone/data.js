import { DataLayerManager } from '../data/manager.js';
import flightsLayer from '../data/flights.js';
import militaryFlightsLayer from '../data/militaryFlights.js';
import earthquakesLayer from '../data/earthquakes.js';
import satellitesLayer from '../data/satellites.js';
import rocketLaunchesLayer from '../data/rocketLaunches.js';
import trafficLayer from '../data/traffic.js';
import cctvLayer from '../data/cctv.js';
import radioLayer from '../data/radio.js';
import bikeshareLayer from '../data/bikeshare.js';
import aisLiveVesselsLayer from '../data/aisLiveVessels.js';
import militaryInstallationsLayer from '../data/militaryInstallations.js';
import militaryAwarenessLayer from '../data/militaryAwareness.js';
import localDataLayers from '../data/localLayers.js';
import { LAYER_STATE_REGISTRY } from '../data/layerState.js';
import bexarParcelLayer from '../bdp/parcels/bexarParcelLayer.js';
import travisParcelLayer from '../bdp/parcels/travisParcelLayer.js';
import williamsonParcelLayer from '../bdp/parcels/williamsonParcelLayer.js';
import haysParcelLayer from '../bdp/parcels/haysParcelLayer.js';
import femaFloodLayer from '../bdp/overlays/femaFloodLayer.js';
import rrcEnergyLayer from '../bdp/overlays/rrcEnergyLayer.js';
import nwiWetlandsLayer from '../bdp/overlays/nwiWetlandsLayer.js';
import ssurgoSoilLayer from '../bdp/overlays/ssurgoSoilLayer.js';
import epaCleanupLayer from '../bdp/overlays/epaCleanupLayer.js';
import txdotTrafficLayer from '../bdp/overlays/txdotTrafficLayer.js';
import utilityInfrastructureLayer from '../bdp/overlays/utilityInfrastructureLayer.js';
import tceqWaterRightsLayer from '../bdp/overlays/tceqWaterRightsLayer.js';
import tceqMswLayer from '../bdp/overlays/tceqMswLayer.js';
import thcCemeteryLayer from '../bdp/overlays/thcCemeteryLayer.js';
import sanAntonioEntitlementLayer from '../bdp/overlays/sanAntonioEntitlementLayer.js';
import { extendLayerStateRegistry } from '../bdp/config/layerRegistry.js';

const BDP_SCREEN_LAYER_IDS = Object.freeze([
  'bdp-bexar-parcels',
  'bdp-travis-parcels',
  'bdp-williamson-parcels',
  'bdp-hays-parcels',
  'bdp-fema-flood',
  'bdp-rrc-energy',
  'bdp-nwi-wetlands',
  'bdp-ssurgo-soils',
  'bdp-epa-cleanups',
  'bdp-txdot-traffic',
  'bdp-utilities-infrastructure',
  'bdp-tceq-water-rights',
  'bdp-tceq-msw',
  'bdp-thc-cemeteries',
  'bdp-san-antonio-entitlement',
]);

/** Register the standalone layer catalog before allowing state restoration. */
export function createStandaloneData({
  scene: { viewer },
  controls: { styleManager },
  allowQaRegistration,
  defer,
}) {
  const dataManager = new DataLayerManager(viewer, {
    allowQaRegistration,
  });
  defer(async () => {
    await dataManager.destroyAll();
    if (dataManager.layers.size)
      throw new Error(
        `Data layers could not be destroyed: ${[...dataManager.layers.keys()].join(', ')}`,
      );
  });
  dataManager.register(flightsLayer);
  dataManager.register(militaryFlightsLayer);
  dataManager.register(earthquakesLayer);
  dataManager.register(satellitesLayer);
  dataManager.register(rocketLaunchesLayer);
  rocketLaunchesLayer.attachDataManager(dataManager);
  dataManager.register(trafficLayer);
  dataManager.register(cctvLayer);
  dataManager.register(radioLayer);
  dataManager.register(bikeshareLayer);
  dataManager.register(aisLiveVesselsLayer);
  dataManager.register(militaryInstallationsLayer);
  dataManager.register(militaryAwarenessLayer);
  militaryAwarenessLayer.attachDataManager(dataManager);
  for (const layer of localDataLayers) {
    dataManager.register(layer);
  }

  dataManager.register(bexarParcelLayer);
  dataManager.register(travisParcelLayer);
  dataManager.register(williamsonParcelLayer);
  dataManager.register(haysParcelLayer);
  dataManager.register(femaFloodLayer);
  dataManager.register(rrcEnergyLayer);
  dataManager.register(nwiWetlandsLayer);
  dataManager.register(ssurgoSoilLayer);
  dataManager.register(epaCleanupLayer);
  dataManager.register(txdotTrafficLayer);
  dataManager.register(utilityInfrastructureLayer);
  dataManager.register(tceqWaterRightsLayer);
  dataManager.register(tceqMswLayer);
  dataManager.register(thcCemeteryLayer);
  dataManager.register(sanAntonioEntitlementLayer);

  dataManager.finalizeRegistrations(
    extendLayerStateRegistry(LAYER_STATE_REGISTRY),
  );

  let parcelSearchController = null;
  const handleBdpLandSearch = async (event) => {
    const command = event?.detail;
    if (!['parcel', 'owner'].includes(command?.kind) || !command.value) return;

    parcelSearchController?.abort();
    parcelSearchController = new AbortController();
    const { signal } = parcelSearchController;
    const countyLayers = {
      Bexar: bexarParcelLayer,
      Travis: travisParcelLayer,
      Williamson: williamsonParcelLayer,
      Hays: haysParcelLayer,
    };
    const county = command.county || 'Bexar';
    const layer = countyLayers[county];
    if (!layer) return;
    const layerId = layer.id;
    for (const [name, other] of Object.entries(countyLayers)) {
      if (name !== county) other.hideCard();
    }

    try {
      await dataManager.setEnabled(layerId, true, {
        origin: 'user',
        signal,
      });
      if (signal.aborted) return;

      if (command.kind === 'owner') {
        const parcels = await layer.focusOwner(command.value, {
          signal,
          limit: 100,
        });
        if (signal.aborted) return;
        window.dispatchEvent(
          new CustomEvent('bdp:land-search-result', {
            detail: parcels.length
              ? {
                  ok: true,
                  kind: 'owner',
                  query: command.value,
                  count: parcels.length,
                  county,
                }
              : {
                  ok: false,
                  kind: 'owner',
                  query: command.value,
                  message: `No ${county} parcels found for owner ${command.value}`,
                },
          }),
        );
        return;
      }

      const parcel = await layer.focusParcel(command.value, {
        signal,
      });
      if (signal.aborted) return;

      window.dispatchEvent(
        new CustomEvent('bdp:land-search-result', {
          detail: parcel
            ? {
                ok: true,
                kind: 'parcel',
                query: command.value,
                parcelId: parcel.parcelId,
                owner: parcel.owner?.name || '',
                county,
              }
            : {
                ok: false,
                kind: 'parcel',
                query: command.value,
                message: `No ${county} parcel found for ${command.value}`,
              },
        }),
      );
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      console.warn('[BDP:LandSearch] lookup failed:', error);
      window.dispatchEvent(
        new CustomEvent('bdp:land-search-result', {
          detail: {
            ok: false,
            kind: command.kind,
            query: command.value,
            message:
              error instanceof Error
                ? error.message
                : 'Land lookup unavailable',
          },
        }),
      );
    }
  };
  window.addEventListener('bdp:land-search', handleBdpLandSearch);
  defer(() => {
    parcelSearchController?.abort();
    parcelSearchController = null;
    window.removeEventListener('bdp:land-search', handleBdpLandSearch);
  });

  let presetController = null;
  const handleBdpLayerPreset = async (event) => {
    const mode = event?.detail?.mode;
    if (!['screen', 'clear'].includes(mode)) return;

    presetController?.abort();
    presetController = new AbortController();
    const { signal } = presetController;
    const shouldEnable = mode === 'screen';
    const failures = [];
    let changedCount = 0;

    for (const layerId of BDP_SCREEN_LAYER_IDS) {
      if (signal.aborted) return;
      try {
        const settled = await dataManager.setEnabled(layerId, shouldEnable, {
          origin: 'user',
          signal,
        });
        if (settled !== false) changedCount += 1;
        else failures.push(layerId);
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') return;
        failures.push(layerId);
        console.warn(`[BDP:LayerPreset] ${mode} failed for ${layerId}:`, error);
      }
    }

    window.dispatchEvent(
      new CustomEvent('bdp:layer-preset-result', {
        detail: {
          ok: failures.length === 0,
          mode,
          enabledCount: mode === 'screen' ? changedCount : 0,
          clearedCount: mode === 'clear' ? changedCount : 0,
          failures,
          message: failures.length
            ? `BDP ${mode} completed with ${failures.length} layer issue${failures.length === 1 ? '' : 's'}`
            : '',
        },
      }),
    );
  };
  window.addEventListener('bdp:layer-preset', handleBdpLayerPreset);
  defer(() => {
    presetController?.abort();
    presetController = null;
    window.removeEventListener('bdp:layer-preset', handleBdpLayerPreset);
  });

  if (allowQaRegistration) {
    window.__gevQaRegisterLayer = (targetManager, layerModule) => {
      if (targetManager !== dataManager)
        throw new Error('QA layer manager mismatch');
      return dataManager.registerForQa(layerModule);
    };
    window.__gevQaUnregisterLayer = (targetManager, layerId) => {
      if (targetManager !== dataManager)
        throw new Error('QA layer manager mismatch');
      return dataManager.unregisterForQa(layerId);
    };
    const register = window.__gevQaRegisterLayer;
    const unregister = window.__gevQaUnregisterLayer;
    defer(() => {
      if (window.__gevQaRegisterLayer === register)
        delete window.__gevQaRegisterLayer;
      if (window.__gevQaUnregisterLayer === unregister)
        delete window.__gevQaUnregisterLayer;
    });
  }
  dataManager.buildTogglePanel(document.getElementById('data-toggles'));
  styleManager.attachDataManager(dataManager);

  return { dataManager };
}
