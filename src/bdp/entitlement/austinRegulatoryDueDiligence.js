/**
 * Austin parcel-specific regulatory due-diligence queue.
 *
 * These are outstanding document requests, not zoning findings, legal advice,
 * site planning calculations, or permits. All items remain unverified until
 * separately documented review.  A mapped GIS code cannot clear an item.
 */
import { buildAustinRegulatoryReview, AUSTIN_REGULATORY_REFERENCES } from './austinRegulatoryReview.js';

const task = (id, priority, title, requirement, referenceKey = null) => Object.freeze({
  id, priority, title, requirement, state: 'verification-required',
  sourceKey: referenceKey,
  sourceUrl: referenceKey ? AUSTIN_REGULATORY_REFERENCES[referenceKey] : null,
  verified: false,
});

export function buildAustinRegulatoryDueDiligence({ austinZoning = null, austinJurisdiction = null } = {}) {
  const review = buildAustinRegulatoryReview({ austinZoning, austinJurisdiction });
  const tasks = [
    task('verify-legal-jurisdiction', 'blocking', 'Confirm legal city / ETJ authority',
      'Confirm current annexation, municipal jurisdiction, effective boundary, and governing development authority with City staff; GIS envelope classification is not legal clearance.',
      'propertyProfile'),
    task('verify-zoning-designation', 'blocking', 'Obtain official zoning verification',
      'Request a property-specific zoning verification letter from Austin Planning; resolve mixed GIS district lines before applying land-development standards.',
      'zoningVerification'),
  ];
  if (review.zoningBoundaryReviewRequired) {
    tasks.push(task('resolve-zoning-boundary', 'blocking', 'Resolve mixed mapped zoning boundaries',
      'Confirm whether each GIS zoning sliver intersects legally effective zoning boundaries and whether boundary precision, survey differences or separate ordinances explain it.',
      'zoningVerification'));
  }
  tasks.push(
    task('retrieve-zoning-ordinances', 'blocking', 'Find parcel-specific zoning ordinances',
      'Identify adopted rezoning ordinances, conditional overlays, tract restrictions, approved site plans, and amendments; record the official effective text and date.',
      'zoningResources'),
    task('verify-all-overlays', 'blocking', 'Check applicable overlays and combining districts',
      'Check all mapped and unmapped conditions, including conditional overlays, ETOD/NCCD, neighborhood plan and other site-specific overlays; zero GIS features is not clearance.',
      'zoningResources'),
  );
  if (review.historicDesignationIndicator) {
    tasks.push(task('check-historic-restrictions', 'blocking', 'Review historic status and approvals',
      'HD/H GIS code indicator requires checking current historic district/landmark designation and whether review/approval applies to the proposed work.',
      'historicPreservation'));
  }
  if (review.neighborhoodPlanIndicator) {
    tasks.push(task('check-neighborhood-plan', 'required', 'Review adopted neighborhood plan',
      'NP GIS suffix is a research indicator; identify adopted neighborhood-plan ordinances and applicable development restrictions.',
      'zoningResources'));
  }
  tasks.push(
    task('read-permitted-uses', 'blocking', 'Confirm proposed use against current code',
      'Read the current § 25-2-491 permitted-use chart together with confirmed base and combining districts, conditional uses, and applicable ordinances.',
      'landDevelopmentCode'),
    task('read-site-standards', 'blocking', 'Verify site development standards',
      'Read the current § 25-2-492 and applicable code interpretations for dimensional limits, setbacks, height, cover, density, and combining-district exceptions.',
      'landDevelopmentCode'),
    task('resolve-title-survey', 'blocking', 'Obtain survey, recorded restrictions and access proof',
      'Verify surveyed property limits, easements, deed restrictions, ownership, legal access, and permit history; a GIS outline is not a boundary survey.'),
  );
  return Object.freeze({
    status: 'due-diligence-required',
    openCount: tasks.length,
    blockingCount: tasks.filter((item) => item.priority === 'blocking').length,
    tasks: Object.freeze(tasks),
    officialZoningVerified: false,
    developmentRightsVerified: false,
    developmentFeasibility: null,
    acquisitionRecommendation: null,
    notice: 'Planning research queue only. No regulatory facts may be cleared from GIS codes or successful HTTP responses.',
  });
}
