import assert from 'node:assert/strict';
import test from 'node:test';
import { bdpGrowthProviderPlugin } from './bdp-growth.js';

test('Growth Radar provider exposes a stable Vite plugin contract', () => {
  const plugin = bdpGrowthProviderPlugin();
  assert.equal(plugin.name, 'bdp-growth-provider');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});
