import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { createBrowserViteConfig } from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
import { bdpRrcProviderPlugin } from '../providers/bdp-rrc.js';
import { bdpEnvironmentProviderPlugin } from '../providers/bdp-environment.js';
import { bdpSoilProviderPlugin } from '../providers/bdp-soil.js';
import { bdpTerrainProviderPlugin } from '../providers/bdp-terrain.js';
import { bdpTransportationProviderPlugin } from '../providers/bdp-transportation.js';
import { bdpUtilitiesProviderPlugin } from '../providers/bdp-utilities.js';
import { bdpWaterRightsProviderPlugin } from '../providers/bdp-water-rights.js';
import { bdpCulturalProviderPlugin } from '../providers/bdp-cultural.js';
import { bdpIntelligenceProviderPlugin } from '../providers/bdp-intelligence.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Load this checkout's configuration and attach its local provider middleware. */
export default defineConfig(({ mode }) => {
  const loaded = loadEnv(mode, root, '');
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  const localPlugins = localProviderPlugins();
  const keySetupPlugin = localPlugins.at(-1);

  return createBrowserViteConfig({
    plugins: [
      ...localPlugins.slice(0, -1),
      bdpRrcProviderPlugin(),
      bdpEnvironmentProviderPlugin(),
      bdpSoilProviderPlugin(),
      bdpTerrainProviderPlugin(),
      bdpTransportationProviderPlugin(),
      bdpUtilitiesProviderPlugin(),
      bdpWaterRightsProviderPlugin(),
      bdpCulturalProviderPlugin(),
      bdpIntelligenceProviderPlugin(),
      keySetupPlugin,
    ],
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: process.env.CESIUM_ION_TOKEN,
    host: process.env.HOST,
    port: process.env.PORT,
  });
});
