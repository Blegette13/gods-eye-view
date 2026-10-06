import { BDP_SCORE_WEIGHTS } from './acquisitionScore.js';

const CATEGORY = Object.freeze({
  ownershipTitle: ['Ownership / title', 'Obtain deed, seller-authority, title commitment, exception and survey evidence; verify legal access and any claimed mineral/water interests.'],
  acquisitionEconomics: ['Acquisition economics', 'Verify asking price, sale comparables and project costs. Reconcile the scenario with documented underwriting assumptions.'],
  developmentPotential: ['Development potential', 'Review the mapped constraint footprint and obtain site-specific survey, engineering and intended-use feasibility evidence. Outside-footprint acreage is not verified buildable land.'],
  entitlementZoning: ['Entitlement / zoning', 'Confirm jurisdiction, intended-use permissions and applicable approval conditions with the responsible authority.'],
  utilitiesInfrastructure: ['Utilities / infrastructure', 'Obtain provider confirmation of service, capacity, connection requirements and costs for the intended project.'],
  accessTraffic: ['Access / traffic', 'Verify legal access and agency driveway requirements; check whether mapped roads and traffic stations represent the intended site access.'],
  environmental: ['Environmental', 'Review mapped wetlands, cleanup and waste evidence and obtain site-specific environmental due diligence. MSW points do not establish waste boundaries or contamination.'],
  floodWater: ['Flood / water', 'Confirm flood mapping coverage and review mapped hazards with the local floodplain authority for the intended use.'],
  terrainSoil: ['Terrain / soil', 'Validate terrain and soil screening with site-specific geotechnical, drainage and grading review.'],
  growth: ['Growth', 'Confirm planning records, project status and market-demand evidence before relying on nearby activity in underwriting.'],
});

const SOURCE_CATEGORY = Object.freeze({
  energy: 'ownershipTitle', flood: 'floodWater', wetlands: 'environmental',
  cleanups: 'environmental', msw: 'environmental', soils: 'terrainSoil',
  terrain: 'terrainSoil', transportation: 'accessTraffic', utilities: 'utilitiesInfrastructure',
  waterRights: 'ownershipTitle', cemeteries: 'developmentPotential',
  entitlement: 'entitlementZoning', growthRadar: 'growth', developmentConstraints: 'developmentPotential',
});
const SEVERITY = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1, info: 0 });
const SOURCE_LABEL = Object.freeze({
  energy: 'RRC wells / pipelines', flood: 'FEMA flood mapping', wetlands: 'USFWS NWI wetlands',
  cleanups: 'EPA cleanup records', msw: 'TCEQ MSW records', soils: 'SSURGO soils', terrain: 'USGS terrain',
  transportation: 'TxDOT roads / traffic', utilities: 'Utility screening', waterRights: 'TCEQ water-right points',
  cemeteries: 'THC cultural screening', entitlement: 'Entitlement screening', growthRadar: 'Growth Radar',
  developmentConstraints: 'Combined development constraints',
});

function categoryForFlag(id) {
  if (/^(parcel-source|pipeline|nearby-rrc|mineral-rights|tceq-water-right)/.test(id)) return 'ownershipTitle';
  if (/^fema-/.test(id)) return 'floodWater';
  if (/^(nwi-|epa-|nearby-epa|superfund-|rcra-|tceq-msw|active-landfill|closed-msw|historical-)/.test(id)) return 'environmental';
  if (/^(utility-|no-current-water|archived-transmission)/.test(id)) return 'utilitiesInfrastructure';
  if (/^(legal-access|roadway-|no-txdot|high-traffic|nearby-traffic)/.test(id)) return 'accessTraffic';
  if (/^(thc-|archeology-)/.test(id)) return 'developmentPotential';
  if (/^steep-terrain/.test(id)) return 'terrainSoil';
  if (/^(mtp-|planned-mobility|preliminary-plat|regional-center)/.test(id)) return 'growth';
  if (/^(san-antonio-etj|entitlement-|split-or-partial-zoning|zoning-|legal-entitlement)/.test(id)) return 'entitlementZoning';
  return null;
}

const freezeList = (items) => Object.freeze(items.map((item) => Object.freeze(item)));

