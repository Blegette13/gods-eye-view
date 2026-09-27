function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Preliminary Utilities / Infrastructure component.
 *
 * A mapped water-service boundary or CCN is useful screening evidence, but it
 * does not establish available capacity, tap rights, meter availability,
 * extension cost, wastewater service, electric distribution capacity, or a
 * utility's willingness/obligation to serve a particular development program.
 */
export function scoreUtilitiesInfrastructure(utilities) {
  if (!utilities) return null;

  const serviceOverlap = finiteOrNull(utilities.water_service_overlap_percent);
  const ccnOverlap = finiteOrNull(utilities.water_ccn_overlap_percent);
  const nearestTransmissionM = finiteOrNull(utilities.nearest_transmission_m);
  const transmissionCrossings = finiteOrNull(utilities.transmission_crossing_count);

  if ([serviceOverlap, ccnOverlap, nearestTransmissionM, transmissionCrossings]
    .every((value) => value === null)) return null;

  let score = 45;
  const evidence = [];

  if (Number.isFinite(serviceOverlap)) {
    if (serviceOverlap >= 90) score += 30;
    else if (serviceOverlap >= 50) score += 22;
    else if (serviceOverlap > 0) score += 10;
    else score -= 15;
    evidence.push(`Mapped current water-service boundary overlap ${serviceOverlap.toFixed(1)}%`);
  }

  if (Number.isFinite(ccnOverlap)) {
    if (ccnOverlap >= 90) score += 15;
    else if (ccnOverlap > 0) score += 8;
    else score -= 5;
    evidence.push(`Mapped water CCN overlap ${ccnOverlap.toFixed(1)}%`);
  }

  if (Number.isFinite(nearestTransmissionM)) {
    const miles = nearestTransmissionM / 1609.344;
    evidence.push(`Archived high-voltage transmission screening line ${miles.toFixed(2)} mi from parcel`);
    if (miles <= 1) score += 4;
    else if (miles > 5) score -= 2;
  }

  if (Number.isFinite(transmissionCrossings) && transmissionCrossings > 0) {
    score -= 12;
    evidence.push(`${Math.round(transmissionCrossings)} archived mapped transmission line crossing${transmissionCrossings === 1 ? '' : 's'}`);
  }

  return Object.freeze({
    score: clamp(score, 0, 100),
    confidence: 0.38,
    source: 'TWDB public-water service boundaries + PUCT water CCN + archived U.S. Government transmission screening',
    note: 'This is utility screening only. Confirm water/wastewater capacity, taps, extension cost, electric distribution service/capacity, easements and provider commitments directly with the responsible utilities.',
    evidence: Object.freeze(evidence),
  });
}

export default scoreUtilitiesInfrastructure;
