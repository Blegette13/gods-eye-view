import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAustinRegulatoryDueDiligence } from './austinRegulatoryDueDiligence.js';

const mapped = (ZONING_ZTYPE, parcelPercent, intersectsParcel=true) =>
  ({ sourceName: 'zoning', attributes: { ZONING_ZTYPE }, parcelPercent, intersectsParcel });
const scenario = (values) => ({
  austinZoning: { status: 'preliminary-spatial-evidence', observations: values },
  austinJurisdiction: {
    status: 'single-gis-feature-contains-parcel-envelope',
    envelopeContainingJurisdictions: [
      { cityName: 'CITY OF AUSTIN', specifics: 'FULL PURPOSE' },
    ],
  },
});

test('Pressler Street multiple mapped zoning codes create document-backed, unresolved review queue', () => {
  const queue = buildAustinRegulatoryDueDiligence(scenario([
    mapped('SF-2-HD-NP', 99.8), mapped('MF-4-NP', 0.08),
    mapped('SF-3-NP', 0.005),
  ]));
  assert.equal(queue.status, 'due-diligence-required');
  assert.equal(queue.openCount, queue.tasks.length);
  assert.equal(queue.blockingCount, queue.tasks.filter((t) => t.priority === 'blocking').length);
  assert.ok(queue.tasks.some((t) => t.id === 'resolve-zoning-boundary'));
  assert.ok(queue.tasks.some((t) => t.id === 'check-historic-restrictions'));
  assert.ok(queue.tasks.some((t) => t.id === 'check-neighborhood-plan'));
  assert.ok(queue.tasks.some((t) => t.id === 'verify-legal-jurisdiction'));
  assert.ok(queue.tasks.some((t) => t.id === 'verify-zoning-designation'));
  assert.ok(queue.tasks.some((t) => t.id === 'read-permitted-uses'));
  assert.ok(queue.tasks.some((t) => t.id === 'read-site-standards'));
  assert.ok(queue.tasks.some((t) => t.id === 'resolve-title-survey'));
  for (const t of queue.tasks) {
    assert.equal(t.state, 'verification-required');
    assert.equal(t.verified, false);
    if (t.sourceUrl) {
      const u = new URL(t.sourceUrl);
      assert.equal(u.protocol, 'https:');
      assert.equal(u.hostname, 'www.austintexas.gov');
    }
  }
  assert.equal(queue.officialZoningVerified, false);
  assert.equal(queue.developmentRightsVerified, false);
  assert.equal(queue.developmentFeasibility, null);
  assert.equal(queue.acquisitionRecommendation, null);
});

test('single GIS mapped classification does not automatically clear any legal review', () => {
  const queue = buildAustinRegulatoryDueDiligence(scenario([
    mapped('SF-2', 100), mapped('SF-3', 0, false),
  ]));
  assert.ok(!queue.tasks.some((t) => t.id === 'resolve-zoning-boundary'));
  assert.ok(!queue.tasks.some((t) => t.id === 'check-historic-restrictions'));
  assert.ok(!queue.tasks.some((t) => t.id === 'check-neighborhood-plan'));
  assert.ok(queue.tasks.some((t) => t.id === 'verify-legal-jurisdiction'));
  assert.ok(queue.tasks.every((t) => t.state === 'verification-required'));
  assert.equal(queue.officialZoningVerified, false);
  assert.equal(queue.acquisitionRecommendation, null);
});

test('missing GIS services preserve verification requirements and never imply no overlays', () => {
  const queue = buildAustinRegulatoryDueDiligence();
  const ids = queue.tasks.map((t) => t.id);
  assert.ok(ids.includes('verify-legal-jurisdiction'));
  assert.ok(ids.includes('verify-zoning-designation'));
  assert.ok(ids.includes('verify-all-overlays'));
  assert.ok(ids.includes('read-permitted-uses'));
  assert.ok(ids.includes('read-site-standards'));
  assert.equal(queue.status, 'due-diligence-required');
  assert.equal(queue.developmentFeasibility, null);
  assert.equal(queue.acquisitionRecommendation, null);
});
