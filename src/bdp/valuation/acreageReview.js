/**
 * Presentation-only quality flag for a parcel with nonpositive sourced acreage.
 * Never infer acreage from other mapped measurements or replace source data.
 * Null/missing acreage remains UNKNOWN through the existing record rendering.
 */
export function reviewReportedAcreage(acres) {
  if (acres === null || acres === undefined || acres === '') return null;
  if (typeof acres !== 'number' || !Number.isFinite(acres)) return null;
  if (acres === 0) return Object.freeze({
    kind: 'zero',
    message: 'REVIEW REQUIRED · The GIS/CAD source reports 0 acres. This does not establish that the parcel has no land area. Confirm acreage with current appraisal records and survey evidence before relying on area or per-acre figures.',
  });
  if (acres < 0) return Object.freeze({
    kind: 'negative',
    message: 'REVIEW REQUIRED · The GIS/CAD source reports a negative acreage value. Do not use this value for parcel area, per-acre analysis, or buildability; verify against source records and a current survey.',
  });
  return null;
}
