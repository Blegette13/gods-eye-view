import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { applyBdpGodsEyeUi } from './bdp/ui/godsEyeUi.js';
import { showLandDiscoveryGate } from './bdp/ui/discoveryGate.js';
import { mountLandWorkspaces } from './bdp/ui/acquisitionWorkspace.js';
import './bdp/ui/discoveryWorkspace.css';

applyBdpGodsEyeUi();

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

// Phase 2 welcome is intentionally first: no Cesium viewer, data feeds,
// original controls or map interaction start until the user begins or skips.
// Criteria remain only in this page memory, not a fake authenticated account.
showLandDiscoveryGate()
  .then((initialCriteria) => {
    mountLandWorkspaces({ initialCriteria });
    return application.start();
  })
  .catch((error) => {
    console.error('Land workspace initialization failed:', error);
    const status = document.querySelector('#loading-screen .loader-status');
    if (status) {
      status.textContent = `Error: ${describeError(error)}`;
      status.style.color = '#b42318';
    }
  });

export { application };
