import {
  classifyFutureLandUse,
  classifyZoningBase,
  entitlementPlanningConsistency,
} from './entitlementScore.js';

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function flag({ id, severity, title, detail, evidence = {} }) {
  return Object.freeze({
    id,
    severity,
    title,
    detail,
    source: 'City of San Antonio entitlement GIS screening',
    evidence: Object.freeze({ ...evidence }),
    requiresVerification: true,
  });
}

export function deriveEntitlementFlags(metrics) {
  if (!metrics) return Object.freeze([]);

  const flags = [];
  const jurisdiction = String(metrics.jurisdiction_screen || '');
  const zoningCoverage = finiteOrNull(metrics.city_zoning_coverage_percent);
  const dominantShare = finiteOrNull(metrics.dominant_zoning_share_percent);
  const etjOverlap = finiteOrNull(metrics.etj_overlap_percent);
  const specialCount = finiteOrNull(metrics.zoning_special_condition_count);
  const fluCoverage = finiteOrNull(metrics.future_land_use_coverage_percent);
  const fluShare = finiteOrNull(metrics.dominant_future_land_use_share_percent);

  if (jurisdiction === 'san-antonio-etj') {
    flags.push(flag({
      id: 'san-antonio-etj-entitlement-review',
      severity: 'medium',
      title: 'Parcel screens inside San Antonio ETJ',
      detail: 'This screen does not assign City base zoning to ETJ land. Subdivision, development, utility, platting and other ETJ/county controls require separate jurisdiction-specific review.',
      evidence: { etjOverlapPercent: etjOverlap },
    }));
    return Object.freeze(flags);
  }

  if (jurisdiction === 'outside-or-unresolved') {
    flags.push(flag({
      id: 'entitlement-jurisdiction-unresolved',
      severity: 'medium',
      title: 'Entitlement jurisdiction unresolved',
      detail: 'The San Antonio zoning/ETJ screen did not establish City-zoned or ETJ jurisdiction for this tract. Resolve the controlling city/county/ETJ before relying on any land-use recommendation.',
      evidence: {
        cityZoningCoveragePercent: zoningCoverage,
        etjOverlapPercent: etjOverlap,
      },
    }));
    return Object.freeze(flags);
  }

  if (
    jurisdiction === 'san-antonio-city-zoned'
    && (
      (Number.isFinite(dominantShare) && dominantShare < 80)
      || (Number.isFinite(zoningCoverage) && zoningCoverage < 90)
    )
  ) {
    flags.push(flag({
      id: 'split-or-partial-zoning',
      severity: 'medium',
      title: 'Parcel has split or partial zoning coverage',
      detail: 'The tract is not overwhelmingly represented by one mapped City base-zoning polygon. Review all zoning districts and exact parcel boundaries before development assumptions.',
      evidence: {
        cityZoningCoveragePercent: zoningCoverage,
        dominantZoningSharePercent: dominantShare,
      },
    }));
  }

  if (Number.isFinite(specialCount) && specialCount > 0) {
    flags.push(flag({
      id: 'zoning-special-condition-review',
      severity: 'medium',
      title: 'Special/specific zoning condition mapped',
      detail: 'One or more mapped zoning polygons carry a special district or specific condition. Review the ordinance/case and current zoning detail before interpreting permitted development.',
      evidence: {
        specialConditionCount: specialCount,
        dominantSpecDistrict: metrics.dominant_zoning_spec_district || null,
        dominantSpecCondition: metrics.dominant_zoning_spec_condition || null,
        caseNo: metrics.dominant_zoning_case_no || null,
      },
    }));
  }

  const zoningCategory = classifyZoningBase(metrics.dominant_zoning_base);
  const futureCategory = classifyFutureLandUse(metrics.dominant_future_land_use);
  const consistency = entitlementPlanningConsistency(zoningCategory, futureCategory);
  if (
    consistency === 'potential-conflict'
    && Number.isFinite(fluCoverage)
    && fluCoverage >= 50
    && Number.isFinite(fluShare)
    && fluShare >= 50
  ) {
    flags.push(flag({
      id: 'zoning-future-land-use-conflict',
      severity: 'medium',
      title: 'Current zoning and adopted future-use screen differ',
      detail: 'The dominant mapped base-zoning category and adopted Future Land Use category point in different broad directions. This is a planning-review trigger, not proof that development is prohibited or rezoning will be approved.',
      evidence: {
        zoningBase: metrics.dominant_zoning_base || null,
        futureLandUse: metrics.dominant_future_land_use || null,
        planningConsistency: consistency,
      },
    }));
  }

  flags.push(flag({
    id: 'legal-entitlement-unverified',
    severity: 'info',
    title: 'Legal entitlement not determined',
    detail: 'GIS zoning/future-use screening does not establish vested rights, permitted density, development standards, overlay requirements, variances, deed restrictions, platting status or a legally available project.',
  }));

  return Object.freeze(flags);
}

export default deriveEntitlementFlags;
