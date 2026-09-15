const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1, info: 0 });

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function flag({ id, severity, title, detail, source, evidence = {}, requiresVerification = true }) {
  return Object.freeze({
    id,
    severity,
    title,
    detail,
    source,
    evidence: Object.freeze({ ...evidence }),
    requiresVerification,
  });
}

function percentOf(acres, parcelAcres) {
  if (!Number.isFinite(acres) || !Number.isFinite(parcelAcres) || parcelAcres <= 0) return null;
  return (acres / parcelAcres) * 100;
}

export function deriveBdpRedFlags({ parcel, energy, flood, wetlands, terrain } = {}) {
  const flags = [];
  const parcelAcres = finiteOrNull(parcel?.property?.acres)
    ?? finiteOrNull(flood?.parcel_acres)
    ?? finiteOrNull(wetlands?.parcel_acres);

  const pipelineCrossings = finiteOrNull(energy?.pipeline_crossing_count);
  const pipelineLengthM = finiteOrNull(energy?.pipeline_length_on_parcel_m);
  if (Number.isFinite(pipelineCrossings) && pipelineCrossings > 0) {
    flags.push(flag({
      id: 'pipeline-crossing',
      severity: 'high',
      title: 'Mapped pipeline crosses parcel',
      detail: `${Math.round(pipelineCrossings)} mapped RRC pipeline segment${pipelineCrossings === 1 ? '' : 's'} intersect the tract. Easement dimensions and legal rights require title/survey verification.`,
      source: 'Railroad Commission of Texas GIS',
      evidence: {
        crossingCount: pipelineCrossings,
        mappedLengthMeters: pipelineLengthM,
      },
    }));
  }

  const nearestWellM = finiteOrNull(energy?.nearest_well_m);
  if (Number.isFinite(nearestWellM) && nearestWellM <= 500) {
    flags.push(flag({
      id: 'nearby-rrc-well',
      severity: nearestWellM <= 150 ? 'medium' : 'low',
      title: 'Oil/gas well mapped near parcel',
      detail: `The nearest mapped RRC well is approximately ${Math.round(nearestWellM)} meters from the tract. Confirm status, access, setbacks and any associated surface-use rights.`,
      source: 'Railroad Commission of Texas GIS',
      evidence: { nearestWellMeters: nearestWellM },
    }));
  }

  const floodwayAcres = finiteOrNull(flood?.floodway_acres);
  const sfhaAcres = finiteOrNull(flood?.sfha_acres);
  const mappedFloodPercent = finiteOrNull(flood?.mapped_flood_percent);
  if (Number.isFinite(floodwayAcres) && floodwayAcres > 0) {
    flags.push(flag({
      id: 'fema-floodway',
      severity: 'high',
      title: 'Mapped FEMA floodway on parcel',
      detail: `Approximately ${floodwayAcres.toFixed(2)} acres overlap mapped floodway. Development constraints can be substantial and require local floodplain review.`,
      source: 'FEMA National Flood Hazard Layer',
      evidence: {
        floodwayAcres,
        parcelPercent: percentOf(floodwayAcres, parcelAcres),
      },
    }));
  }
  if (Number.isFinite(sfhaAcres) && sfhaAcres > 0) {
    const sfhaPercent = percentOf(sfhaAcres, parcelAcres);
    flags.push(flag({
      id: 'fema-sfha',
      severity: Number.isFinite(sfhaPercent) && sfhaPercent >= 25 ? 'high' : 'medium',
      title: 'Special Flood Hazard Area overlaps parcel',
      detail: `Approximately ${sfhaAcres.toFixed(2)} acres overlap mapped FEMA SFHA. Verify current effective mapping, base-flood conditions and local requirements.`,
      source: 'FEMA National Flood Hazard Layer',
      evidence: { sfhaAcres, parcelPercent: sfhaPercent },
    }));
  } else if (Number.isFinite(mappedFloodPercent) && mappedFloodPercent >= 25) {
    flags.push(flag({
      id: 'fema-mapped-flood-high-share',
      severity: 'medium',
      title: 'Large mapped flood share',
      detail: `${mappedFloodPercent.toFixed(1)}% of the parcel overlaps mapped FEMA flood-hazard polygons.`,
      source: 'FEMA National Flood Hazard Layer',
      evidence: { mappedFloodPercent },
    }));
  }

  const nwiAcres = finiteOrNull(wetlands?.nwi_mapped_acres);
  const nwiPercent = finiteOrNull(wetlands?.nwi_percent);
  if (Number.isFinite(nwiAcres) && nwiAcres > 0) {
    flags.push(flag({
      id: 'nwi-wetlands',
      severity: Number.isFinite(nwiPercent) && nwiPercent >= 20 ? 'high' : 'medium',
      title: 'NWI-mapped wetlands overlap parcel',
      detail: `${nwiAcres.toFixed(2)} acres${Number.isFinite(nwiPercent) ? ` (${nwiPercent.toFixed(1)}%)` : ''} overlap National Wetlands Inventory polygons. NWI is screening data and does not establish federal jurisdiction.`,
      source: 'U.S. Fish & Wildlife Service National Wetlands Inventory',
      evidence: { nwiAcres, nwiPercent },
    }));
  }

  const meanSlope = finiteOrNull(terrain?.slope?.meanDegrees);
  const maxSlope = finiteOrNull(terrain?.slope?.maxDegrees);
  if ((Number.isFinite(meanSlope) && meanSlope >= 10) || (Number.isFinite(maxSlope) && maxSlope >= 25)) {
    const high = (Number.isFinite(meanSlope) && meanSlope >= 20)
      || (Number.isFinite(maxSlope) && maxSlope >= 35);
    flags.push(flag({
      id: 'steep-terrain',
      severity: high ? 'high' : 'medium',
      title: 'Steep terrain screening indicator',
      detail: `3DEP screening shows${Number.isFinite(meanSlope) ? ` mean slope ${meanSlope.toFixed(1)}°` : ''}${Number.isFinite(maxSlope) ? ` and maximum slope ${maxSlope.toFixed(1)}°` : ''}. Site-specific engineering/topographic survey is required for development conclusions.`,
      source: 'USGS 3D Elevation Program',
      evidence: { meanSlopeDegrees: meanSlope, maxSlopeDegrees: maxSlope },
    }));
  }

  // These are deliberately always unresolved until title/legal evidence is
  // connected. GIS proximity must never be used as a proxy for ownership.
  flags.push(flag({
    id: 'mineral-rights-unverified',
    severity: 'info',
    title: 'Mineral-right ownership not verified',
    detail: 'Oil/gas mapping does not establish who owns the mineral estate. Title/mineral research remains required.',
    source: 'BDP due-diligence rule',
    requiresVerification: true,
  }));
  flags.push(flag({
    id: 'water-rights-ownership-unverified',
    severity: 'info',
    title: 'Water-right ownership not verified',
    detail: 'Nearby diversion points or water-right records do not establish that a water right belongs to the parcel owner.',
    source: 'BDP due-diligence rule',
    requiresVerification: true,
  }));

  return Object.freeze(flags.sort((a, b) => {
    const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    return severity || a.id.localeCompare(b.id);
  }));
}

export function summarizeBdpRedFlags(flags = []) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const item of flags) {
    if (Object.hasOwn(counts, item?.severity)) counts[item.severity] += 1;
  }
  const blockingCount = counts.critical + counts.high;
  return Object.freeze({
    total: flags.length,
    ...counts,
    blockingCount,
    highestSeverity: ['critical', 'high', 'medium', 'low', 'info']
      .find((severity) => counts[severity] > 0) || null,
  });
}