/** Explain existing screening evidence. Never infer legal/GIS findings or an investment verdict. */
export function buildAcquisitionBrief({ parcel = {}, evidence = {}, errors = {}, score = {}, redFlags = [] } = {}) {
  const flags = redFlags.map((flag) => ({
    id: flag.id, category: categoryForFlag(flag.id), severity: flag.severity,
    title: flag.title, detail: flag.detail, source: flag.source,
    evidenceRef: `redFlags.${flag.id}`,
  })).sort((a, b) => (SEVERITY[b.severity] || 0) - (SEVERITY[a.severity] || 0) || a.id.localeCompare(b.id));
  const risks = flags.filter((flag) => flag.severity !== 'info');
  const caveats = flags.filter((flag) => flag.severity === 'info');
  const gaps = [];
  for (const [category, weight] of Object.entries(BDP_SCORE_WEIGHTS)) {
    const component = score.components?.[category];
    if (!component || component.status === 'unknown' || component.status === 'preliminary') {
      const status = component?.status === 'preliminary' ? 'preliminary' : 'unknown';
      gaps.push({
        id: `category:${category}`, category, label: CATEGORY[category][0], status, weight,
        detail: status === 'unknown' ? 'No supported category score; evidence required.'
          : (component.note || 'Screening evidence is preliminary; verification required.'),
        evidenceRef: `score.components.${category}`,
      });
    }
  }
  for (const [source, category] of Object.entries(SOURCE_CATEGORY)) {
    const metrics = evidence[source];
    const error = errors[source];
    const incomplete = ['flood', 'msw'].includes(source) && metrics?.coverage_complete !== true;
    if (metrics == null || error || incomplete) {
      gaps.push({
        id: `source:${source}`, category, label: SOURCE_LABEL[source], status: error ? 'unavailable' : 'unknown',
        detail: error ? 'Source screening failed; restore the feed and re-screen.'
          : metrics == null ? 'No source evidence returned.' : 'Coverage is incomplete or unverified; zero counts cannot establish clearance.',
        evidenceRef: error ? `errors.${source}` : `evidence.${source}`,
      });
    }
  }
  const actions = Object.entries(CATEGORY).map(([category, [label, action]]) => {
    const relatedFlags = flags.filter((flag) => flag.category === category);
    const relatedGaps = gaps.filter((gap) => gap.category === category);
    const severity = Math.max(0, ...relatedFlags.map((flag) => SEVERITY[flag.severity] || 0));
    const priority = severity >= 3 ? 'first-review' : relatedGaps.some((gap) => gap.status !== 'preliminary')
      ? 'resolve-evidence-gap' : 'confirm-screening';
    return {
      id: category, label, action, priority, severity,
      flagIds: Object.freeze(relatedFlags.map((flag) => flag.id)),
      gapIds: Object.freeze(relatedGaps.map((gap) => gap.id)),
      basis: Object.freeze([...relatedFlags.map((flag) => flag.title), ...relatedGaps.map((gap) => `${gap.label}: ${gap.status}`)]),
      evidenceRefs: Object.freeze([...new Set([
        `score.components.${category}`,
        ...Object.entries(SOURCE_CATEGORY).filter(([source, domain]) => domain === category && evidence[source] != null).map(([source]) => `evidence.${source}`),
        ...[...relatedFlags, ...relatedGaps].map((item) => item.evidenceRef),
      ])]),
    };
  });
  // Preserve future/unrecognized flags without inventing a category-specific interpretation.
  for (const flag of flags.filter((item) => !item.category)) {
    actions.push({ id: `flag:${flag.id}`, label: flag.title, action: 'Review the cited screening evidence with the responsible source or reviewer.',
      priority: (SEVERITY[flag.severity] || 0) >= 3 ? 'first-review' : 'confirm-screening', severity: SEVERITY[flag.severity] || 0,
      basis: Object.freeze([flag.title]),
      flagIds: Object.freeze([flag.id]), gapIds: Object.freeze([]), evidenceRefs: Object.freeze([flag.evidenceRef]) });
  }
  const rank = { 'first-review': 0, 'resolve-evidence-gap': 1, 'confirm-screening': 2 };
  actions.sort((a, b) => rank[a.priority] - rank[b.priority] || b.severity - a.severity);
  return Object.freeze({
    version: 1, parcelId: String(parcel.id || parcel.parcelId || ''),
    status: 'verification-required', buyRecommendation: null,
    summary: `${risks.length} screening review trigger${risks.length === 1 ? '' : 's'}; ${gaps.length} category/source evidence gap${gaps.length === 1 ? '' : 's'}. Acquisition recommendation withheld.`,
    risks: freezeList(risks), caveats: freezeList(caveats), gaps: freezeList(gaps), actions: freezeList(actions),
    scoreCoveragePercent: score.coveragePercent ?? null,
    confidenceAdjustedCoveragePercent: score.confidenceAdjustedCoveragePercent ?? null,
    notice: 'This brief organizes existing evidence and review tasks. An empty risk list is not clearance. Scores, CAD observations and scenario assumptions do not establish title, legal access, utility capacity, buildability or investment suitability. No buy/pass verdict is generated.',
  });
}
