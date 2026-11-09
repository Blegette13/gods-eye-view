import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BDP_INTELLIGENCE_API_BASE,
  normalizeBdpIntelligenceRequest,
} from './apiContract.js';

test('unified intelligence endpoint stays under the BDP API namespace', () => {
  assert.equal(BDP_INTELLIGENCE_API_BASE, '/api/bdp/intelligence');
});

test('accepts a canonical parcel and preserves it for screening', () => {
  const parcel = {
    id: '48029:123',
    property: {
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-98.5, 29.4],
          [-98.49, 29.4],
          [-98.49, 29.41],
          [-98.5, 29.41],
          [-98.5, 29.4],
        ]],
      },
    },
  };
  assert.equal(normalizeBdpIntelligenceRequest({ parcel }).parcel, parcel);
});

test('rejects missing or non-polygon parcel geometry', () => {
  assert.throws(
    () => normalizeBdpIntelligenceRequest({ parcel: {} }),
    /Parcel geometry is required/i,
  );
  assert.throws(
    () => normalizeBdpIntelligenceRequest({
      parcel: { property: { geometry: { type: 'Point', coordinates: [-98.5, 29.4] } } },
    }),
    /must be Polygon or MultiPolygon/i,
  );
});
