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
    source: 'City of San Antonio Growth Radar screening',
    evidence: Object.freeze({ ...evidence }),
    requiresVerification: true,
  });
}

export function deriveGrowthRadarFlags(metrics) {
  if (!metrics) return Object.freeze([]);

  const flags = [];
  const mtpCrossings = finiteOrNull(metrics.mtp_crossing_count);
  const proposedMtp5 = finiteOrNull(metrics.mtp_proposed_or_changed_within_5_mi);
  const platsOnParcel = finiteOrNull(metrics.preliminary_plats_on_parcel);
  const plats5 = finiteOrNull(metrics.preliminary_plats_within_5_mi);
  const center5 = finiteOrNull(metrics.regional_centers_within_5_mi);

  if (Number.isFinite(mtpCrossings) && mtpCrossings > 0) {
    flags.push(flag({
      id: 'mtp-corridor-crosses-parcel',
      severity: 'medium',
      title: 'Major Thoroughfare Plan corridor crosses parcel',
      detail: 'A City Major Thoroughfare Plan line intersects the tract. MTP mapping is planning/ROW-acquisition evidence, not a surveyed taking; verify alignment, proposed right-of-way, ordinance status and development dedication requirements.',
      evidence: {
        crossingCount: mtpCrossings,
        nearestStreet: metrics.nearest_mtp_street || null,
        currentRow: metrics.nearest_mtp_current_row || null,
        proposedRow: metrics.nearest_mtp_proposed_row || null,
      },
    }));
  }

  if (Number.isFinite(proposedMtp5) && proposedMtp5 > 0) {
    flags.push(flag({
      id: 'planned-mobility-change-within-5-mi',
      severity: 'low',
      title: 'Planned/changed thoroughfare activity within 5 miles',
      detail: `${Math.round(proposedMtp5)} MTP corridor${proposedMtp5 === 1 ? '' : 's'} within 5 miles screen as proposed/changed. This can be a growth/access signal but does not establish funding, timing or final alignment.`,
      evidence: { proposedOrChangedMtpWithin5Miles: proposedMtp5 },
    }));
  }

  if (Number.isFinite(platsOnParcel) && platsOnParcel > 0) {
    flags.push(flag({
      id: 'preliminary-plat-on-parcel',
      severity: 'medium',
      title: 'Preliminary plat mapped on parcel',
      detail: 'A City preliminary-plat polygon intersects the tract. Review the plat application/status, ownership relationship, approvals, dedications and whether the mapped preliminary plat remains active/current before acquisition conclusions.',
      evidence: {
        preliminaryPlatsOnParcel: platsOnParcel,
        nearestPlatName: metrics.nearest_preliminary_plat_name || null,
        nearestPlatNumber: metrics.nearest_preliminary_plat_number || null,
      },
    }));
  } else if (Number.isFinite(plats5) && plats5 > 0) {
    flags.push(flag({
      id: 'preliminary-plat-activity-within-5-mi',
      severity: 'info',
      title: 'Preliminary-plat activity within 5 miles',
      detail: `${Math.round(plats5)} preliminary plat${plats5 === 1 ? '' : 's'} are mapped within 5 miles. Treat this as development-activity context only; preliminary plats do not guarantee construction or timing.`,
      evidence: { preliminaryPlatsWithin5Miles: plats5 },
    }));
  }

  if (Number.isFinite(center5) && center5 > 0) {
    flags.push(flag({
      id: 'regional-center-within-5-mi',
      severity: 'info',
      title: 'SA Tomorrow regional-center context within 5 miles',
      detail: 'The parcel is within 5 miles of a mapped regional-center planning area. Use this as long-range planning context, not a guarantee of investment or entitlement.',
      evidence: {
        regionalCentersWithin5Miles: center5,
        nearestCenter: metrics.nearest_regional_center_name || null,
      },
    }));
  }

  return Object.freeze(flags);
}

export default deriveGrowthRadarFlags;
