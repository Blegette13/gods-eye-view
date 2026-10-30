import { ACQUISITION_COST_FIELDS, evaluateAcquisitionEconomics } from '../economics/acquisitionEconomics.js';
import { fetchBdpParcelIntelligence } from '../intelligence/client.js';
import { buildOwnershipTitleReview, TITLE_REVIEW_REFERENCES } from '../title/ownershipReview.js';
import { eligibleForAustinGisPilot } from '../intelligence/regionScope.js';
import { AUSTIN_REGULATORY_REFERENCES, buildAustinRegulatoryReview } from '../entitlement/austinRegulatoryReview.js';
import { buildAustinRegulatoryDueDiligence } from '../entitlement/austinRegulatoryDueDiligence.js';
import { reviewReportedValuation, VALUATION_REVIEW_NOTICE } from '../valuation/valuationReview.js';
import { reviewReportedAcreage } from '../valuation/acreageReview.js';

function formatMoney(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(number);
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(number);
}

function formatMiles(meters) {
  if (meters === null || meters === undefined || meters === '' || typeof meters === 'boolean') return '—';
  const number = Number(meters);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number / 1609.344, 2)} mi`;
}

// Two-decimal miles can round a genuine nearby feature to a misleading "0 mi".
function formatNearbyDistance(meters) {
  if (meters === null || meters === undefined || meters === '' || typeof meters === 'boolean') return '—';
  const number = Number(meters);
  if (!Number.isFinite(number) || number < 0) return '—';
  if (number < 160.9344) {
    const feet = number * 3.280839895;
    return feet > 0 && feet < 1 ? '<1 ft' : `${formatNumber(feet, 0)} ft`;
  }
  return formatMiles(number);
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number, 1)}%`;
}

/**
 * Display mapped GIS intersection shares without rounding a nonzero sliver
 * to zero (or nearly-full coverage to an unjustified 100%).
 * This is presentation precision, NOT a spatial tolerance or legal verdict.
 */
function formatMappedIntersectionPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return '—';
  if (value > 0 && value < 0.1) return '<0.1%';
  if (value >= 99.95 && value < 100) return '<100%';
  return formatPercent(value);
}

function formatAcres(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number, 2)} ac`;
}

function formatFeet(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number, 0)} ft`;
}

function formatDistanceFeetFromMeters(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number * 3.280839895, 0)} ft`;
}

function formatDegrees(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number, 1)}°`;
}

