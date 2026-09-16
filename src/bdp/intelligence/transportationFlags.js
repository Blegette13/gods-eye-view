function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function flag({ id, severity, title, detail, evidence = {}, requiresVerification = true }) {
  return Object.freeze({
    id,
    severity,
    title,
    detail,
    source: 'Texas Department of Transportation GIS',
    evidence: Object.freeze({ ...evidence }),
    requiresVerification,
  });
}

/**
 * TxDOT road centerlines and traffic counts are screening evidence only.
 * They do not prove legal ingress/egress, frontage, curb-cut eligibility,
 * driveway permits, or public/private road rights.
 */
export function deriveAccessTrafficFlags(transportation) {
  if (!transportation) return Object.freeze([]);

  const flags = [];
  const nearestRoadM = finiteOrNull(transportation.nearest_road_m);
  const centerlines250 = finiteOrNull(transportation.road_centerlines_within_250_ft);
  const aadt = finiteOrNull(transportation.nearest_aadt_current);
  const stationDistanceM = finiteOrNull(transportation.nearest_station_m);
  const trendPercent = finiteOrNull(transportation.nearest_station_5yr_change_percent);

  // Always preserve the legal-access verification step when TxDOT evidence exists.
  flags.push(flag({
    id: 'legal-access-unverified',
    severity: 'info',
    title: 'Legal access / frontage not verified',
    detail: 'TxDOT roadway proximity does not establish legal ingress/egress, ROW frontage, driveway approval, curb-cut rights, or private-road access. Confirm through title, survey and the controlling road authority.',
    evidence: {
      nearestRoadMeters: nearestRoadM,
      mappedCenterlinesWithin250Ft: centerlines250,
    },
  }));

  if (Number.isFinite(nearestRoadM)) {
    const feet = nearestRoadM * 3.280839895;
    if (feet > 2640) {
      flags.push(flag({
        id: 'roadway-proximity-poor',
        severity: 'high',
        title: 'Mapped roadway is more than 0.5 mile away',
        detail: `The nearest TxDOT roadway centerline is approximately ${Math.round(feet).toLocaleString('en-US')} ft from the parcel. Verify whether the tract has legal access through another public/private route before treating it as developable access.`,
        evidence: { nearestRoadMeters: nearestRoadM },
      }));
    } else if (feet > 500) {
      flags.push(flag({
        id: 'roadway-proximity-review',
        severity: 'medium',
        title: 'Mapped roadway access needs review',
        detail: `The nearest TxDOT roadway centerline is approximately ${Math.round(feet).toLocaleString('en-US')} ft from the parcel. This does not prove the tract lacks access, but it warrants survey/title review of ingress and frontage.`,
        evidence: { nearestRoadMeters: nearestRoadM },
      }));
    }
  }

  if (Number.isFinite(centerlines250) && centerlines250 === 0) {
    flags.push(flag({
      id: 'no-txdot-centerline-within-250-ft',
      severity: 'low',
      title: 'No TxDOT roadway centerline within 250 ft',
      detail: 'No TxDOT roadway centerline was mapped within 250 ft of the tract in this screening. Local/private roads may still exist and must be checked separately.',
      evidence: { mappedCenterlinesWithin250Ft: 0 },
    }));
  }

  if (Number.isFinite(aadt) && aadt >= 50_000) {
    flags.push(flag({
      id: 'high-traffic-corridor',
      severity: 'info',
      title: 'High-volume traffic corridor nearby',
      detail: `The nearest mapped TxDOT AADT segment carries approximately ${Math.round(aadt).toLocaleString('en-US')} vehicles/day. This can support visibility-oriented uses but may also increase access-control, turning-movement and traffic-impact requirements.`,
      evidence: { nearestAadt: aadt },
    }));
  }

  if (
    Number.isFinite(trendPercent)
    && Number.isFinite(stationDistanceM)
    && stationDistanceM <= 4828.032
    && trendPercent <= -15
  ) {
    flags.push(flag({
      id: 'nearby-traffic-decline',
      severity: 'low',
      title: 'Nearby count station shows traffic decline',
      detail: `The nearest five-year TxDOT count station within 3 miles shows approximately ${trendPercent.toFixed(1)}% change over the available five-year series. Station trend is contextual and is not necessarily the trend of the road segment adjoining the tract.`,
      evidence: {
        stationDistanceMeters: stationDistanceM,
        fiveYearChangePercent: trendPercent,
      },
    }));
  }

  return Object.freeze(flags);
}

export default deriveAccessTrafficFlags;
