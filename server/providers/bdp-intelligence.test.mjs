import assert from 'node:assert/strict';
import test from 'node:test';
import { bdpIntelligenceProviderPlugin } from './bdp-intelligence.js';

test('unified parcel intelligence provider exposes a stable Vite plugin name', () => {
  const plugin = bdpIntelligenceProviderPlugin();
  assert.equal(plugin.name, 'bdp-intelligence-provider');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});
