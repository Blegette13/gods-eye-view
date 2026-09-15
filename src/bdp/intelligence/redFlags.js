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

export function deriveBdpRedFlags({ parcel, energy, flood, wetlands, cleanups, terrain } = {}) {
  const flags = [];
  const parcelAcres = finiteOrNull(parcel?.property?.acres)
    ?? finiteOrNull(flood?.parcel_acres)
    ?? finiteOrNull(wetlands?.parcel_acres);

  const recordCurrency = String(parcel?.source?.recordCurrency || '').trim().toLowerCase();
  if (['unverified', 'stale'].includes(recordCurrency)) {
    const provider = parcel?.source?.provider || parcel?.source?.cad || 'parcel source';
    const lastVerified = parcel?.source?.lastVerified || null;
    const sourceNotice = String(parcel?.source?.sourceNotice || '').trim();
    flags.push(flag({
      id: 'parcel-source-currency-unverified',
      severity: recordCurrency === 'stale' ? 'high' : 'medium',
      title: 'Ownership / valuation source currency unverified',
      detail: sourceNotice || 'BDP retrieved the cited parcel source, but current ownership and valuation freshness have not been established. Verify against current CAD and deed/title records before acquisition decisions.',
      source: 'BDP source-quality rule',
      evidence: {
        recordCurrency,
        provider,
        lastVerified,
      },
    }));
  }

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

  const cleanupOnParcel = finiteOrNull(cleanups?.cleanup_sites_on_parcel);
  const nearestCleanupM = finiteOrNull(cleanups?.nearest_cleanup_m);
  const superfundWithin5 = finiteOrNull(cleanups?.superfund_within_5_mi);
  const rcraWithin5 = finiteOrNull(cleanups?.rcra_within_5_mi);
  const nearestSiteName = String(cleanups?.nearest_site_name || '').trim();
  const nearestHighConcern = cleanups?.nearest_is_superfund === true || cleanups?.nearest_is_rcra === true;

  if (Number.isFinite(cleanupOnParcel) && cleanupOnParcel > 0) {
    flags.push(flag({
      id: 'epa-cleanup-on-parcel',
      severity: 'high',
      title: 'EPA cleanup site mapped on parcel',
      detail: `${Math.round(cleanupOnParcel)} EPA cleanup record${cleanupOnParcel === 1 ? '' : 's'} map to the tract. Treat this as a material environmental due-diligence issue until site boundaries, cleanup status and contamination extent are reviewed.`,
      source: 'U.S. EPA Cleanups in My Community',
      evidence: {
        cleanupSitesOnParcel: cleanupOnParcel,
        nearestSiteName: nearestSiteName || null,
      },
    }));
  } else if (Number.isFinite(nearestCleanupM) && nearestCleanupM <= 1609.344) {
    const miles = nearestCleanupM / 1609.344;
    flags.push(flag({
      id: 'nearby-epa-cleanup',
      severity: nearestHighConcern && miles <= 0.5 ? 'high' : 'medium',
      title: 'EPA cleanup site near parcel',
      detail: `${nearestSiteName || 'The nearest EPA cleanup site'} is approximately ${miles.toFixed(2)} miles from the tract. Review the cleanup program, status, migration pathway and site-specific records before acquisition conclusions.`,
      source: 'U.S. EPA Cleanups in My Community',
      evidence: {
        nearestCleanupMeters: nearestCleanupM,
        nearestSiteName: nearestSiteName || null,
        nearestIsSuperfund: cleanups?.nearest_is_superfund === true,
        nearestIsRcra: cleanups?.nearest_is_rcra === true,
      },
    }));
  }

  if (Number.isFinite(superfundWithin5) && superfundWithin5 > 0 && !(Number.isFinite(cleanupOnParcel) && cleanupOnParcel > 0)) {
    flags.push(flag({
      id: 'superfund-within-5-mi',
      severity: 'medium',
      title: 'Superfund site within 5 miles',
      detail: `${Math.round(superfundWithin5)} EPA Superfund site${superfundWithin5 === 1 ? '' : 's'} are mapped within 5 miles of the tract. Proximity alone does not establish parcel contamination, but warrants environmental review.`,
      source: 'U.S. EPA Cleanups in My Community',
      evidence: { superfundWithin5Miles: superfundWithin5 },
    }));
  }

  if (Number.isFinite(rcraWithin5) && rcraWithin5 > 0 && !Number.isFinite(superfundWithin5)) {
    flags.push(flag({
      id: 'rcra-cleanup-within-5-mi',
      severity: 'low',
      title: 'RCRA corrective-action site within 5 miles',
      detail: `${Math.round(rcraWithin5)} RCRA corrective-action site${rcraWithin5 === 1 ? '' : 's'} are mapped within 5 miles. Review only if location/pathway context makes the site relevant to the tract.`,
      source: 'U.S. EPA Cleanups in My Community',
      evidence: { rcraWithin5Miles: rcraWithin5 },
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
