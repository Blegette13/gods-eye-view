import assert from 'node:assert/strict';
import test from 'node:test';
import { bdpEntitlementProviderPlugin } from './bdp-entitlement.js';

test('entitlement provider exposes a stable Vite plugin contract', () => {
  const plugin = bdpEntitlementProviderPlugin();
  assert.equal(plugin.name, 'bdp-entitlement-provider');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});
