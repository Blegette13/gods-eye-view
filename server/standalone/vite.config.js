import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { createBrowserViteConfig } from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
import { bdpRrcProviderPlugin } from '../providers/bdp-rrc.js';
import { bdpEnvironmentProviderPlugin } from '../providers/bdp-environment.js';
import { bdpSoilProviderPlugin } from '../providers/bdp-soil.js';
import { bdpTerrainProviderPlugin } from '../providers/bdp-terrain.js';
import { bdpTransportationProviderPlugin } from '../providers/bdp-transportation.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Load this checkout's configuration and attach its local provider middleware. */
export default defineConfig(({ mode }) => {
  const loaded = loadEnv(mode, root, '');
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return createBrowserViteConfig({
    plugins: [
      ...localProviderPlugins(),
      bdpRrcProviderPlugin(),
      bdpEnvironmentProviderPlugin(),
      bdpSoilProviderPlugin(),
      bdpTerrainProviderPlugin(),
      bdpTransportationProviderPlugin(),
    ],
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: process.env.CESIUM_ION_TOKEN,
    host: process.env.HOST,
    port: process.env.PORT,
  });
});
