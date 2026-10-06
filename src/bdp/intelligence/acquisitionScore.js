export const BDP_SCORE_WEIGHTS = Object.freeze({
  ownershipTitle: 8,
  acquisitionEconomics: 12,
  developmentPotential: 15,
  entitlementZoning: 12,
  utilitiesInfrastructure: 12,
  accessTraffic: 8,
  environmental: 10,
  floodWater: 8,
  terrainSoil: 5,
  growth: 10,
});

export const BDP_SCORE_TOTAL_WEIGHT = Object.values(BDP_SCORE_WEIGHTS)
  .reduce((sum, weight) => sum + weight, 0);

if (BDP_SCORE_TOTAL_WEIGHT !== 100) {
  throw new Error(`BDP score weights must total 100, got ${BDP_SCORE_TOTAL_WEIGHT}`);
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeComponentScore(value) {
  const number = finiteOrNull(value);
  if (number === null) return null;
  return Math.max(0, Math.min(100, number));
}

function normalizeConfidence(value) {
  const number = finiteOrNull(value);
  if (number === null) return 1;
  return Math.max(0, Math.min(1, number));
}

function normalizeComponentInput(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    return Object.freeze({ score: normalizeComponentScore(input), confidence: 1, evidence: [] });
  }
  if (typeof input !== 'object') return null;
  const score = normalizeComponentScore(input.score);
  if (score === null) return null;
  return Object.freeze({
    score,
    confidence: normalizeConfidence(input.confidence),
    evidence: Object.freeze(Array.isArray(input.evidence) ? [...input.evidence] : []),
    source: input.source ? String(input.source) : '',
    note: input.note ? String(input.note) : '',
  });
}

/**
 * Calculate a BDP acquisition score without treating missing evidence as safe.
 *
 * `score` is normalized only across categories with usable evidence. It is not
 * considered decision-ready unless coverage is high enough for the caller's
 * policy. `coveragePercent` reports how much of the 100-point model is backed
 * by a supplied category score. `confidenceAdjustedCoveragePercent` further
 * discounts categories whose evidence is explicitly preliminary/incomplete.
 */
