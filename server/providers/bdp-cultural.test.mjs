import assert from 'node:assert/strict';
import test from 'node:test';
import { bdpCulturalProviderPlugin } from './bdp-cultural.js';

test('cultural provider exposes a stable Vite plugin contract', () => {
  const plugin = bdpCulturalProviderPlugin();
  assert.equal(plugin.name, 'bdp-cultural-provider');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});
