function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function classifyZoningBase(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!code || ['OCL', 'UZROW'].includes(code)) return 'unresolved';
  if (/^(R-|RE$|RM-|MF-|MH$)/.test(code)) return 'residential';
  if (/^(C-|NC$|O-|D$)/.test(code)) return 'commercial';
  if (/^(I-1$|I-2$|L$|MI-1$|MI-2$)/.test(code)) return 'industrial';
  if (/^(FR$|RP$)/.test(code)) return 'rural';
  if (/^(IDZ|TOD|MXD|MPCD|UD|RD|DR)/.test(code)) return 'mixed-special';
  return 'special';
}

export function classifyFutureLandUse(value) {
  const label = String(value || '').trim().toLowerCase();
  if (!label) return 'unresolved';
  if (
    label.includes('residential')
    || label.includes('neighborhood')
  ) return 'residential';
  if (
    label.includes('mixed use')
    || label.includes('mixed-use')
    || label.includes('urban center')
    || label.includes('regional center')
  ) return 'mixed-special';
  if (
    label.includes('commercial')
    || label.includes('business park')
    || label.includes('office')
  ) return 'commercial';
  if (
    label.includes('industrial')
    || label.includes('employment')
  ) return 'industrial';
  if (
    label.includes('agric')
    || label.includes('rural')
    || label.includes('farm')
  ) return 'rural';
  if (
    label.includes('park')
    || label.includes('open space')
    || label.includes('natural')
    || label.includes('conservation')
  ) return 'open-space';
  return 'special';
}

export function entitlementPlanningConsistency(zoningCategory, futureCategory) {
  if (
    zoningCategory === 'unresolved'
    || futureCategory === 'unresolved'
    || zoningCategory === 'special'
    || futureCategory === 'special'
  ) return 'unresolved';

  if (zoningCategory === futureCategory) return 'aligned';
  if (
    futureCategory === 'mixed-special'
    && ['residential', 'commercial', 'mixed-special'].includes(zoningCategory)
  ) return 'generally-compatible';
  if (
    zoningCategory === 'mixed-special'
    && ['residential', 'commercial', 'mixed-special'].includes(futureCategory)
  ) return 'generally-compatible';
  if (zoningCategory === 'rural' && futureCategory === 'open-space') {
    return 'generally-compatible';
  }
  return 'potential-conflict';
}

/**
 * Preliminary San Antonio entitlement/zoning component.
 *
 * This deliberately returns null for ETJ/outside-city parcels because City base
 * zoning alone is not an honest entitlement answer there. A later county/ETJ
 * subdivision and local-rule engine will score those jurisdictions separately.
 */
export function scoreEntitlementZoning(metrics) {
  if (!metrics) return null;
  if (metrics.jurisdiction_screen !== 'san-antonio-city-zoned') return null;

  const zoningCoverage = finiteOrNull(metrics.city_zoning_coverage_percent);
  const dominantShare = finiteOrNull(metrics.dominant_zoning_share_percent);
  const fluCoverage = finiteOrNull(metrics.future_land_use_coverage_percent);
  const fluShare = finiteOrNull(metrics.dominant_future_land_use_share_percent);
  const specialCount = finiteOrNull(metrics.zoning_special_condition_count);
  if (
    !Number.isFinite(zoningCoverage)
    || zoningCoverage < 80
    || !Number.isFinite(dominantShare)
    || dominantShare < 50
  ) return null;

  const zoningCategory = classifyZoningBase(metrics.dominant_zoning_base);
  const futureCategory = classifyFutureLandUse(metrics.dominant_future_land_use);
  const consistency = entitlementPlanningConsistency(zoningCategory, futureCategory);

  let score = 70;
  const evidence = [
    `San Antonio city-zoning coverage ${zoningCoverage.toFixed(1)}%`,
    `Dominant base zoning ${metrics.dominant_zoning_base || 'unknown'} covers ${dominantShare.toFixed(1)}%`,
  ];

  if (dominantShare >= 90) score += 8;
  else if (dominantShare < 70) score -= 10;

  if (Number.isFinite(fluCoverage) && fluCoverage > 0) {
    evidence.push(`Adopted Future Land Use coverage ${fluCoverage.toFixed(1)}%`);
    if (Number.isFinite(fluShare)) {
      evidence.push(
        `Dominant Future Land Use ${metrics.dominant_future_land_use || 'unknown'} covers ${fluShare.toFixed(1)}%`,
      );
    }

    if (consistency === 'aligned') score += 12;
    else if (consistency === 'generally-compatible') score += 5;
    else if (consistency === 'potential-conflict') score -= 20;
  }

  if (Number.isFinite(specialCount) && specialCount > 0) {
    score -= Math.min(12, specialCount * 4);
    evidence.push(
      `${Math.round(specialCount)} zoning feature${specialCount === 1 ? '' : 's'} carry special/specific conditions`,
    );
  }

  const sourceCompleteness =
    Number(zoningCoverage >= 80)
    + Number(Number.isFinite(fluCoverage) && fluCoverage >= 50);
  const confidence = sourceCompleteness === 2 ? 0.58 : 0.42;

  return Object.freeze({
    score: clamp(score, 0, 100),
    confidence,
    source: 'City of San Antonio zoning + ETJ + adopted Future Land Use GIS',
    note: 'This is planning/entitlement screening only. GIS does not determine vested rights, permitted development, variances, overlays, platting obligations, infrastructure conditions, deed restrictions, or a legally available use.',
    planningConsistency: consistency,
    zoningCategory,
    futureLandUseCategory: futureCategory,
    evidence: Object.freeze(evidence),
  });
}

export default scoreEntitlementZoning;
