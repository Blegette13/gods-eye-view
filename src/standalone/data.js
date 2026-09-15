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
import femaFloodLayer from '../bdp/overlays/femaFloodLayer.js';
import rrcEnergyLayer from '../bdp/overlays/rrcEnergyLayer.js';
import nwiWetlandsLayer from '../bdp/overlays/nwiWetlandsLayer.js';
import ssurgoSoilLayer from '../bdp/overlays/ssurgoSoilLayer.js';
import { extendLayerStateRegistry } from '../bdp/config/layerRegistry.js';

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

  // BDP Land Intelligence production layers. Keep BDP-specific registration
  // adjacent to, but separate from, the upstream layer catalog so future
  // upstream merges remain straightforward.
  dataManager.register(bexarParcelLayer);
  dataManager.register(femaFloodLayer);
  dataManager.register(rrcEnergyLayer);
  dataManager.register(nwiWetlandsLayer);
  dataManager.register(ssurgoSoilLayer);

  dataManager.finalizeRegistrations(extendLayerStateRegistry(LAYER_STATE_REGISTRY));

  let parcelSearchController = null;
  const handleBdpLandSearch = async (event) => {
    const command = event?.detail;
    if (!['parcel', 'owner'].includes(command?.kind) || !command.value) return;

    parcelSearchController?.abort();
    parcelSearchController = new AbortController();
    const { signal } = parcelSearchController;

    try {
      await dataManager.setEnabled('bdp-bexar-parcels', true, {
        origin: 'user',
        signal,
      });
      if (signal.aborted) return;

      if (command.kind === 'owner') {
        const parcels = await bexarParcelLayer.focusOwner(command.value, {
          signal,
          limit: 100,
        });
        if (signal.aborted) return;
        window.dispatchEvent(new CustomEvent('bdp:land-search-result', {
          detail: parcels.length
            ? {
                ok: true,
                kind: 'owner',
                query: command.value,
                count: parcels.length,
              }
            : {
                ok: false,
                kind: 'owner',
                query: command.value,
                message: `No Bexar parcels found for owner ${command.value}`,
              },
        }));
        return;
      }

      const parcel = await bexarParcelLayer.focusParcel(command.value, { signal });
      if (signal.aborted) return;

      window.dispatchEvent(new CustomEvent('bdp:land-search-result', {
        detail: parcel
          ? {
              ok: true,
              kind: 'parcel',
              query: command.value,
              parcelId: parcel.parcelId,
              owner: parcel.owner?.name || '',
            }
          : {
              ok: false,
              kind: 'parcel',
              query: command.value,
              message: `No Bexar parcel found for ${command.value}`,
            },
      }));
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      console.warn('[BDP:LandSearch] lookup failed:', error);
      window.dispatchEvent(new CustomEvent('bdp:land-search-result', {
        detail: {
          ok: false,
          kind: command.kind,
          query: command.value,
          message: error instanceof Error ? error.message : 'Land lookup unavailable',
        },
      }));
    }
  };
  window.addEventListener('bdp:land-search', handleBdpLandSearch);
  defer(() => {
    parcelSearchController?.abort();
    parcelSearchController = null;
    window.removeEventListener('bdp:land-search', handleBdpLandSearch);
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
