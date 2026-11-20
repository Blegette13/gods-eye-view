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
    source: 'Texas Commission on Environmental Quality surface-water-rights GIS',
    evidence: Object.freeze({ ...evidence }),
    requiresVerification: true,
  });
}

/**
 * TCEQ mapped water-right points are authorization-location evidence only.
 * Proximity never establishes that the parcel owner holds or may exercise the
 * right, and it does not establish water availability for a new project.
 */
export function deriveWaterRightsFlags(metrics) {
  if (!metrics) return Object.freeze([]);

  const flags = [];
  const onParcel = finiteOrNull(metrics.water_right_points_on_parcel);
  const withinOne = finiteOrNull(metrics.water_right_points_within_1_mi);
  const withinFive = finiteOrNull(metrics.water_right_points_within_5_mi);
  const distinctFive = finiteOrNull(metrics.distinct_water_rights_within_5_mi);
  const nearestM = finiteOrNull(metrics.nearest_water_right_point_m);

  if (Number.isFinite(onParcel) && onParcel > 0) {
    flags.push(flag({
      id: 'tceq-water-right-point-on-parcel',
      severity: 'medium',
      title: 'Mapped surface-water-right point on parcel',
      detail: `${Math.round(onParcel)} TCEQ water-right point${onParcel === 1 ? '' : 's'} map on the tract. Verify the authorization, holder, access rights, diversion location and whether any right conveys with the property before acquisition or development decisions.`,
      evidence: {
        pointsOnParcel: onParcel,
        distinctRightsWithin5Miles: distinctFive,
      },
    }));
  } else if (Number.isFinite(withinOne) && withinOne > 0) {
    flags.push(flag({
      id: 'tceq-water-right-point-nearby',
      severity: 'low',
      title: 'Mapped surface-water-right point within 1 mile',
      detail: `${Math.round(withinOne)} TCEQ water-right point${withinOne === 1 ? '' : 's'} map within 1 mile of the tract. Nearby points are contextual only and do not establish parcel ownership, access or available supply.`,
      evidence: {
        pointsWithin1Mile: withinOne,
        nearestPointMeters: nearestM,
      },
    }));
  }

  if (Number.isFinite(withinFive) || Number.isFinite(distinctFive)) {
    flags.push(flag({
      id: 'tceq-water-right-ownership-unverified',
      severity: 'info',
      title: 'Surface-water-right ownership / availability unverified',
      detail: 'Mapped TCEQ points and nearby water-right records do not establish that the parcel owner holds a transferable right or that water is available for the intended development. Verify current TCEQ authorization/ownership and title evidence.',
      evidence: {
        pointsWithin5Miles: withinFive,
        distinctRightsWithin5Miles: distinctFive,
      },
    }));
  }

  return Object.freeze(flags);
}

export default deriveWaterRightsFlags;
