import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleForSanAntonioPilot, unavailableRegionalPilotEvidence } from './regionScope.js';

test('San Antonio pilot runs for Bexar parcels, not Travis or unknown county', () => {
  assert.equal(eligibleForSanAntonioPilot({ id: '48029:123' }), true);
  assert.equal(eligibleForSanAntonioPilot({ county: 'Bexar' }), true);
  assert.equal(eligibleForSanAntonioPilot({ countyFips: '48029' }), true);
  assert.equal(eligibleForSanAntonioPilot({ county: 'Travis', countyFips: '48453', id: '48453:123' }), false);
  assert.equal(eligibleForSanAntonioPilot({ id: '48453:123' }), false);
  assert.equal(eligibleForSanAntonioPilot({}), false);
  // Contradictory parcel identity must not accidentally enable a regional feed.
  assert.equal(eligibleForSanAntonioPilot({ county: 'Travis', id: '48029:123' }), false);
});

test('regional sources explicitly disclose unsupported coverage without fabricated zoning data', () => {
  for (const source of ['entitlement', 'growthRadar']) {
    const evidence = unavailableRegionalPilotEvidence(source);
    assert.equal(evidence.regional_scope_status, 'not-screened-outside-pilot');
    assert.match(evidence.regional_scope_note, /jurisdiction-specific evidence/i);
    assert.equal(evidence.jurisdiction_screen, undefined);
    assert.equal(evidence.mtp_crossing_count, undefined);
  }
  assert.throws(() => unavailableRegionalPilotEvidence('flood'), /Unsupported/);
});
