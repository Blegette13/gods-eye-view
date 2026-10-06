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
    source: 'Texas Commission on Environmental Quality municipal-solid-waste data',
    evidence: Object.freeze({ ...evidence }),
    requiresVerification: true,
  });
}

export function deriveMswFlags(msw) {
  if (!msw) return Object.freeze([]);

  const flags = [];
  if (msw.coverage_complete === false) {
    flags.push(flag({
      id: 'tceq-msw-coverage-incomplete',
      severity: 'info',
      title: 'TCEQ MSW coverage incomplete or stale',
      detail: 'One or more snapshots are missing/stale or contain unlocated records. Mapped-site flags remain useful, but zero proximity counts do not provide clearance and MSW scoring is withheld.',
      evidence: { coverage: msw.coverage || null },
    }));
  }
  const onParcel = finiteOrNull(msw.msw_points_on_parcel);
  const active1 = finiteOrNull(msw.active_landfills_within_1_mi);
  const active3 = finiteOrNull(msw.active_landfills_within_3_mi);
  const closed1 = finiteOrNull(msw.closed_sites_within_1_mi);
  const closed3 = finiteOrNull(msw.closed_sites_within_3_mi);
  const unauthorized1 = finiteOrNull(msw.unauthorized_sites_within_1_mi);
  const unauthorized3 = finiteOrNull(msw.unauthorized_sites_within_3_mi);
  const hazardous3 = finiteOrNull(msw.hazardous_history_sites_within_3_mi);
  const nearestM = finiteOrNull(msw.nearest_msw_site_m);
  const nearestName = String(msw.nearest_site_name || '').trim();

  if (Number.isFinite(onParcel) && onParcel > 0) {
    flags.push(flag({
      id: 'tceq-msw-point-on-parcel',
      severity: 'high',
      title: 'TCEQ MSW point mapped on parcel',
      detail: `${Math.round(onParcel)} TCEQ municipal-solid-waste point${onParcel === 1 ? '' : 's'} map inside the parcel polygon. Published coordinates may be a gate, benchmark, centroid, or other point, so verify facility/waste boundaries and records before treating this as on-tract disposal area.`,
      evidence: {
        pointsOnParcel: onParcel,
        nearestSiteName: nearestName || null,
      },
    }));
  }

  if (Number.isFinite(active1) && active1 > 0) {
    flags.push(flag({
      id: 'active-landfill-within-1-mi',
      severity: 'high',
      title: 'Active TCEQ landfill within 1 mile',
      detail: `${Math.round(active1)} active TCEQ landfill${active1 === 1 ? '' : 's'} map within 1 mile. Review traffic, odor, vectors, compatibility, groundwater/surface-water pathways, operating records and site-specific separation before acquisition conclusions.`,
      evidence: { activeLandfillsWithin1Mile: active1, nearestSiteMeters: nearestM },
    }));
  } else if (Number.isFinite(active3) && active3 > 0) {
    flags.push(flag({
      id: 'active-landfill-within-3-mi',
      severity: 'medium',
      title: 'Active TCEQ landfill within 3 miles',
      detail: `${Math.round(active3)} active TCEQ landfill${active3 === 1 ? '' : 's'} map within 3 miles. Proximity does not establish parcel contamination but can affect land-use compatibility and due diligence.`,
      evidence: { activeLandfillsWithin3Miles: active3, nearestSiteMeters: nearestM },
    }));
  }

  if (Number.isFinite(unauthorized1) && unauthorized1 > 0) {
    flags.push(flag({
      id: 'historical-unauthorized-dump-within-1-mi',
      severity: 'high',
      title: 'Historical unauthorized/unnumbered waste site within 1 mile',
      detail: `${Math.round(unauthorized1)} historical unnumbered or unauthorized TCEQ waste-site record${unauthorized1 === 1 ? '' : 's'} map within 1 mile. Review the underlying historical record and environmental pathway before relying on the tract for development.`,
      evidence: { unauthorizedSitesWithin1Mile: unauthorized1 },
    }));
  } else if (Number.isFinite(unauthorized3) && unauthorized3 > 0) {
    flags.push(flag({
      id: 'historical-unauthorized-dump-within-3-mi',
      severity: 'medium',
      title: 'Historical unauthorized/unnumbered waste site within 3 miles',
      detail: `${Math.round(unauthorized3)} historical unnumbered or unauthorized TCEQ waste-site record${unauthorized3 === 1 ? '' : 's'} map within 3 miles. Treat as a records-review trigger rather than proof of current contamination.`,
      evidence: { unauthorizedSitesWithin3Miles: unauthorized3 },
    }));
  }

  if (Number.isFinite(hazardous3) && hazardous3 > 0) {
    flags.push(flag({
      id: 'historical-msw-hazardous-history-within-3-mi',
      severity: 'medium',
      title: 'Historical MSW site with hazardous-waste history nearby',
      detail: `${Math.round(hazardous3)} historical TCEQ MSW record${hazardous3 === 1 ? '' : 's'} within 3 miles is coded as confirmed or probable hazardous-waste acceptance. Verify the record, site location, closure history and environmental pathway; proximity alone does not establish impact to this parcel.`,
      evidence: { hazardousHistorySitesWithin3Miles: hazardous3 },
    }));
  }

  if (Number.isFinite(closed1) && closed1 > 0) {
    flags.push(flag({
      id: 'closed-msw-site-within-1-mi',
      severity: 'medium',
      title: 'Closed TCEQ MSW site within 1 mile',
      detail: `${Math.round(closed1)} closed/post-closure TCEQ MSW site${closed1 === 1 ? '' : 's'} map within 1 mile. Review closure/post-closure records and exact site boundary before development conclusions.`,
      evidence: { closedSitesWithin1Mile: closed1 },
    }));
  } else if (Number.isFinite(closed3) && closed3 > 0) {
    flags.push(flag({
      id: 'closed-msw-site-within-3-mi',
      severity: 'low',
      title: 'Closed TCEQ MSW site within 3 miles',
      detail: `${Math.round(closed3)} closed/post-closure TCEQ MSW site${closed3 === 1 ? '' : 's'} map within 3 miles. Review if site location or environmental pathways make it relevant to the tract.`,
      evidence: { closedSitesWithin3Miles: closed3 },
    }));
  }

  return Object.freeze(flags);
}

export default deriveMswFlags;
