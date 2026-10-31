import { reviewLandCriteria } from './session.js';

/**
 * Customer-facing property fit is a *preliminary evidence rating*, not a
 * financial underwriting, investment recommendation or zoning determination.
 * No unknown indicator counts as either success or failure. Never compute a
 * "buyability" percentage from missing prices and entitlement records.
 */
export function ratePreferenceEvidence(criteria, entry) {
  if (!criteria) return Object.freeze({
    label: 'Not rated', rationale: 'No search profile', matched: 0, outside: 0,
    unknown: 0, checked: 0, configured: 0, fitScore: null,
  });
  const findings = [...reviewLandCriteria(criteria, entry)];
  if (criteria.county) {
    const countyStatus = criteria.radiusMiles > 0
      ? 'unknown' // county alone does not establish location inside a ring
      : !entry?.county ? 'unknown'
        : entry.county === criteria.county ? 'reported-match' : 'reported-outside';
    findings.push({ field: 'Selected county / search area', status: countyStatus });
  }
  const matched = findings.filter((item) => item.status === 'reported-match').length;
  const outside = findings.filter((item) => item.status === 'reported-outside').length;
  const unknown = findings.filter((item) => item.status === 'unknown').length;
  const checked = matched + outside;
  const configured = findings.length;
  let label = 'Not rated';
  if (outside > 0) label = 'Source-reported mismatch';
  else if (checked > 0) label = 'Possible profile match';
  // A score is withheld until a meaningful evidence quorum is satisfied.
  // The current provider does NOT have verified asking price/allowed use;
  // therefore a percent grade is intentionally not emitted.
  return Object.freeze({
    label,
    rationale: checked === 0 ? 'No criteria supported by source data'
      : `${matched} reported match · ${outside} reported outside · ${unknown} unknown`,
    matched, outside, unknown, checked, configured,
    fitScore: null,
  });
}
