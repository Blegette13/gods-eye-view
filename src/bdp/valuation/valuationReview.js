/**
 * Presentation-only checks for reported appraisal components.
 *
 * County GIS fields may refer to different appraisal bases, exemptions,
 * jurisdictions or years. A discrepancy is a prompt for source verification,
 * never a claim that the CAD figure is necessarily wrong.
 *
 * DO NOT change or infer valuation fields here; all displayed numbers remain
 * the exact normalized source values. No sale price, asking price or legal
 * determination is derived from these observations.
 */
function nonnegative(value) {
  if (value === null || value === undefined || value === ''
    || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function reviewReportedValuation(valuation) {
  const land = nonnegative(valuation?.landValue);
  const improvements = nonnegative(valuation?.improvementValue);
  const reported = nonnegative(valuation?.marketValue);

  if (reported === null || (land === null && improvements === null)) {
    return Object.freeze({ status: 'insufficient-evidence', flags: Object.freeze([]) });
  }

  // Don't mistake formatting, rounding, or small county adjustments for
  // material source disagreement. Compare only known non-negative components.
  const tolerance = Math.max(100, reported * 0.02);
  const flags = [];
  if (land !== null && land > reported + tolerance) flags.push('land-exceeds-reported');
  if (improvements !== null && improvements > reported + tolerance) flags.push('improvements-exceed-reported');
  if (land !== null && improvements !== null
    && land + improvements > reported + tolerance) flags.push('components-exceed-reported');

  return Object.freeze({
    status: flags.length ? 'review-required' : 'not-indicated',
    flags: Object.freeze(flags),
  });
}

export const VALUATION_REVIEW_NOTICE =
  'REVIEW REQUIRED · Source valuation fields do not reconcile. Land and/or improvement figures exceed the reported total. Fields may use different bases or reporting periods; confirm current values directly with the appraisal district before financial decisions.';