export function calculateBdpScore({ components = {} } = {}) {
  const detail = {};
  let coveredWeight = 0;
  let confidenceAdjustedWeight = 0;
  let earnedWeightedPoints = 0;
  let confidenceAdjustedEarnedPoints = 0;

  for (const [category, weight] of Object.entries(BDP_SCORE_WEIGHTS)) {
    const component = normalizeComponentInput(components[category]);
    if (!component) {
      detail[category] = Object.freeze({
        weight,
        status: 'unknown',
        score: null,
        confidence: 0,
        weightedPoints: null,
        evidence: Object.freeze([]),
      });
      continue;
    }

    const weightedPoints = (component.score / 100) * weight;
    coveredWeight += weight;
    confidenceAdjustedWeight += weight * component.confidence;
    earnedWeightedPoints += weightedPoints;
    confidenceAdjustedEarnedPoints += weightedPoints * component.confidence;

    detail[category] = Object.freeze({
      ...component,
      weight,
      status: component.confidence < 1 ? 'preliminary' : 'known',
      weightedPoints,
    });
  }

  const score = coveredWeight > 0
    ? (earnedWeightedPoints / coveredWeight) * 100
    : null;
  const confidenceAdjustedScore = confidenceAdjustedWeight > 0
    ? (confidenceAdjustedEarnedPoints / confidenceAdjustedWeight) * 100
    : null;
  const coveragePercent = (coveredWeight / BDP_SCORE_TOTAL_WEIGHT) * 100;
  const confidenceAdjustedCoveragePercent =
    (confidenceAdjustedWeight / BDP_SCORE_TOTAL_WEIGHT) * 100;
  const missingCategories = Object.entries(detail)
    .filter(([, value]) => value.status === 'unknown')
    .map(([category]) => category);

  let readiness = 'insufficient-evidence';
  if (coveragePercent >= 90 && confidenceAdjustedCoveragePercent >= 80) readiness = 'decision-support';
  else if (coveragePercent >= 60) readiness = 'preliminary';

  return Object.freeze({
    score,
    confidenceAdjustedScore,
    earnedWeightedPoints,
    coveredWeight,
    coveragePercent,
    confidenceAdjustedCoveragePercent,
    readiness,
    missingCategories: Object.freeze(missingCategories),
    components: Object.freeze(detail),
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Preliminary environmental component from NWI screening only. */
export function scoreWetlandsEnvironment(wetlands) {
  const percent = finiteOrNull(wetlands?.nwi_percent);
  if (percent === null) return null;
  const score = clamp(100 - percent * 2, 0, 100);
  return Object.freeze({
    score,
    confidence: 0.35,
    source: 'USFWS NWI screening',
    note: 'Environmental category currently reflects mapped NWI overlap only.',
    evidence: Object.freeze([`NWI mapped ${percent.toFixed(2)}% of parcel`]),
  });
}

/** Preliminary contamination/cleanup component from EPA CIMC point screening. */
export function scoreEpaCleanupEnvironment(cleanups) {
  const nearestM = finiteOrNull(cleanups?.nearest_cleanup_m);
  const onParcel = finiteOrNull(cleanups?.cleanup_sites_on_parcel);
  const superfund = finiteOrNull(cleanups?.superfund_within_5_mi);
  const rcra = finiteOrNull(cleanups?.rcra_within_5_mi);
  const brownfields = finiteOrNull(cleanups?.brownfields_within_5_mi);
  const total = finiteOrNull(cleanups?.cleanup_sites_within_5_mi);
  if ([nearestM, onParcel, superfund, rcra, brownfields, total].every((value) => value === null)) return null;

  let score = 100;
  const evidence = [];

  if (Number.isFinite(onParcel) && onParcel > 0) {
    score -= Math.min(70, 45 + Math.max(0, onParcel - 1) * 10);
    evidence.push(`${Math.round(onParcel)} EPA cleanup site${onParcel === 1 ? '' : 's'} mapped on parcel`);
  }
  if (Number.isFinite(superfund) && superfund > 0) {
    score -= Math.min(45, superfund * 20);
    evidence.push(`${Math.round(superfund)} Superfund site${superfund === 1 ? '' : 's'} within 5 mi`);
  }
  if (Number.isFinite(rcra) && rcra > 0) {
    score -= Math.min(30, rcra * 12);
    evidence.push(`${Math.round(rcra)} RCRA corrective-action site${rcra === 1 ? '' : 's'} within 5 mi`);
  }
  if (Number.isFinite(brownfields) && brownfields > 0) {
    score -= Math.min(18, brownfields * 5);
    evidence.push(`${Math.round(brownfields)} Brownfields propert${brownfields === 1 ? 'y' : 'ies'} within 5 mi`);
  }
  if (Number.isFinite(nearestM)) {
    const miles = nearestM / 1609.344;
    if (miles <= 0.25) score -= 25;
    else if (miles <= 1) score -= 15;
    else if (miles <= 3) score -= 5;
    evidence.push(`Nearest EPA cleanup site ${miles.toFixed(2)} mi from tract`);
  }
  if (!evidence.length && Number.isFinite(total)) evidence.push(`${Math.round(total)} EPA cleanup sites within 5 mi`);

  return Object.freeze({
    score: clamp(score, 0, 100),
    confidence: 0.5,
    source: 'US EPA Cleanups in My Community screening',
    note: 'EPA cleanup proximity is screening evidence; site status, contamination extent and parcel impact require record/environmental review.',
    evidence: Object.freeze(evidence),
  });
}

/** Preliminary state/local solid-waste-site component from TCEQ point screening. */
export function scoreTceqMswEnvironment(msw) {
  if (msw?.coverage_complete !== true) return null;
  const nearestM = finiteOrNull(msw?.nearest_msw_site_m);
  const onParcel = finiteOrNull(msw?.msw_points_on_parcel);
  const active1 = finiteOrNull(msw?.active_landfills_within_1_mi);
  const active3 = finiteOrNull(msw?.active_landfills_within_3_mi);
  const closed1 = finiteOrNull(msw?.closed_sites_within_1_mi);
  const closed3 = finiteOrNull(msw?.closed_sites_within_3_mi);
  const unauthorized1 = finiteOrNull(msw?.unauthorized_sites_within_1_mi);
  const unauthorized3 = finiteOrNull(msw?.unauthorized_sites_within_3_mi);
  const hazardous3 = finiteOrNull(msw?.hazardous_history_sites_within_3_mi);
  const total5 = finiteOrNull(msw?.all_msw_sites_within_5_mi);

  if ([onParcel, active1, active3, closed1, closed3, unauthorized1, unauthorized3, hazardous3, total5]
    .some((value) => value === null || value < 0)) return null;

  let score = 100;
  const evidence = [];

  if (Number.isFinite(onParcel) && onParcel > 0) {
    score -= Math.min(65, 40 + Math.max(0, onParcel - 1) * 8);
    evidence.push(`${Math.round(onParcel)} TCEQ MSW point${onParcel === 1 ? '' : 's'} mapped on parcel`);
  }
  if (Number.isFinite(active1) && active1 > 0) {
    score -= Math.min(35, active1 * 18);
    evidence.push(`${Math.round(active1)} active landfill${active1 === 1 ? '' : 's'} within 1 mi`);
  } else if (Number.isFinite(active3) && active3 > 0) {
    score -= Math.min(20, active3 * 8);
    evidence.push(`${Math.round(active3)} active landfill${active3 === 1 ? '' : 's'} within 3 mi`);
  }
  if (Number.isFinite(unauthorized1) && unauthorized1 > 0) {
    score -= Math.min(40, unauthorized1 * 20);
    evidence.push(`${Math.round(unauthorized1)} historical unauthorized/unnumbered site${unauthorized1 === 1 ? '' : 's'} within 1 mi`);
  } else if (Number.isFinite(unauthorized3) && unauthorized3 > 0) {
    score -= Math.min(25, unauthorized3 * 10);
    evidence.push(`${Math.round(unauthorized3)} historical unauthorized/unnumbered site${unauthorized3 === 1 ? '' : 's'} within 3 mi`);
  }
  if (Number.isFinite(hazardous3) && hazardous3 > 0) {
    score -= Math.min(35, hazardous3 * 15);
    evidence.push(`${Math.round(hazardous3)} historical site${hazardous3 === 1 ? '' : 's'} with confirmed/probable hazardous-waste history within 3 mi`);
  }
  if (Number.isFinite(closed1) && closed1 > 0) {
    score -= Math.min(25, closed1 * 12);
    evidence.push(`${Math.round(closed1)} closed MSW site${closed1 === 1 ? '' : 's'} within 1 mi`);
  } else if (Number.isFinite(closed3) && closed3 > 0) {
    score -= Math.min(12, closed3 * 5);
    evidence.push(`${Math.round(closed3)} closed MSW site${closed3 === 1 ? '' : 's'} within 3 mi`);
  }
  if (Number.isFinite(nearestM)) {
    evidence.push(`Nearest TCEQ MSW point ${(nearestM / 1609.344).toFixed(2)} mi from tract`);
  }
  if (!evidence.length && Number.isFinite(total5)) {
    evidence.push(`${Math.round(total5)} TCEQ MSW sites within 5 mi`);
  }

  return Object.freeze({
    score: clamp(score, 0, 100),
    confidence: 0.45,
    source: 'TCEQ municipal-solid-waste point screening',
    note: 'TCEQ facility coordinates are screening points and do not establish exact waste boundaries or parcel contamination.',
    evidence: Object.freeze(evidence),
  });
}

/** Combine the currently implemented environmental feeds without treating either as complete due diligence. */
export function scoreEnvironmental({ wetlands, cleanups, msw } = {}) {
  const wetland = scoreWetlandsEnvironment(wetlands);
  const cleanup = scoreEpaCleanupEnvironment(cleanups);
  const solidWaste = scoreTceqMswEnvironment(msw);

  const available = [wetland, cleanup, solidWaste].filter(Boolean);
  if (!available.length) return null;
  if (available.length === 1) return available[0];

  if (wetland && cleanup && !solidWaste) {
    return Object.freeze({
      score: clamp(wetland.score * 0.4 + cleanup.score * 0.6, 0, 100),
      confidence: 0.62,
      source: 'USFWS NWI + US EPA cleanup screening',
      note: 'Environmental category combines mapped wetlands and EPA cleanup proximity; protected species, state-only cleanup programs and site-specific environmental investigations remain unscored.',
      evidence: Object.freeze([...wetland.evidence, ...cleanup.evidence]),
    });
  }

  if (wetland && cleanup && solidWaste) {
    return Object.freeze({
      score: clamp(
        wetland.score * 0.25 + cleanup.score * 0.5 + solidWaste.score * 0.25,
        0,
        100,
      ),
      confidence: 0.72,
      source: 'USFWS NWI + US EPA cleanup + TCEQ MSW screening',
      note: 'Environmental category combines mapped wetlands, federal cleanup proximity, and state municipal-solid-waste point screening. These feeds do not replace Phase I/II environmental review, site-boundary verification, protected-species review, or contamination investigation.',
      evidence: Object.freeze([
        ...wetland.evidence,
        ...cleanup.evidence,
        ...solidWaste.evidence,
      ]),
    });
  }

  const score = available.reduce((sum, component) => sum + component.score, 0)
    / available.length;
  const confidence = available.reduce((sum, component) => sum + component.confidence, 0)
    / available.length;
  return Object.freeze({
    score: clamp(score, 0, 100),
    confidence: clamp(confidence, 0, 1),
    source: available.map((component) => component.source).join(' + '),
    note: 'Environmental category is based on currently available screening feeds only.',
    evidence: Object.freeze(available.flatMap((component) => component.evidence)),
  });
}

/** Preliminary flood/water component from FEMA mapped flood overlap only. */
export function scoreFemaFloodWater(flood) {
  if (flood?.coverage_complete !== true) return null;
  const mappedPercent = finiteOrNull(flood?.mapped_flood_percent);
  const floodwayAcres = finiteOrNull(flood?.floodway_acres);
  if (mappedPercent === null) return null;
  let score = 100 - mappedPercent * 1.5;
  if (Number.isFinite(floodwayAcres) && floodwayAcres > 0) score -= 20;
  score = clamp(score, 0, 100);
  return Object.freeze({
    score,
    confidence: 0.45,
    source: 'FEMA NFHL screening',
    note: 'Flood/water category currently reflects FEMA mapped flood constraints; water rights/availability are not yet scored.',
    evidence: Object.freeze([
      `FEMA mapped flood ${mappedPercent.toFixed(2)}% of parcel`,
      ...(Number.isFinite(floodwayAcres) && floodwayAcres > 0
        ? [`Mapped floodway ${floodwayAcres.toFixed(2)} acres`]
        : []),
    ]),
  });
}

/** Preliminary terrain/soil component from 3DEP slope and SSURGO coverage. */
export function scoreTerrainSoil({ terrain, soils } = {}) {
  const meanSlope = finiteOrNull(terrain?.slope?.meanDegrees);
  const dominantShare = finiteOrNull(soils?.dominant?.mappedSharePercent);
  const farmlandClass = String(soils?.dominant?.farmlandClass || '').trim();
  if (meanSlope === null && dominantShare === null) return null;

  let score = 100;
  const evidence = [];
  if (meanSlope !== null) {
    if (meanSlope >= 20) score -= 55;
    else if (meanSlope >= 10) score -= 30;
    else if (meanSlope >= 5) score -= 12;
    evidence.push(`Mean 3DEP slope ${meanSlope.toFixed(1)}°`);
  }
  if (dominantShare !== null) {
    evidence.push(`Dominant SSURGO map unit covers ${dominantShare.toFixed(1)}% of mapped soil area`);
  }
  if (farmlandClass) evidence.push(`Dominant farmland class: ${farmlandClass}`);

  const sourceCount = Number(meanSlope !== null) + Number(dominantShare !== null);
  return Object.freeze({
    score: clamp(score, 0, 100),
    confidence: sourceCount === 2 ? 0.7 : 0.45,
    source: 'USGS 3DEP + USDA NRCS SSURGO screening',
    note: 'Geotechnical suitability is not inferred from SSURGO/3DEP screening alone.',
    evidence: Object.freeze(evidence),
  });
}

export function buildCurrentScreeningComponents({
  flood,
  wetlands,
  cleanups,
  msw,
  terrain,
  soils,
} = {}) {
  return Object.freeze({
    environmental: scoreEnvironmental({ wetlands, cleanups, msw }),
    floodWater: scoreFemaFloodWater(flood),
    terrainSoil: scoreTerrainSoil({ terrain, soils }),
  });
}
