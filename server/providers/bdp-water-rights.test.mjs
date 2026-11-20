import assert from 'node:assert/strict';
import test from 'node:test';
import { bdpWaterRightsProviderPlugin } from './bdp-water-rights.js';

test('TCEQ water-right provider exposes a stable Vite plugin contract', () => {
  const plugin = bdpWaterRightsProviderPlugin();
  assert.equal(plugin.name, 'bdp-water-rights-provider');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});
