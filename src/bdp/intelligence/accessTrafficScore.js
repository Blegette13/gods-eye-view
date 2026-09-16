function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Preliminary Access / Traffic component from TxDOT GIS screening.
 *
 * Road centerline proximity is useful acquisition screening evidence, but it
 * does not establish legal ingress/egress, curb-cut permission, ROW frontage,
 * or driveway approval. Those remain explicit verification steps.
 */
export function scoreAccessTraffic(transportation) {
  const roadDistanceM = finiteOrNull(transportation?.nearest_road_m);
  const aadt = finiteOrNull(transportation?.nearest_aadt_current);
  const stationDistanceM = finiteOrNull(transportation?.nearest_station_m);
  const trendPercent = finiteOrNull(transportation?.nearest_station_5yr_change_percent);
  const centerlines250 = finiteOrNull(transportation?.road_centerlines_within_250_ft);

  if ([roadDistanceM, aadt, stationDistanceM, trendPercent, centerlines250]
    .every((value) => value === null)) return null;

  let score = 55;
  const evidence = [];

  if (Number.isFinite(roadDistanceM)) {
    const feet = roadDistanceM * 3.280839895;
    if (feet <= 75) score += 25;
    else if (feet <= 250) score += 18;
    else if (feet <= 500) score += 8;
    else if (feet <= 1320) score -= 5;
    else if (feet <= 2640) score -= 18;
    else score -= 30;
    evidence.push(`Nearest TxDOT roadway centerline ${Math.round(feet)} ft from parcel`);
  }

  if (Number.isFinite(aadt)) {
    if (aadt >= 40_000) score += 10;
    else if (aadt >= 15_000) score += 8;
    else if (aadt >= 5_000) score += 5;
    else if (aadt < 1_000) score -= 3;
    evidence.push(`Nearest mapped AADT ${Math.round(aadt).toLocaleString('en-US')} vehicles/day`);
  }

  if (Number.isFinite(trendPercent) && Number.isFinite(stationDistanceM)) {
    const stationMiles = stationDistanceM / 1609.344;
    const proximityWeight = stationMiles <= 1 ? 1 : stationMiles <= 3 ? 0.65 : 0.35;
    const trendContribution = clamp(trendPercent / 5, -8, 8) * proximityWeight;
    score += trendContribution;
    evidence.push(`Nearest five-year TxDOT count-station change ${trendPercent.toFixed(1)}% at ${stationMiles.toFixed(2)} mi`);
  }

  if (Number.isFinite(centerlines250) && centerlines250 === 0) {
    evidence.push('No TxDOT roadway centerline mapped within 250 ft');
  }

  return Object.freeze({
    score: clamp(score, 0, 100),
    confidence: 0.55,
    source: 'TxDOT GRID roadways + AADT + five-year count-station screening',
    note: 'Mapped roadway proximity/AADT do not establish legal access, frontage, driveway approval, ROW dimensions or site-specific traffic impact.',
    evidence: Object.freeze(evidence),
  });
}

export default scoreAccessTraffic;
