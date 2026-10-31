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
    source: 'Texas Historical Commission Historic Sites Atlas',
    evidence: Object.freeze({ ...evidence }),
    requiresVerification: true,
  });
}

export function deriveCulturalFlags(metrics) {
  if (!metrics) return Object.freeze([]);

  const flags = [];
  const intersecting = finiteOrNull(metrics.cemeteries_intersecting_parcel);
  const overlapAcres = finiteOrNull(metrics.cemetery_overlap_acres);
  const overlapPercent = finiteOrNull(metrics.cemetery_overlap_percent);
  const nearestM = finiteOrNull(metrics.nearest_cemetery_m);
  const within1 = finiteOrNull(metrics.cemeteries_within_1_mi);
  const nearestName = String(metrics.nearest_cemetery_name || '').trim();

  if (Number.isFinite(intersecting) && intersecting > 0) {
    flags.push(flag({
      id: 'thc-cemetery-overlap',
      severity: 'high',
      title: 'THC cemetery geometry intersects parcel',
      detail: `${Math.round(intersecting)} public THC cemetery polygon${intersecting === 1 ? '' : 's'} intersect the tract. Verify cemetery/grave boundaries, deed/title evidence, survey conditions, access, applicable cemetery law and development setbacks before acquisition or site planning.`,
      evidence: {
        intersectingCemeteries: intersecting,
        overlapAcres,
        overlapPercent,
        nearestCemeteryName: nearestName || null,
      },
    }));
  } else if (Number.isFinite(nearestM) && nearestM <= 402.336) {
    flags.push(flag({
      id: 'thc-cemetery-adjacent',
      severity: 'medium',
      title: 'THC cemetery mapped within ¼ mile',
      detail: `The nearest public THC cemetery geometry is approximately ${(nearestM / 1609.344).toFixed(2)} miles from the tract. Confirm exact boundaries and development implications before relying on mapped separation.`,
      evidence: {
        nearestCemeteryMeters: nearestM,
        nearestCemeteryName: nearestName || null,
      },
    }));
  } else if (Number.isFinite(within1) && within1 > 0) {
    flags.push(flag({
      id: 'thc-cemetery-within-1-mi',
      severity: 'low',
      title: 'THC cemetery mapped within 1 mile',
      detail: `${Math.round(within1)} public THC cemetery record${within1 === 1 ? '' : 's'} map within 1 mile. This is contextual screening; verify exact locations if site planning, access or entitlement could be affected.`,
      evidence: {
        cemeteriesWithin1Mile: within1,
        nearestCemeteryMeters: nearestM,
      },
    }));
  }

  flags.push(flag({
    id: 'archeology-public-screen-incomplete',
    severity: 'info',
    title: 'Restricted archeology locations not publicly screened',
    detail: 'Exact Texas archeological site locations are restricted cultural-resource information and are not exposed in this public BDP screen. A clean public map must not be interpreted as archeological clearance; use qualified THC/RCRI review when project scope requires it.',
    evidence: {
      publicScreenStatus:
        metrics.archaeology_public_screen_status
        || 'restricted-location-data-not-screened',
    },
  }));

  return Object.freeze(flags);
}

export default deriveCulturalFlags;
