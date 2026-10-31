import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUSTIN_REGULATORY_REFERENCES,
  buildAustinRegulatoryReview,
} from './austinRegulatoryReview.js';

const zoning = (observations) => ({
  status: 'preliminary-spatial-evidence',
  observations,
});
const mapped = (code, percent, intersects=true) => ({
  sourceName: 'zoning',
  attributes: { ZONING_ZTYPE: code },
  parcelPercent: percent,
  intersectsParcel: intersects,
});

test('three positive Austin GIS zones trigger boundary review and historic/neighborhood research, never legal uses', () => {
  const review = buildAustinRegulatoryReview({
    austinJurisdiction: {
      status: 'single-gis-feature-contains-parcel-envelope',
      envelopeContainingJurisdictions: [{ cityName: 'CITY OF AUSTIN', type: 'FULL' }],
    },
    austinZoning: zoning([
      mapped('SF-2-HD-NP', 99.8), mapped('MF-4-NP', 0.08),
      mapped('SF-3-NP', 0.005), mapped('CS', 0, false),
    ]),
  });
  assert.deepEqual(review.zoningCodeCandidates, ['MF-4-NP', 'SF-2-HD-NP', 'SF-3-NP']);
  assert.equal(review.zoningBoundaryReviewRequired, true);
  assert.equal(review.jurisdictionCandidate, 'CITY OF AUSTIN');
  assert.equal(review.historicDesignationIndicator, true);
  assert.equal(review.neighborhoodPlanIndicator, true);
  for (const key of ['controllingJurisdiction','legalZoning','adoptedParcelOrdinances',
    'permittedUses','maximumDwellingUnits','setbacks','buildingHeightLimit',
    'lotCoverageLimit','developmentFeasibility','acquisitionRecommendation']) {
    assert.equal(review[key], null, key + ' must remain unknown');
  }
  assert.equal(review.overlaysComplete, false);
  assert.equal(review.officialVerificationReceived, false);
  assert.equal(review.sourceCurrencyVerified, false);
});

test('missing zoning and jurisdiction are UNKNOWN, not favorable or legal no-overlay results', () => {
  const review = buildAustinRegulatoryReview();
  assert.deepEqual(review.zoningCodeCandidates, []);
  assert.equal(review.jurisdictionCandidate, null);
  assert.equal(review.zoningBoundaryReviewRequired, false);
  assert.equal(review.neighborhoodPlanIndicator, false);
  assert.equal(review.historicDesignationIndicator, false);
  assert.equal(review.permittedUses, null);
  assert.equal(review.developmentFeasibility, null);
  assert.equal(review.acquisitionRecommendation, null);
});

test('all city references use allowlisted official Austin public information resources', () => {
  for (const [label, url] of Object.entries(AUSTIN_REGULATORY_REFERENCES)) {
    assert.ok(label.length > 0);
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.hostname, 'www.austintexas.gov');
  }
  assert.match(AUSTIN_REGULATORY_REFERENCES.zoningVerification, /zoning-verification/);
  assert.match(AUSTIN_REGULATORY_REFERENCES.landDevelopmentCode, /city-and-land-development-code/);
});

test('malformed GIS zoning codes and nonintersecting candidates never become legal classifications', () => {
  const review = buildAustinRegulatoryReview({
    austinZoning: zoning([
      mapped('SF-2-HD-NP', 0, false), mapped('SF-3-NP', 0, true),
      mapped('MF-4-NP;DROP TABLE', 5), mapped(null, 50),
      mapped('SF-2-HD-NP', 0.003),
    ]),
  });
  assert.deepEqual(review.zoningCodeCandidates, ['SF-2-HD-NP']);
  assert.equal(review.zoningBoundaryReviewRequired, false);
  assert.equal(review.permittedUses, null);
});
