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
    source: 'BDP utilities screening',
    evidence: Object.freeze({ ...evidence }),
    requiresVerification: true,
  });
}

export function deriveUtilitiesFlags(utilities) {
  if (!utilities) return Object.freeze([]);

  const flags = [];
  const serviceOverlap = finiteOrNull(utilities.water_service_overlap_percent);
  const ccnOverlap = finiteOrNull(utilities.water_ccn_overlap_percent);
  const crossings = finiteOrNull(utilities.transmission_crossing_count);
  const lineLengthM = finiteOrNull(utilities.transmission_length_on_parcel_m);

  flags.push(flag({
    id: 'utility-capacity-unverified',
    severity: 'info',
    title: 'Utility capacity / connection not verified',
    detail: 'Mapped service territory does not confirm water, wastewater or electric capacity, tap/meter availability, extension cost, impact fees, or provider commitment. Obtain provider will-serve/capacity confirmation for the intended project.',
  }));

  if (Number.isFinite(serviceOverlap) && serviceOverlap === 0) {
    flags.push(flag({
      id: 'no-current-water-service-boundary-overlap',
      severity: Number.isFinite(ccnOverlap) && ccnOverlap > 0 ? 'medium' : 'high',
      title: 'No mapped current water-service boundary overlap',
      detail: Number.isFinite(ccnOverlap) && ccnOverlap > 0
        ? 'The parcel intersects a mapped water CCN but not TWDB’s current retail water-service boundary. Confirm whether extension/service is feasible and who would serve the tract.'
        : 'The parcel does not intersect the mapped current retail water-service boundary in this screen. Confirm nearby providers, wells, extensions and other lawful water-supply options before assuming development service.',
      evidence: {
        waterServiceOverlapPercent: serviceOverlap,
        waterCcnOverlapPercent: ccnOverlap,
      },
    }));
  }

  if (Number.isFinite(crossings) && crossings > 0) {
    flags.push(flag({
      id: 'archived-transmission-line-crossing',
      severity: 'high',
      title: 'Archived high-voltage transmission line crosses parcel',
      detail: 'A public U.S. Government transmission dataset archived in 2024 maps a high-voltage line across the tract. Treat location as screening only and verify current line location, easement width, owner and development restrictions with survey/title and the utility.',
      evidence: {
        mappedCrossings: crossings,
        mappedLengthMeters: lineLengthM,
        dataCurrency: 'archived-2024',
      },
    }));
  }

  return Object.freeze(flags);
}

export default deriveUtilitiesFlags;
