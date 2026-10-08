export const BDP_SCREENING_SOURCE_LABELS = Object.freeze({
  energy: 'RRC wells / pipelines',
  flood: 'FEMA flood mapping',
  wetlands: 'USFWS NWI wetlands',
  cleanups: 'EPA cleanup records',
  msw: 'TCEQ MSW records',
  soils: 'SSURGO soils',
  terrain: 'USGS terrain',
  transportation: 'TxDOT roads / traffic',
  utilities: 'Utility screening',
  waterRights: 'TCEQ water-right points',
  cemeteries: 'THC cultural screening',
  entitlement: 'Entitlement screening',
  growthRadar: 'Growth Radar',
  developmentConstraints: 'Combined development constraints',
});

// Describe returned evidence, not GIS inventory completeness or legal clearance.
// Deliberately derive from the snapshot rather than caller-provided status rows.
export function describeBdpSourceCoverage(source, metrics, error) {
  const label = BDP_SCREENING_SOURCE_LABELS[source] || source;
  if (error) return Object.freeze({ source, label, status: 'unavailable',
    detail: 'Source screening failed; restore the feed and re-screen.' });
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)
    || Object.keys(metrics).length === 0) {
    return Object.freeze({ source, label, status: 'unknown', detail: 'No source evidence returned.' });
  }

  const limitations = [];
  if ((['flood', 'msw'].includes(source) && metrics.coverage_complete !== true)
    || metrics.coverage_complete === false) {
    limitations.push('Coverage is incomplete or unverified; zero counts cannot establish clearance.');
  }
  if (source === 'utilities') {
    for (const [field, name] of [
      ['water_service_source_status', 'Water-service boundaries'],
      ['water_ccn_source_status', 'Archived water CCN'],
      ['transmission_source_status', 'Archived transmission'],
    ]) {
      if (metrics[field] === 'unavailable') limitations.push(`${name}: source unavailable.`);
    }
    for (const [field, name] of [
      ['puct_water_ccn_coverage', 'Current PUCT water CCN'],
      ['sewer_ccn_coverage', 'Current PUCT sewer CCN'],
    ]) {
      if (metrics[field] && metrics[field] !== 'mapped-snapshot') {
        limitations.push(`${name}: snapshot missing, stale or unverified.`);
      }
    }
  }
  if (source === 'entitlement' && metrics.jurisdiction_screen === 'outside-or-unresolved') {
    limitations.push('San Antonio mapping does not resolve this parcel’s jurisdiction; obtain the responsible authority’s records.');
  }
  return Object.freeze({ source, label, status: limitations.length ? 'limited' : 'returned',
    detail: limitations.length ? limitations.join(' ') : 'Screening evidence returned; completeness and legal facts remain unverified.' });
}

export function buildBdpSourceCoverage(sources, evidence = {}, errors = {}) {
  return Object.freeze(Object.fromEntries(sources.map((source) => [source,
    describeBdpSourceCoverage(source, evidence[source], errors[source]),
  ])));
}
