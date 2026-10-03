import assert from 'node:assert/strict';
import test from 'node:test';
import { bdpUtilitiesProviderPlugin } from './bdp-utilities.js';

test('utilities provider exposes a stable Vite plugin contract', () => {
  const plugin = bdpUtilitiesProviderPlugin();
  assert.equal(plugin.name, 'bdp-utilities-provider');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});
