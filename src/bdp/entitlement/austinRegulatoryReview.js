/**
 * Austin preliminary regulation research queue. This deliberately does not
 * interpret development rights from a GIS zoning map code. The codes are
 * candidates, not verified zoning, and standards/ordinances are not retrieved.
 * All references below are official City of Austin pages, not AI summaries.
 */
export const AUSTIN_REGULATORY_REFERENCES = Object.freeze({
  propertyProfile: 'https://www.austintexas.gov/development-services/property-profile-overview',
  zoningVerification: 'https://www.austintexas.gov/development-services/zoning-verification',
  zoningResources: 'https://www.austintexas.gov/planning/zoning-resources-site-regulations',
  landDevelopmentCode: 'https://www.austintexas.gov/planning/city-and-land-development-code',
  addressingVerification: 'https://www.austintexas.gov/technology/addressing-verification',
  historicPreservation: 'https://www.austintexas.gov/planning/what-we-preserve',
});

function mappedZoningCodes(zoning) {
  if (zoning?.status !== 'preliminary-spatial-evidence'
    || !Array.isArray(zoning?.observations)) return [];
  const codes = new Set();
  for (const entry of zoning.observations) {
    // A bounding-envelope candidate with zero *actual* overlap is excluded.
    // A positive fraction of a percent still requires boundary review.
    if (entry?.sourceName !== 'zoning' || entry.intersectsParcel !== true
      || typeof entry.parcelPercent !== 'number'
      || !Number.isFinite(entry.parcelPercent) || entry.parcelPercent <= 0) continue;
    const value = entry.attributes?.ZONING_ZTYPE;
    if (typeof value === 'string' && /^[A-Z0-9][A-Z0-9/-]{0,59}$/.test(value.trim())) {
      codes.add(value.trim());
    }
  }
  return [...codes].sort();
}

/**
 * Not a permit checklist and not a confirmation of whether every applicable
 * overlay has been found. Each line stays unverified until an independent
 * official workflow produces property- and ordinance-specific evidence.
 */
export function buildAustinRegulatoryReview({ austinZoning = null, austinJurisdiction = null } = {}) {
  const codes = mappedZoningCodes(austinZoning);
  const jurisdictionCandidate = austinJurisdiction?.status === 'single-gis-feature-contains-parcel-envelope'
    ? austinJurisdiction.envelopeContainingJurisdictions?.[0] : null;
  const hasNeighborhoodPlanIndicator = codes.some((code) => /(?:^|-)NP(?:-|$)/.test(code));
  const hasHistoricIndicator = codes.some((code) => /(?:^|-)HD?(?:-|$)/.test(code));
  return Object.freeze({
    status: 'research-required-no-regulatory-determination',
    jurisdictionCandidate: jurisdictionCandidate?.cityName || null,
    zoningCodeCandidates: Object.freeze(codes),
    zoningBoundaryReviewRequired: codes.length > 1,
    neighborhoodPlanIndicator: hasNeighborhoodPlanIndicator,
    historicDesignationIndicator: hasHistoricIndicator,
    controllingJurisdiction: null,
    legalZoning: null,
    adoptedParcelOrdinances: null,
    permittedUses: null,
    maximumDwellingUnits: null,
    setbacks: null,
    buildingHeightLimit: null,
    lotCoverageLimit: null,
    overlaysComplete: false,
    officialVerificationReceived: false,
    sourceCurrencyVerified: false,
    developmentFeasibility: null,
    acquisitionRecommendation: null,
    references: AUSTIN_REGULATORY_REFERENCES,
    notice: 'Preliminary zoning suffix indicators and municipal links are only a research queue. Check the zoning verification letter, property-specific ordinances, current use table, development regulations and historic/neighborhood restrictions with the responsible City staff.',
  });
}