function formatVehicles(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number, 0)} / day`;
}

function row(label, value) {
  const wrapper = document.createElement('div');
  wrapper.className = 'bdp-property-row';

  const key = document.createElement('span');
  key.className = 'bdp-property-key';
  key.textContent = label;

  const content = document.createElement('span');
  content.className = 'bdp-property-value';
  content.textContent = value === 0 ? '0' : (value || '—');

  wrapper.append(key, content);
  return wrapper;
}

function sectionHeading(text) {
  const heading = document.createElement('div');
  heading.className = 'bdp-property-section-heading';
  heading.textContent = text;
  return heading;
}

// Native, keyboard-accessible disclosure keeps the 20+ evidence sections
// discoverable without requiring customers to scroll through every GIS feed.
// Existing evidence rows, source metadata and async containers are unchanged.
function propertyEvidenceGroup(label, entries, { expanded = false } = {}) {
  const group = document.createElement('details');
  group.className = 'bdp-property-evidence-group';
  group.open = expanded;

  const summary = document.createElement('summary');
  summary.className = 'bdp-property-evidence-summary';
  summary.textContent = label;

  const content = document.createElement('div');
  content.className = 'bdp-property-evidence-content';
  content.append(...entries);

  group.append(summary, content);
  return group;
}

function sourceErrorLabel(error, source) {
  if (!error) return 'No data returned';
  if (error.status === 503) return 'PostGIS not configured';
  if (error.status === 502) return `${source} temporarily unavailable`;
  return 'Screening unavailable';
}

function sourceQualityRows(parcel) {
  const currency = String(parcel.source?.recordCurrency || 'unknown').toLowerCase();
  const currencyRow = row('Record currency', currency.replaceAll('-', ' ').toUpperCase());
  currencyRow.dataset.bdpSourceCurrency = currency;
  const rows = [currencyRow];
  if (Number.isInteger(parcel.providerData?.taxYear)) rows.push(row('Source tax year', String(parcel.providerData.taxYear)));
  if (Number.isInteger(parcel.providerData?.revaluationYear)) rows.push(row('Revaluation year', String(parcel.providerData.revaluationYear)));
  if (parcel.source?.sourceNotice) rows.push(row('Source note', parcel.source.sourceNotice));
  return rows;
}

function acquisitionBriefRows(brief) {
  const evidenceRow = (label, text, refs) => {
    const element = row(label, text);
    element.dataset.bdpEvidenceRefs = JSON.stringify(refs);
    return element;
  };
  const details = (label, elements) => {
    const container = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = label;
    container.append(summary, ...elements);
    return container;
  };
  const actionRows = brief.actions.map((action, index) => evidenceRow(
    `${index + 1}. ${action.label}`,
    `${action.priority.replaceAll('-', ' ').toUpperCase()} · ${action.action} Basis: ${action.basis.join('; ') || 'Category evidence requires confirmation.'}`,
    action.evidenceRefs,
  ));
  return [
    row('Acquisition brief', brief.summary),
    row('Acquisition recommendation', 'WITHHELD · VERIFICATION REQUIRED'),
    row('Scored model coverage', formatPercent(brief.scoreCoveragePercent)),
    ...brief.risks.map((risk) => evidenceRow(`${risk.severity.toUpperCase()} · ${risk.title}`, `${risk.detail} Source: ${risk.source}.`, [risk.evidenceRef])),
    ...actionRows.slice(0, 3),
    details(`More review tasks (${Math.max(actionRows.length - 3, 0)})`, actionRows.slice(3)),
    details(`Evidence gaps (${brief.gaps.length})`, brief.gaps.map((gap) => evidenceRow(`GAP · ${gap.label}`, `${gap.status.toUpperCase()} · ${gap.detail}`, [gap.evidenceRef]))),
    details(`Screening limits (${brief.caveats.length})`, brief.caveats.map((item) => evidenceRow(`LIMIT · ${item.title}`, `${item.detail} Source: ${item.source}.`, [item.evidenceRef]))),
    row('Brief limits', brief.notice),
  ];
}

function titleReferenceRow(label, url, text) {
  if (!Object.values(TITLE_REVIEW_REFERENCES).includes(url)) return row(label, 'Lookup not configured for this county');
  const element = row(label, '');
  const link = document.createElement('a');
  link.textContent = text;
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  element.children[1].replaceChildren(link);
  return element;
}

function ownershipTitleRows(review) {
  return [
    row('Title review', 'DOCUMENTS REQUIRED · FINDINGS UNKNOWN'),
    row('Ownership / Title score', 'WITHHELD'),
    row('CAD-listed owner', review.observed_cad_owner || 'UNKNOWN'),
    row('Verified vesting', 'UNKNOWN'),
    row('Title clearance', 'UNKNOWN'),
    row('Verified legal access', 'UNKNOWN'),
    titleReferenceRow('Recorded instruments', review.recordLookup?.url, 'Open county land records'),
    titleReferenceRow('Texas title guidance', review.guidanceUrl, 'Open TDI guidance'),
    ...(review.tasks || []).map((task) => row(
      `${task.triggers.length ? 'PRIORITY · ' : ''}${task.label}`,
      `UNKNOWN · ${task.action}${task.triggers.map((item) => ` ${item.source}: ${item.detail}`).join('')}`,
    )),
    row('Title evidence note', review.notice),
  ];
}

function energyRows(metrics) {
  if (!metrics) return [row('RRC screening', 'No metrics returned')];
  return [
    row('Nearest well', formatMiles(metrics.nearest_well_m)),
    row('Wells ≤ 1 mi', String(metrics.wells_within_1_mi ?? '—')),
    row('Wells ≤ 2 mi', String(metrics.wells_within_2_mi ?? '—')),
    row('Wells ≤ 5 mi', String(metrics.wells_within_5_mi ?? '—')),
    row('Nearest pipe', formatMiles(metrics.nearest_pipeline_m)),
    row('Pipe crossings', String(metrics.pipeline_crossing_count ?? '—')),
    row('Pipe on tract', formatMiles(metrics.pipeline_length_on_parcel_m)),
  ];
}

function floodRows(metrics) {
  if (!metrics) return [row('FEMA screening', 'No metrics returned')];
  return [
    row('FEMA coverage', metrics.coverage_complete === true ? 'EVALUATED MAPPING · PRELIMINARY' : 'INCOMPLETE / UNDETERMINED · UNKNOWN'),
    row('Mapped flood', formatAcres(metrics.mapped_flood_acres)),
    row('Flood share', formatPercent(metrics.mapped_flood_percent)),
    row('SFHA', formatAcres(metrics.sfha_acres)),
    row('Floodway', formatAcres(metrics.floodway_acres)),
    row('Moderate', formatAcres(metrics.moderate_acres)),
    row('Non-mapped', formatAcres(metrics.preliminary_non_mapped_flood_acres)),
  ];
}

function wetlandRows(metrics) {
  if (!metrics) return [row('NWI screening', 'No metrics returned')];
  return [
    row('NWI mapped', formatAcres(metrics.nwi_mapped_acres)),
    row('NWI share', formatPercent(metrics.nwi_percent)),
    row('NWI features', String(metrics.nwi_feature_count ?? '—')),
    row('NWI types', String(metrics.nwi_type_count ?? '—')),
    row('Non-NWI acres', formatAcres(metrics.preliminary_non_nwi_acres)),
  ];
}

function cleanupRows(metrics) {
  if (!metrics) return [row('EPA screening', 'No metrics returned')];
  return [
    row('Nearest cleanup', formatMiles(metrics.nearest_cleanup_m)),
    row('Nearest site', metrics.nearest_site_name || '—'),
    row('On parcel', String(metrics.cleanup_sites_on_parcel ?? '—')),
    row('Sites ≤ 1 mi', String(metrics.cleanup_sites_within_1_mi ?? '—')),
    row('Sites ≤ 3 mi', String(metrics.cleanup_sites_within_3_mi ?? '—')),
    row('Sites ≤ 5 mi', String(metrics.cleanup_sites_within_5_mi ?? '—')),
    row('Superfund ≤ 5 mi', String(metrics.superfund_within_5_mi ?? '—')),
    row('RCRA CA ≤ 5 mi', String(metrics.rcra_within_5_mi ?? '—')),
    row('Brownfields ≤ 5 mi', String(metrics.brownfields_within_5_mi ?? '—')),
  ];
}

function mswRows(metrics) {
  if (!metrics) return [row('TCEQ MSW', 'No data returned')];

  return [
    row('MSW count basis', 'POINT RECORDS · MULTIPLE AUTHORIZATIONS MAY SHARE A FACILITY'),
    row('MSW coverage', metrics.coverage_complete === true ? 'IMPORTED · CURRENT' : 'INCOMPLETE / STALE · UNKNOWN'),
    row('Nearest MSW ≤ 5 mi', formatMiles(metrics.nearest_msw_site_m)),
    row('Nearest site', metrics.nearest_site_name || '—'),
    row('Nearest dataset', metrics.nearest_site_dataset || '—'),
    row('Nearest type', metrics.nearest_site_type || '—'),
    row('Nearest status', metrics.nearest_site_status || '—'),
    row('Points on parcel', String(metrics.msw_points_on_parcel ?? '—')),
    row('Active landfill ≤ 1 mi', String(metrics.active_landfills_within_1_mi ?? '—')),
    row('Active landfill ≤ 3 mi', String(metrics.active_landfills_within_3_mi ?? '—')),
    row('Closed sites ≤ 1 mi', String(metrics.closed_sites_within_1_mi ?? '—')),
    row('Closed sites ≤ 3 mi', String(metrics.closed_sites_within_3_mi ?? '—')),
    row('Unauthorized ≤ 1 mi', String(metrics.unauthorized_sites_within_1_mi ?? '—')),
    row('Unauthorized ≤ 3 mi', String(metrics.unauthorized_sites_within_3_mi ?? '—')),
    row('Haz. history ≤ 3 mi', String(metrics.hazardous_history_sites_within_3_mi ?? '—')),
  ];
}

function developmentConstraintRows(metrics) {
  if (!metrics) return [row('Constraint footprint', 'Unknown')];
  return [
    row('Footprint status', String(metrics.status || 'unknown').replaceAll('-', ' ').toUpperCase()),
    row('Development score', 'WITHHELD · BUILDABILITY UNVERIFIED'),
    row('GIS parcel area', formatAcres(metrics.parcel_acres)),
    row('FEMA mapped hazard', formatAcres(metrics.mapped_flood_acres)),
    row('NWI mapped area', formatAcres(metrics.mapped_nwi_acres)),
    row('Shared flood / NWI', formatAcres(metrics.shared_flood_nwi_acres)),
    row('Combined footprint', formatAcres(metrics.combined_mapped_constraint_acres)),
    row('Combined share', formatPercent(metrics.combined_mapped_constraint_percent)),
    row('FEMA evaluated cover', formatPercent(metrics.fema_evaluated_coverage_percent)),
    row('Outside mapped footprint', formatAcres(metrics.outside_mapped_footprint_acres)),
    row('Verified buildable acres', 'UNKNOWN'),
    row('Footprint source', metrics.source || 'FEMA NFHL + USFWS NWI / PostGIS'),
    row('Footprint note', metrics.notice || 'Outside mapped constraints does not establish buildability.'),
  ];
}

function economicsRows(metrics) {
  if (!metrics) return [row('Economics', 'Unknown')];
  return [
    row('Evidence', 'USER SCENARIO · UNVERIFIED'),
    row('Economics score', 'WITHHELD · VERIFIED MARKET / COST EVIDENCE NEEDED'),
    row('Asking price', formatMoney(metrics.askingPrice)),
    row('Ask / reported acre', formatMoney(metrics.askingPricePerAcre)),
    row('Additional costs', formatMoney(metrics.totalAdditionalCosts)),
    row('All-in basis', formatMoney(metrics.allInCost)),
    row('Basis / reported acre', formatMoney(metrics.allInCostPerAcre)),
    row('Break-even exit', formatMoney(metrics.breakEvenExitPrice)),
    row('Assumed exit price', formatMoney(metrics.assumedExitPrice)),
    row('Scenario profit', formatMoney(metrics.scenarioProfit)),
    row('Return on cost', formatPercent(metrics.returnOnCostPercent)),
    row('Target return', formatPercent(metrics.targetReturnPercent)),
    row('Residual max offer', formatMoney(metrics.maximumOffer)),
    ...(metrics.targetFeasible === false ? [row('Target feasibility', 'NO POSITIVE OFFER UNDER THESE ASSUMPTIONS')] : []),
    row('Missing inputs', metrics.missingInputs.length ? metrics.missingInputs.join(', ') : 'NONE · ASSUMPTIONS ONLY'),
    row('CAD land / acre', formatMoney(metrics.cadLandValuePerAcre)),
    row('CAD currency', metrics.cadRecordCurrency.toUpperCase()),
    row('Scenario note', metrics.notice),
  ];
}

function growthRows(metrics) {
  if (!metrics) return [row('Growth Radar', 'No data returned')];
  if (metrics.regional_scope_status === 'not-screened-outside-pilot') {
    return [row('Regional coverage', 'NOT SCREENED'), row('Required review', metrics.regional_scope_note)];
  }
  return [
    row('Coverage', 'SAN ANTONIO PLANNING SOURCES · 25-MILE VICINITY'),
    row('Growth score', 'WITHHELD · PLANNING CONTEXT ONLY'),
    row('Nearest MTP corridor', metrics.nearest_mtp_street || '—'),
    row('MTP distance', formatMiles(metrics.nearest_mtp_m)),
    row('MTP crossings', formatNumber(metrics.mtp_crossing_count, 0)),
    row('Proposed/changed ≤ 5 mi', formatNumber(metrics.mtp_proposed_or_changed_within_5_mi, 0)),
    row('Preliminary plats on tract', formatNumber(metrics.preliminary_plats_on_parcel, 0)),
    row('Preliminary plats ≤ 5 mi', formatNumber(metrics.preliminary_plats_within_5_mi, 0)),
    row('Preliminary plats ≤ 10 mi', formatNumber(metrics.preliminary_plats_within_10_mi, 0)),
    row('Preliminary plats ≤ 25 mi', formatNumber(metrics.preliminary_plats_within_25_mi, 0)),
    row('Nearest preliminary plat', metrics.nearest_preliminary_plat_name || '—'),
    row('Nearest center', metrics.nearest_regional_center_name || '—'),
    row('Center distance', formatMiles(metrics.nearest_regional_center_m)),
    row('Centers ≤ 25 mi', formatNumber(metrics.regional_centers_within_25_mi, 0)),
    row('Planning notice', 'City planning context does not establish funding, construction, current plat approval, legal access or statewide growth coverage.'),
  ];
}

function economicsForm(parcel, results) {
  const form = document.createElement('form');
  form.className = 'bdp-economics-form';
  const fields = [
    ['askingPrice', 'Asking price ($)'],
    ...ACQUISITION_COST_FIELDS.map(([key, label]) => [key, `${label} ($)`]),
    ['exitPrice', 'Assumed exit price before disposition costs ($)'],
    ['targetReturnPercent', 'Target return on all-in cost (%)'],
  ];
  const inputs = {};
  for (const [key, labelText] of fields) {
    const label = document.createElement('label');
    label.className = 'bdp-economics-field';
    const text = document.createElement('span');
    text.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'number';
    input.name = key;
    input.min = key === 'askingPrice' || key === 'exitPrice' ? '0.01' : '0';
    input.step = 'any';
    input.placeholder = 'Unknown';
    input.setAttribute('aria-label', labelText);
    const value = key === 'askingPrice' ? parcel.acquisition?.askingPrice : parcel.acquisition?.scenario?.[key];
    input.value = value == null ? '' : String(value);
    inputs[key] = input;
    label.append(text, input);
    form.append(label);
  }
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'CALCULATE SCENARIO';
  const note = document.createElement('p');
  note.textContent = 'Blank = unknown. Enter 0 only as an explicit assumption. Scenarios last for this selection and are not saved.';
  form.append(button, note);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const scenario = Object.fromEntries(fields.filter(([key]) => key !== 'askingPrice').map(([key]) => [key, inputs[key].value]));
    const candidate = { ...parcel, acquisition: { ...parcel.acquisition, askingPrice: inputs.askingPrice.value, scenario } };
    results.replaceChildren(...economicsRows(evaluateAcquisitionEconomics(candidate)));
    results.dataset.scenarioEdited = 'true';
  });
  return form;
}

function cemeteryRows(metrics) {
  if (!metrics) return [row('THC cemeteries', 'No data returned')];

  return [
    row('Nearest cemetery', formatMiles(metrics.nearest_cemetery_m)),
    row('Nearest name', metrics.nearest_cemetery_name || '—'),
    row('Nearest type', metrics.nearest_cemetery_type || '—'),
    row('Cemeteries on tract', String(metrics.cemeteries_intersecting_parcel ?? '—')),
    row('Overlap', formatAcres(metrics.cemetery_overlap_acres)),
    row('Overlap share', formatPercent(metrics.cemetery_overlap_percent)),
    row('Cemeteries ≤ 1 mi', String(metrics.cemeteries_within_1_mi ?? '—')),
    row('Cemeteries ≤ 3 mi', String(metrics.cemeteries_within_3_mi ?? '—')),
    row('Cemeteries ≤ 5 mi', String(metrics.cemeteries_within_5_mi ?? '—')),
    row('Archeology', 'RESTRICTED DATA · NOT PUBLICLY SCREENED'),
  ];
}

function entitlementRows(metrics, { austinPreviewAvailable = false } = {}) {
  if (!metrics) return [row('Entitlement', 'No data returned')];
  if (metrics.regional_scope_status === 'not-screened-outside-pilot') {
    if (austinPreviewAvailable) {
      return [
        row('San Antonio / Bexar pilot', 'NOT RUN · out of regional scope'),
        row('Austin GIS', 'PRELIMINARY parcel intersections available below'),
        row('Legal entitlement', 'UNKNOWN · zoning law and city jurisdiction not verified'),
        row('Required review', 'Austin GIS is a separate geographic preview; confirm municipal jurisdiction, current ordinances, other overlays and permitted uses with the responsible authority.'),
      ];
    }
    return [row('Entitlement coverage', 'NOT SCREENED · regional pilot only'),
      row('Required review', metrics.regional_scope_note)];
  }

  const jurisdiction = String(metrics.jurisdiction_screen || 'unresolved')
    .replaceAll('-', ' ')
    .toUpperCase();
  const special = [
    metrics.dominant_zoning_spec_district,
    metrics.dominant_zoning_spec_condition,
  ].filter(Boolean).join(' · ');

  return [
    row('Jurisdiction', jurisdiction),
    row('Legal entitlement', 'UNVERIFIED'),
    row('City zoning cover', formatPercent(metrics.city_zoning_coverage_percent)),
    row('Dominant zoning', metrics.dominant_zoning_code || metrics.dominant_zoning_base || '—'),
    row('Zoning share', formatPercent(metrics.dominant_zoning_share_percent)),
    row('Zoning detail', metrics.dominant_zoning_detail || metrics.dominant_zoning_base_description || '—'),
    row('Special zoning', special || 'NONE MAPPED'),
    row('Specific condition', metrics.dominant_zoning_spec_condition_detail || '—'),
    row('Zoning case', metrics.dominant_zoning_case_no || '—'),
    row('ETJ overlap', formatPercent(metrics.etj_overlap_percent)),
    row('Future land use', metrics.dominant_future_land_use || '—'),
    row('Future-use share', formatPercent(metrics.dominant_future_land_use_share_percent)),
    row('Future-use plan', metrics.dominant_future_land_use_plan || '—'),
    row('Center tier', metrics.dominant_future_land_use_center_tiers || '—'),
  ];
}


function austinRegulatoryReferenceRow(label, key, title) {
  const url = AUSTIN_REGULATORY_REFERENCES[key];
  if (!url || !Object.values(AUSTIN_REGULATORY_REFERENCES).includes(url)) {
    return row(label, 'Official source link not configured');
  }
  const element = row(label, '');
  const link = document.createElement('a');
  link.href = url;
  link.textContent = title;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  element.children[1].replaceChildren(link);
  return element;
}

function austinDueDiligenceDetails(evidence) {
  const queue = buildAustinRegulatoryDueDiligence({
    austinZoning: evidence.austinZoning,
    austinJurisdiction: evidence.austinJurisdiction,
  });
  const panel = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = `Next evidence requests (${queue.openCount} outstanding)`;
  panel.append(summary);
  for (const item of queue.tasks) {
    const entry = row(
      `${item.priority.toUpperCase()} · ${item.title}`,
      `UNVERIFIED · ${item.requirement}`,
    );
    entry.dataset.bdpVerificationState = item.state;
    entry.dataset.bdpVerificationId = item.id;
    if (item.sourceKey && item.sourceUrl === AUSTIN_REGULATORY_REFERENCES[item.sourceKey]) {
      const link = document.createElement('a');
      link.textContent = ' Open official reference';
      link.href = item.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      entry.children[1].append(link);
    }
    panel.append(entry);
  }
  return panel;
}

function austinRegulatoryRows(evidence) {
  const report = buildAustinRegulatoryReview({
    austinZoning: evidence.austinZoning,
    austinJurisdiction: evidence.austinJurisdiction,
  });
  const codes = report.zoningCodeCandidates;
  const zoningAvailable = evidence.austinZoning?.status === 'preliminary-spatial-evidence';
  return [
    row('Regulatory status', 'RESEARCH REQUIRED · no verified zoning rights or buildability'),
    austinDueDiligenceDetails(evidence),
    row('GIS zoning candidates', codes.length
      ? codes.join('; ') + ' · UNVERIFIED'
      : 'UNKNOWN · no positive mapped zoning classifications confirmed by this screen'),
    row('Multiple GIS classes', codes.length > 1
      ? 'REVIEW REQUIRED · multiple mapped classifications, including small boundary slivers'
      : 'UNKNOWN · no confirmation of exclusive legally controlling district'),
    row('Neighborhood plan indicator', report.neighborhoodPlanIndicator
      ? 'GIS CODE INCLUDES NP · verify adopted neighborhood plan and parcel ordinances'
      : 'UNKNOWN · missing NP suffix does not establish no neighborhood restrictions'),
    row('Historic review indicator', report.historicDesignationIndicator
      ? 'GIS CODE INCLUDES H/HD · verify historic district and review requirements'
      : 'UNKNOWN · check all official historic overlays even without H/HD suffix'),
    row('Permitted uses', 'UNKNOWN · read current § 25-2-491 and parcel-specific ordinances'),
    row('Setbacks / height / density', 'UNKNOWN · read current § 25-2-492, combining districts and applicable amendments'),
    row('Applicable ordinances', 'UNKNOWN · official property zoning and ordinance history not yet retrieved'),
    row('Buildability / feasibility', 'NOT DETERMINED · survey, legal use, regulatory review and constraints outstanding'),
    row('Regulatory evidence coverage', zoningAvailable
      ? 'GIS candidate codes only · NO legal/regulatory clearance'
      : 'UNKNOWN · Austin zoning GIS preview unavailable or not screened'),
    austinRegulatoryReferenceRow('Official property profile', 'propertyProfile', 'Open Austin Property Profile'),
    austinRegulatoryReferenceRow('Formal zoning verification', 'zoningVerification', 'Austin Planning verification process'),
    austinRegulatoryReferenceRow('Zoning & combining districts', 'zoningResources', 'Official zoning resources'),
    austinRegulatoryReferenceRow('Current development code', 'landDevelopmentCode', 'Permitted use and site standards'),
    austinRegulatoryReferenceRow('City address check', 'addressingVerification', 'Austin address verification (not legal jurisdiction)'),
    ...(report.historicDesignationIndicator
      ? [austinRegulatoryReferenceRow('Historic preservation', 'historicPreservation', 'Official historic preservation resources')] : []),
  ];
}

function austinJurisdictionRows(metrics) {
  if (!metrics) return [
    row('Mapped jurisdiction', 'UNKNOWN · no municipal GIS relationship evidence'),
    row('Legal jurisdiction', 'UNVERIFIED · responsible authority review required'),
  ];
  const candidates = Array.isArray(metrics.candidateJurisdictions)
    ? metrics.candidateJurisdictions : [];
  const containing = Array.isArray(metrics.envelopeContainingJurisdictions)
    ? metrics.envelopeContainingJurisdictions : [];
  const label = (item) => [item.cityName, item.specifics || item.type].filter(Boolean).join(' · ');
  const fullyContained = metrics.status === 'single-gis-feature-contains-parcel-envelope'
    && containing.length === 1 && candidates.length === 1
    && containing[0].id === candidates[0].id;
  const mappedStatus = fullyContained
    ? `PRELIMINARY · GIS parcel envelope within ${label(containing[0])}`
    : candidates.length > 1
      ? 'REVIEW REQUIRED · multiple mapped jurisdiction features touch parcel envelope'
      : 'UNKNOWN · GIS jurisdiction envelope not fully classified';
  return [
    row('Mapped jurisdiction', mappedStatus),
    row('GIS candidate count', String(metrics.intersectsCandidateCount ?? '—')),
    row('Envelope containment', fullyContained
      ? 'ONE mapped jurisdiction feature contains the full parcel bounding envelope'
      : 'NOT ESTABLISHED · mapped boundary ambiguity or no complete envelope match'),
    ...(candidates.length > 1
      ? [row('Potential jurisdictions', candidates.map(label).join('; '))] : []),
    row('Legal jurisdiction', 'UNVERIFIED · no legally controlling city/ETJ determination'),
    row('Boundary evidence', 'County parcel GIS / Austin ArcGIS · not a property boundary survey'),
    row('Jurisdiction source date', 'UNVERIFIED'),
    row('Jurisdiction review', 'Confirm annexation, current city/ETJ authority, recorded boundaries and applicable regulations before land decisions.'),
  ];
}

function austinZoningRows(metrics) {
  if (!metrics) return [row('Austin GIS preview', 'UNKNOWN · no parcel intersection evidence')];
  const observations = Array.isArray(metrics.observations) ? metrics.observations : [];
  const positive = observations.filter((item) =>
    Number.isFinite(item.parcelPercent) && item.parcelPercent > 0
    && item.intersectsParcel === true);
  const zoning = positive.filter((item) => item.sourceName === 'zoning');
  const etod = positive.filter((item) => item.sourceName === 'etodOverlay');
  // A very small second zoning intersection is a boundary-review trigger,
  // not proof of a legally split-zoned parcel or of a mapping error.
  const tinyZones = zoning.filter((item) => item.parcelPercent < 1);
  const boundaryReview = zoning.length > 1
    ? 'REQUIRED · multiple mapped zoning polygons intersect; confirm boundaries with Austin Planning'
    : zoning.length === 1
      ? 'UNVERIFIED · one mapped zoning class intersects; official zoning still needs review'
      : 'REQUIRED · no positive mapped zoning intersection; official zoning UNKNOWN';
  const label = (item) => item.sourceName === 'zoning'
    ? String(item.attributes?.ZONING_ZTYPE || 'Unspecified zoning class')
    : [item.attributes?.ZONING_OVERLAY_NAME, item.attributes?.ZONING_OVERLAY_SUB_NAME,
      item.attributes?.ZONING_STATUS].filter(Boolean).join(' · ') || 'Unspecified overlay';
  return [
    row('GIS evidence', 'PRELIMINARY · NOT LEGAL ZONING'),
    row('Parcel geometry', 'County GIS polygon · NOT A SURVEY'),
    row('Jurisdiction', 'UNVERIFIED · exact city/ETJ intersection pending'),
    row('Source currency', 'UNVERIFIED'),
    row('Zoning GIS candidates', String(metrics.sourceCandidates?.zoning ?? '—')),
    row('Zoning intersections', zoning.length
      ? zoning.map((item) => `${label(item)} · ${formatMappedIntersectionPercent(item.parcelPercent)} of mapped parcel`).join('; ')
      : 'UNKNOWN · no positive polygon overlap identified'),
    row('Zoning boundary review', boundaryReview),
    ...(tinyZones.length ? [row('Small GIS zoning overlaps',
      tinyZones.map((item) => `${label(item)} · ${formatMappedIntersectionPercent(item.parcelPercent)}`).join('; ')
        + ' · verify if this is boundary precision or an actual classification change')] : []),
    row('ETOD GIS candidates', String(metrics.sourceCandidates?.etodOverlay ?? '—')),
    row('ETOD mapped overlap', etod.length
      ? etod.map((item) => `${label(item)} · ${formatMappedIntersectionPercent(item.parcelPercent)} of mapped parcel`).join('; ')
      : 'UNKNOWN · no intersecting candidate in this GIS response; not ETOD clearance'),
    row('ETOD entitlement', 'UNVERIFIED · eligibility layer does not grant density bonuses or approvals'),
    row('Zoning determination', 'UNVERIFIED · verify current ordinances, overlays, restrictions and adopted use rules'),
    row('GIS limitation', 'Spatial intersections do not establish permitted uses, development rights or legal jurisdiction.'),
  ];
}

function transportationRows(metrics) {
  if (!metrics) return [row('TxDOT screening', 'No metrics returned')];
  const roadLabel = [metrics.nearest_road_name, metrics.nearest_road_system]
    .filter(Boolean)
    .join(' · ');
  return [
    row('Legal access', 'UNVERIFIED'),
    row('Nearest road', roadLabel || '—'),
    row('Road distance', formatDistanceFeetFromMeters(metrics.nearest_road_m)),
    row('Centerline on tract', metrics.road_centerline_intersects_parcel ? 'YES · MAPPED' : 'NO'),
    row('Roads ≤ 250 ft', String(metrics.road_centerlines_within_250_ft ?? '—')),
    row('Nearest mapped AADT', formatVehicles(metrics.nearest_aadt_current)),
    row('AADT route / ID', metrics.nearest_aadt_route || '—'),
    row('AADT distance', formatNearbyDistance(metrics.nearest_aadt_m)),
    row('Count station', metrics.nearest_station_id || '—'),
    row('Station distance', formatNearbyDistance(metrics.nearest_station_m)),
    row('Latest count year', metrics.nearest_station_latest_year ? String(metrics.nearest_station_latest_year) : '—'),
    row('5-year change', metrics.nearest_station_5yr_change_percent == null
      ? 'UNKNOWN · no verified trend' : formatPercent(metrics.nearest_station_5yr_change_percent)),
    row('Traffic context', 'Nearest mapped AADT segment and count station may differ from the nearest road; neither verifies legal access.'),
  ];
}

function utilityRows(metrics) {
  if (!metrics) return [row('Utilities', 'No data returned')];

  const serviceNames = Array.isArray(metrics.water_service_names)
    ? metrics.water_service_names.filter(Boolean).join(', ')
    : '';
  const ccnUtilities = Array.isArray(metrics.water_ccn_utilities)
    ? metrics.water_ccn_utilities.filter(Boolean).join(', ')
    : '';
  const ccnNumbers = Array.isArray(metrics.water_ccn_numbers)
    ? metrics.water_ccn_numbers.filter(Boolean).join(', ')
    : '';

  return [
    row('Water capacity', 'UNVERIFIED'),
    row('Mapped water area', metrics.water_service_source_status === 'unavailable'
      ? 'UNKNOWN · SOURCE UNAVAILABLE' : formatPercent(metrics.water_service_overlap_percent)),
    row('Mapped provider(s)', serviceNames || '—'),
    row('Water area meaning', 'GIS parcel overlap only · service connection, availability, and capacity unverified'),
    row('Water CCN · 2021 copy', metrics.water_ccn_source_status === 'unavailable'
      ? 'UNKNOWN · SOURCE UNAVAILABLE' : formatPercent(metrics.water_ccn_overlap_percent)),
    row('CCN utility', ccnUtilities || '—'),
    row('CCN number(s)', ccnNumbers || '—'),
    row('PUCT water CCN', metrics.puct_water_ccn_coverage === 'mapped-snapshot'
      ? formatPercent(metrics.puct_water_ccn_overlap_percent) : 'UNKNOWN · SNAPSHOT NOT CURRENT'),
    row('PUCT water utility', metrics.puct_water_ccn_coverage === 'mapped-snapshot'
      ? (metrics.puct_water_ccn_utilities || []).filter(Boolean).join(', ') || '—' : '—'),
    row('PUCT water source', metrics.puct_water_ccn_source_last_modified
      ? String(metrics.puct_water_ccn_source_last_modified).slice(0, 10) : 'NOT INGESTED'),
    row('Sewer capacity', 'UNVERIFIED'),
    row('Sewer CCN', metrics.sewer_ccn_coverage === 'mapped-snapshot'
      ? formatPercent(metrics.sewer_ccn_overlap_percent) : 'UNKNOWN · SNAPSHOT NOT CURRENT'),
    row('Sewer CCN utility', metrics.sewer_ccn_coverage === 'mapped-snapshot'
      ? (metrics.sewer_ccn_utilities || []).filter(Boolean).join(', ') || '—' : '—'),
    row('Sewer CCN source', metrics.sewer_ccn_source_last_modified
      ? String(metrics.sewer_ccn_source_last_modified).slice(0, 10) : 'NOT INGESTED'),
    row('Electric capacity', 'UNVERIFIED'),
    row('Nearest transmission', formatMiles(metrics.nearest_transmission_m)),
    row('Transmission crossings', String(metrics.transmission_crossing_count ?? '—')),
    row('Transmission on tract', formatMiles(metrics.transmission_length_on_parcel_m)),
    row(
      'Transmission source',
      metrics.transmission_source_status === 'unavailable'
        ? 'UNKNOWN · SOURCE UNAVAILABLE'
        : metrics.transmission_data_currency === 'archived-2024'
        ? 'ARCHIVED 2024 · SCREENING'
        : 'SCREENING ONLY',
    ),
  ];
}

function waterRightsRows(metrics) {
  if (!metrics) return [row('TCEQ water rights', 'No data returned')];

  return [
    row('Ownership', 'UNVERIFIED'),
    row('Nearest mapped point', formatMiles(metrics.nearest_water_right_point_m)),
    row('Points on parcel', String(metrics.water_right_points_on_parcel ?? '—')),
    row('Points ≤ 1 mi', String(metrics.water_right_points_within_1_mi ?? '—')),
    row('Points ≤ 5 mi', String(metrics.water_right_points_within_5_mi ?? '—')),
    row('Distinct rights ≤ 5 mi', String(metrics.distinct_water_rights_within_5_mi ?? '—')),
  ];
}

function soilRows(summary) {
  if (!summary) return [row('Soil screening', 'No data returned')];
  const dominant = summary.dominant;
  const dominantLabel = dominant
    ? [dominant.symbol, dominant.name].filter(Boolean).join(' · ')
    : '—';
  return [
    row('Dominant soil', dominantLabel),
    row('Dominant share', dominant ? formatPercent(dominant.mappedSharePercent) : '—'),
    row('Mapped soils', formatAcres(summary.mappedAcres)),
    row('Map units', String(summary.mapunitCount ?? '—')),
    row('Farmland class', dominant?.farmlandClass || '—'),
    row('Survey area', dominant?.areaSymbol || '—'),
  ];
}

function terrainRows(metrics) {
  if (!metrics) return [row('Terrain', 'No data returned')];
  return [
    row('Terrain class', String(metrics.terrainClass || 'unknown').replaceAll('-', ' ')),
    row('Mean elevation', formatFeet(metrics.elevation?.meanFeet)),
    row('Elevation low', formatFeet(metrics.elevation?.minFeet)),
    row('Elevation high', formatFeet(metrics.elevation?.maxFeet)),
    row('Relief', formatFeet(metrics.elevation?.reliefFeet)),
    row('Mean slope', formatDegrees(metrics.slope?.meanDegrees)),
    row('Max slope', formatDegrees(metrics.slope?.maxDegrees)),
  ];
}

function intelligenceRows(screening) {
  const { score, redFlagSummary } = screening;
  const withheld = score.readiness === 'insufficient-evidence';
  const scoreLabel = withheld
    ? 'WITHHELD · INSUFFICIENT EVIDENCE'
    : `${formatNumber(score.confidenceAdjustedScore, 0)} / 100 · ${score.readiness.replaceAll('-', ' ').toUpperCase()}`;
  const scoreRow = row('Land screening score', scoreLabel);
  scoreRow.dataset.bdpScoreState = withheld ? 'withheld' : score.readiness;
  return [
    scoreRow,
    row('Model coverage', formatPercent(score.coveragePercent)),
    row('Evidence conf.', formatPercent(score.confidenceAdjustedCoveragePercent)),
    row('Feed response coverage', formatPercent(screening.sourceCoveragePercent)),
    ...sourceCoverageRows(screening),
    row('High flags', String(redFlagSummary.high + redFlagSummary.critical)),
    row('Medium flags', String(redFlagSummary.medium)),
  ];
}

function sourceCoverageRows(screening) {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'SOURCE RESPONSE STATUS · NOT CLEARANCE';
  details.append(summary);
  const coverage = screening.sourceCoverage;
  if (coverage) {
    details.append(...Object.values(coverage).map((item) => {
      const element = row(item.label, `${item.status.toUpperCase()} · ${item.detail}`);
      element.dataset.bdpEvidenceRefs = JSON.stringify([`sourceCoverage.${item.source}`]);
      return element;
    }));
  } else {
    details.append(row('Source status', 'UNKNOWN · Detailed source status was not returned.'));
  }
  details.append(row('Coverage meaning', 'Feed responses are not county coverage, complete GIS inventories, score-model coverage or legal clearance. San Antonio entitlement and Growth Radar remain regional screens.'));
  return [details];
}

function redFlagElements(flags) {
  const substantive = flags.filter((item) => item.severity !== 'info');
  const display = substantive.length ? substantive : flags;
  if (!display.length) return [row('Flags', 'None from current screening feeds')];
  return display.map((item) => {
    const element = row(`${item.severity.toUpperCase()} · ${item.title}`, item.detail);
    element.dataset.bdpSeverity = item.severity;
    return element;
  });
}

function appendScreeningResult(containers, screening) {
  const { evidence, errors } = screening;
  containers.acquisitionBrief.replaceChildren(...(screening.acquisitionBrief
    ? acquisitionBriefRows(screening.acquisitionBrief)
    : [row('Acquisition brief', 'Unavailable · no acquisition recommendation')]));
  if (evidence.ownershipTitle) containers.ownershipTitle.replaceChildren(...ownershipTitleRows(evidence.ownershipTitle));
  if (containers.economics.dataset.scenarioEdited !== 'true') {
    containers.economics.replaceChildren(...economicsRows(evidence.acquisitionEconomics));
  }
  containers.developmentConstraints.replaceChildren(...(evidence.developmentConstraints
    ? developmentConstraintRows(evidence.developmentConstraints)
    : [row('Constraint footprint', sourceErrorLabel(errors.developmentConstraints, 'FEMA / NWI'))]));
  containers.growthRadar.replaceChildren(...(evidence.growthRadar
    ? growthRows(evidence.growthRadar)
    : [row('Growth Radar', sourceErrorLabel(errors.growthRadar, 'San Antonio Growth Radar'))]));
  containers.intelligence.replaceChildren(...intelligenceRows(screening));
  containers.flags.replaceChildren(...redFlagElements(screening.redFlags));

  containers.energy.replaceChildren(...(
    evidence.energy
      ? energyRows(evidence.energy)
      : [row('RRC screening', sourceErrorLabel(errors.energy, 'RRC'))]
  ));
  containers.flood.replaceChildren(...(
    evidence.flood
      ? floodRows(evidence.flood)
      : [row('FEMA screening', sourceErrorLabel(errors.flood, 'FEMA'))]
  ));
  containers.wetlands.replaceChildren(...(
    evidence.wetlands
      ? wetlandRows(evidence.wetlands)
      : [row('NWI screening', sourceErrorLabel(errors.wetlands, 'NWI'))]
  ));
  containers.cleanups.replaceChildren(...(
    evidence.cleanups
      ? cleanupRows(evidence.cleanups)
      : [row('EPA screening', sourceErrorLabel(errors.cleanups, 'EPA cleanups'))]
  ));
  containers.msw.replaceChildren(...(
    evidence.msw
      ? mswRows(evidence.msw)
      : [row('TCEQ MSW', sourceErrorLabel(errors.msw, 'TCEQ MSW'))]
  ));
  containers.cemeteries.replaceChildren(...(
    evidence.cemeteries
      ? cemeteryRows(evidence.cemeteries)
      : [row('THC cemeteries', sourceErrorLabel(errors.cemeteries, 'THC cemeteries'))]
  ));
  containers.entitlement.replaceChildren(...(
    evidence.entitlement
      ? entitlementRows(evidence.entitlement, { austinPreviewAvailable: !!evidence.austinZoning })
      : [row('Entitlement', sourceErrorLabel(errors.entitlement, 'San Antonio entitlement GIS'))]
  ));
  containers.austinZoning.replaceChildren(...(evidence.austinZoning
    ? austinZoningRows(evidence.austinZoning)
    : [row('Austin GIS preview', errors.austinZoning
      ? 'UNAVAILABLE · source/database screening failed; legal zoning UNKNOWN'
      : 'NOT SCREENED · local pilot evidence unavailable')]));
  containers.austinJurisdiction.replaceChildren(...(evidence.austinJurisdiction
    ? austinJurisdictionRows(evidence.austinJurisdiction)
    : [row('Mapped jurisdiction', errors.austinJurisdiction
      ? 'UNAVAILABLE · ArcGIS jurisdiction screening failed; legal jurisdiction UNKNOWN'
      : 'NOT SCREENED · mapped jurisdiction unavailable'),
      row('Legal jurisdiction', 'UNVERIFIED · confirm with responsible authority')]));
  containers.austinRegulatory.replaceChildren(...austinRegulatoryRows(evidence));
  containers.transportation.replaceChildren(...(
    evidence.transportation
      ? transportationRows(evidence.transportation)
      : [row('TxDOT screening', sourceErrorLabel(errors.transportation, 'TxDOT'))]
  ));
  containers.utilities.replaceChildren(...(
    evidence.utilities
      ? utilityRows(evidence.utilities)
      : [row('Utilities', sourceErrorLabel(errors.utilities, 'utility GIS'))]
  ));
  containers.waterRights.replaceChildren(...(
    evidence.waterRights
      ? waterRightsRows(evidence.waterRights)
      : [row('TCEQ water rights', sourceErrorLabel(errors.waterRights, 'TCEQ water rights'))]
  ));
  containers.soils.replaceChildren(...(
    evidence.soils
      ? soilRows(evidence.soils)
      : [row('Soil screening', sourceErrorLabel(errors.soils, 'USDA soils'))]
  ));
  containers.terrain.replaceChildren(...(
    evidence.terrain
      ? terrainRows(evidence.terrain)
      : [row('Terrain', sourceErrorLabel(errors.terrain, 'USGS terrain'))]
  ));
}

function actionButton(icon, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bdp-property-action';
  button.setAttribute('aria-label', label);
  button.title = label;
  const symbol = document.createElement('span');
  symbol.className = 'material-symbols-outlined';
  symbol.setAttribute('aria-hidden', 'true');
  symbol.textContent = icon;
  button.append(symbol);
  return button;
}

export function createBdpPropertyCard({ screeningLoader = fetchBdpParcelIntelligence, onHide = null } = {}) {
  const root = document.createElement('aside');
  root.id = 'bdp-property-card';
  root.className = 'bdp-property-panel';
  root.setAttribute('aria-live', 'polite');
  root.dataset.collapsed = 'false';

  document.body.appendChild(root);
  let renderToken = 0;

  function hide() {
    renderToken += 1;
    root.style.display = 'none';
    root.replaceChildren();
    // Give the owner of the map selection a chance to clear its highlight,
    // including when the customer clicks the card's own close button.
    onHide?.();
  }

  function show(parcel) {
    if (!parcel) return hide();
    const token = ++renderToken;
    root.replaceChildren();
    root.dataset.collapsed = 'false';

    const header = document.createElement('div');
    header.className = 'bdp-property-header';

    const titles = document.createElement('div');
    titles.className = 'bdp-property-titles';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'bdp-property-eyebrow';
    eyebrow.textContent = 'PROPERTY INTELLIGENCE';

    const title = document.createElement('strong');
    title.className = 'bdp-property-title';
    title.textContent = parcel.property?.situsAddress || `Parcel ${parcel.parcelId}`;

    const subtitle = document.createElement('div');
    subtitle.className = 'bdp-property-subtitle';
    subtitle.textContent = `${parcel.county || parcel.jurisdiction?.county || 'Texas'} County, Texas`;
    titles.append(eyebrow, title, subtitle);

    const actions = document.createElement('div');
    actions.className = 'bdp-property-actions';
    const shortlist = actionButton('bookmark_add', 'Add to session acquisition shortlist');
    shortlist.title = 'Add to acquisition board (session only)';
    shortlist.addEventListener('click', () => {
      // The workspace converts this public parcel into a minimal, temporary
      // snapshot. Do not persist evidence or promise a private account.
      window.dispatchEvent(new CustomEvent('land:acquisition-add', {
        detail: { parcel },
      }));
    });
    const collapse = actionButton('keyboard_arrow_up', 'Collapse property intelligence');
    const close = actionButton('close', 'Close property intelligence');
    actions.append(shortlist, collapse, close);
    header.append(titles, actions);

    const body = document.createElement('div');
    body.className = 'bdp-property-body';

    const acreageReview = reviewReportedAcreage(parcel.property?.acres);
    const acreageReviewRow = acreageReview ? row('Acreage review', acreageReview.message) : null;
    if (acreageReviewRow) {
      acreageReviewRow.dataset.bdpAcreageReview = acreageReview.kind;
      acreageReviewRow.dataset.bdpEvidenceRefs = JSON.stringify(['parcel.property.acres']);
    }
    const valuationReview = reviewReportedValuation(parcel.valuation);
    const valuationReviewRow = valuationReview.status === 'review-required'
      ? row('Valuation review', VALUATION_REVIEW_NOTICE)
      : null;
    if (valuationReviewRow) {
      valuationReviewRow.dataset.bdpValuationReview = 'review-required';
      valuationReviewRow.dataset.bdpEvidenceRefs = JSON.stringify([
        'parcel.valuation.landValue',
        'parcel.valuation.improvementValue',
        'parcel.valuation.marketValue',
      ]);
    }

    body.append(
      row('Owner', parcel.owner?.name),
      row('Parcel ID', parcel.parcelId),
      row('Account', parcel.providerData?.accountNumber),
      row('Acres', formatNumber(parcel.property?.acres)),
      ...(acreageReviewRow ? [acreageReviewRow] : []),
      row('Land value', formatMoney(parcel.valuation?.landValue)),
      row('Improvements', formatMoney(parcel.valuation?.improvementValue)),
      row('Reported value', formatMoney(parcel.valuation?.marketValue)),
      row('Reported value / acre', formatMoney(parcel.acquisition?.pricePerAcre)),
      ...(valuationReviewRow ? [valuationReviewRow] : []),
      row('Property use', parcel.providerData?.propertyUse),
      row('Legal', parcel.property?.legalDescription),
      row('Mailing', parcel.owner?.mailingAddress),
      row('Source', parcel.source?.provider || parcel.source?.cad),
      ...sourceQualityRows(parcel),
    );

    const containers = {
      acquisitionBrief: document.createElement('div'),
      ownershipTitle: document.createElement('div'),
      developmentConstraints: document.createElement('div'),
      economics: document.createElement('div'),
      growthRadar: document.createElement('div'),
      intelligence: document.createElement('div'),
      flags: document.createElement('div'),
      energy: document.createElement('div'),
      flood: document.createElement('div'),
      wetlands: document.createElement('div'),
      cleanups: document.createElement('div'),
      msw: document.createElement('div'),
      cemeteries: document.createElement('div'),
      entitlement: document.createElement('div'),
      austinZoning: document.createElement('div'),
      austinJurisdiction: document.createElement('div'),
      austinRegulatory: document.createElement('div'),
      transportation: document.createElement('div'),
      utilities: document.createElement('div'),
      waterRights: document.createElement('div'),
      soils: document.createElement('div'),
      terrain: document.createElement('div'),
    };
    containers.acquisitionBrief.append(row('Acquisition brief', 'Loading evidence…'));
    containers.ownershipTitle.append(...ownershipTitleRows(buildOwnershipTitleReview(parcel)));
    containers.developmentConstraints.append(row('Constraint footprint', 'Loading…'));
    containers.economics.append(...economicsRows(evaluateAcquisitionEconomics(parcel)));
    containers.growthRadar.append(row('Growth Radar', 'Loading…'));
    containers.intelligence.append(row('Land screening', 'Loading evidence…'));
    containers.flags.append(row('Flags', 'Loading evidence…'));
    containers.energy.append(row('RRC screening', 'Loading…'));
    containers.flood.append(row('FEMA screening', 'Loading…'));
    containers.wetlands.append(row('NWI screening', 'Loading…'));
    containers.cleanups.append(row('EPA screening', 'Loading…'));
    containers.msw.append(row('TCEQ MSW', 'Loading…'));
    containers.cemeteries.append(row('THC cemeteries', 'Loading…'));
    containers.entitlement.append(row('Entitlement', 'Loading…'));
    containers.austinZoning.append(row('Austin zoning GIS', 'Loading preliminary intersections…'));
    containers.austinJurisdiction.append(row('Austin GIS jurisdiction', 'Loading preliminary envelope relationships…'));
    containers.austinRegulatory.append(row('Austin regulations', 'Legal review required; authoritative sources linked below…'));
    containers.transportation.append(row('TxDOT screening', 'Loading…'));
    containers.utilities.append(row('Utilities', 'Loading…'));
    containers.waterRights.append(row('TCEQ water rights', 'Loading…'));
    containers.soils.append(row('Soil screening', 'Loading…'));
    containers.terrain.append(row('Terrain', 'Loading…'));

    const evidenceIntro = document.createElement('p');
    evidenceIntro.className = 'bdp-property-evidence-intro';
    evidenceIntro.textContent = 'Preliminary screening only. Unverified, unavailable and missing data do not establish clearance. Expand each section to review its source evidence.';

    body.append(
      evidenceIntro,
      propertyEvidenceGroup('Screening summary & red flags', [
        sectionHeading('LAND INTELLIGENCE'), containers.intelligence,
        sectionHeading('ACQUISITION BRIEF'), containers.acquisitionBrief,
        sectionHeading('RED FLAGS'), containers.flags,
      ], { expanded: true }),
      propertyEvidenceGroup('Acquisition, ownership & title', [
        sectionHeading('OWNERSHIP / TITLE REVIEW'), containers.ownershipTitle,
        sectionHeading('ACQUISITION ECONOMICS'), containers.economics, economicsForm(parcel, containers.economics),
        sectionHeading('GROWTH RADAR'), containers.growthRadar,
      ]),
      propertyEvidenceGroup('Planning, zoning & development', [
        sectionHeading('DEVELOPMENT / MAPPED CONSTRAINTS'), containers.developmentConstraints,
        sectionHeading('ENTITLEMENT / ZONING'), containers.entitlement,
        ...(eligibleForAustinGisPilot(parcel) ? [
          sectionHeading('AUSTIN GIS / JURISDICTION SCREEN'), containers.austinJurisdiction,
          sectionHeading('AUSTIN GIS / PRELIMINARY ZONING'), containers.austinZoning,
          sectionHeading('AUSTIN / REGULATORY REVIEW'), containers.austinRegulatory,
        ] : []),
        sectionHeading('SOIL / SSURGO'), containers.soils,
        sectionHeading('TERRAIN / 3DEP'), containers.terrain,
      ]),
      propertyEvidenceGroup('Environmental & site constraints', [
        sectionHeading('FLOOD / FEMA'), containers.flood,
        sectionHeading('WETLANDS'), containers.wetlands,
        sectionHeading('ENVIRONMENT / EPA CLEANUPS'), containers.cleanups,
        sectionHeading('WASTE / TCEQ MSW'), containers.msw,
        sectionHeading('CULTURAL / CEMETERIES'), containers.cemeteries,
        sectionHeading('ENERGY / OIL & GAS'), containers.energy,
      ]),
      propertyEvidenceGroup('Transportation, utilities & water', [
        sectionHeading('ACCESS / TXDOT TRAFFIC'), containers.transportation,
        sectionHeading('UTILITIES / INFRASTRUCTURE'), containers.utilities,
        sectionHeading('SURFACE WATER RIGHTS / TCEQ'), containers.waterRights,
      ]),
    );

    const disclaimer = document.createElement('p');
    disclaimer.className = 'bdp-property-disclaimer';
    disclaimer.textContent = 'Land screening score is withheld until enough weighted categories have evidence. Owner/valuation records may require current CAD/deed verification. TxDOT roadway proximity does not prove legal access/frontage. Utility service areas/CCNs do not prove capacity, taps, extension cost or electric service; archived transmission mapping does not prove current line/easement conditions. TCEQ water-right points do not prove that a right belongs to the parcel owner, conveys with the tract, or provides available supply. TCEQ MSW coordinates may be a gate, benchmark, centroid, or other point and do not prove exact waste boundaries or parcel contamination. Austin parcel zoning/ETOD GIS intersections are a Travis pilot and do not establish official zoning, city jurisdiction, adoption of density bonuses or permitted uses. San Antonio zoning, ETJ and Future Land Use GIS are planning screens and do not establish legal entitlement, vested rights, density, overlays or permitted development. THC cemetery geometry is public screening data and is not a boundary survey; exact archeological site locations are restricted and are not publicly screened, so absence from this interface is not archeological clearance. FEMA, RRC, NWI, EPA cleanup, TCEQ MSW, THC public cultural data, TxDOT, utility GIS, TCEQ water-right GIS, SSURGO and 3DEP outputs are preliminary screening data; professional, legal, title, survey, environmental, utility, water-right, traffic/ROW, engineering and permitting due diligence remains required.';
    body.append(disclaimer);

    collapse.addEventListener('click', () => {
      const collapsed = root.dataset.collapsed !== 'true';
      root.dataset.collapsed = String(collapsed);
      body.hidden = collapsed;
      collapse.querySelector('.material-symbols-outlined').textContent = collapsed
        ? 'keyboard_arrow_down'
        : 'keyboard_arrow_up';
      collapse.setAttribute('aria-label', collapsed
        ? 'Expand property intelligence'
        : 'Collapse property intelligence');
      collapse.title = collapse.getAttribute('aria-label');
    });
    close.addEventListener('click', hide);

    root.append(header, body);
    root.style.display = 'block';

    Promise.resolve()
      .then(() => screeningLoader(parcel))
      .then((screening) => {
        if (token !== renderToken) return;
        appendScreeningResult(containers, screening);
      })
      .catch((error) => {
        if (token !== renderToken) return;
        containers.acquisitionBrief.replaceChildren(row('Acquisition brief', 'Unavailable · no acquisition recommendation'));
        containers.intelligence.replaceChildren(row('Land screening', 'Screening session unavailable'));
        containers.flags.replaceChildren(row('Flags', 'Evidence could not be assembled'));
        console.warn('[BDP:PropertyCard] screening failed:', error);
      });
  }

  function destroy() {
    renderToken += 1;
    root.remove();
  }

  return { root, show, hide, destroy };
}

export default createBdpPropertyCard;
