import { ACQUISITION_COST_FIELDS, evaluateAcquisitionEconomics } from '../economics/acquisitionEconomics.js';
import { fetchBdpParcelIntelligence } from '../intelligence/client.js';
import { buildOwnershipTitleReview, TITLE_REVIEW_REFERENCES } from '../title/ownershipReview.js';

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

function formatPercent(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number, 1)}%`;
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
  if (parcel.source?.sourceNotice) rows.push(row('Source note', parcel.source.sourceNotice));
  return rows;
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

function entitlementRows(metrics) {
  if (!metrics) return [row('Entitlement', 'No data returned')];

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
    row('Nearest AADT', formatVehicles(metrics.nearest_aadt_current)),
    row('AADT route', metrics.nearest_aadt_route || '—'),
    row('AADT distance', formatMiles(metrics.nearest_aadt_m)),
    row('Count station', metrics.nearest_station_id || '—'),
    row('Station distance', formatMiles(metrics.nearest_station_m)),
    row('Latest count year', metrics.nearest_station_latest_year ? String(metrics.nearest_station_latest_year) : '—'),
    row('5-year change', formatPercent(metrics.nearest_station_5yr_change_percent)),
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
    row('Current water svc', formatPercent(metrics.water_service_overlap_percent)),
    row('Water provider(s)', serviceNames || '—'),
    row('Water CCN', formatPercent(metrics.water_ccn_overlap_percent)),
    row('CCN utility', ccnUtilities || '—'),
    row('CCN number(s)', ccnNumbers || '—'),
    row('Electric capacity', 'UNVERIFIED'),
    row('Nearest transmission', formatMiles(metrics.nearest_transmission_m)),
    row('Transmission crossings', String(metrics.transmission_crossing_count ?? '—')),
    row('Transmission on tract', formatMiles(metrics.transmission_length_on_parcel_m)),
    row(
      'Transmission source',
      metrics.transmission_data_currency === 'archived-2024'
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
  const scoreRow = row('BDP score', scoreLabel);
  scoreRow.dataset.bdpScoreState = withheld ? 'withheld' : score.readiness;
  return [
    scoreRow,
    row('Model coverage', formatPercent(score.coveragePercent)),
    row('Evidence conf.', formatPercent(score.confidenceAdjustedCoveragePercent)),
    row('Live feeds', formatPercent(screening.sourceCoveragePercent)),
    row('High flags', String(redFlagSummary.high + redFlagSummary.critical)),
    row('Medium flags', String(redFlagSummary.medium)),
  ];
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
      ? entitlementRows(evidence.entitlement)
      : [row('Entitlement', sourceErrorLabel(errors.entitlement, 'San Antonio entitlement GIS'))]
  ));
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

export function createBdpPropertyCard({ screeningLoader = fetchBdpParcelIntelligence } = {}) {
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
    eyebrow.textContent = 'BDP LAND INTELLIGENCE';

    const title = document.createElement('strong');
    title.className = 'bdp-property-title';
    title.textContent = parcel.property?.situsAddress || `Parcel ${parcel.parcelId}`;

    const subtitle = document.createElement('div');
    subtitle.className = 'bdp-property-subtitle';
    subtitle.textContent = `${parcel.county || parcel.jurisdiction?.county || 'Texas'} County, Texas`;
    titles.append(eyebrow, title, subtitle);

    const actions = document.createElement('div');
    actions.className = 'bdp-property-actions';
    const collapse = actionButton('keyboard_arrow_up', 'Collapse property intelligence');
    const close = actionButton('close', 'Close property intelligence');
    actions.append(collapse, close);
    header.append(titles, actions);

    const body = document.createElement('div');
    body.className = 'bdp-property-body';

    body.append(
      row('Owner', parcel.owner?.name),
      row('Parcel ID', parcel.parcelId),
      row('Account', parcel.providerData?.accountNumber),
      row('Acres', formatNumber(parcel.property?.acres)),
      row('Land value', formatMoney(parcel.valuation?.landValue)),
      row('Improvements', formatMoney(parcel.valuation?.improvementValue)),
      row('Total value', formatMoney(parcel.valuation?.marketValue)),
      row('CAD value / acre', formatMoney(parcel.acquisition?.pricePerAcre)),
      row('Property use', parcel.providerData?.propertyUse),
      row('Legal', parcel.property?.legalDescription),
      row('Mailing', parcel.owner?.mailingAddress),
      row('Source', parcel.source?.provider || parcel.source?.cad),
      ...sourceQualityRows(parcel),
    );

    const containers = {
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
      transportation: document.createElement('div'),
      utilities: document.createElement('div'),
      waterRights: document.createElement('div'),
      soils: document.createElement('div'),
      terrain: document.createElement('div'),
    };
    containers.ownershipTitle.append(...ownershipTitleRows(buildOwnershipTitleReview(parcel)));
    containers.developmentConstraints.append(row('Constraint footprint', 'Loading…'));
    containers.economics.append(...economicsRows(evaluateAcquisitionEconomics(parcel)));
    containers.growthRadar.append(row('Growth Radar', 'Loading…'));
    containers.intelligence.append(row('BDP screening', 'Loading evidence…'));
    containers.flags.append(row('Flags', 'Loading evidence…'));
    containers.energy.append(row('RRC screening', 'Loading…'));
    containers.flood.append(row('FEMA screening', 'Loading…'));
    containers.wetlands.append(row('NWI screening', 'Loading…'));
    containers.cleanups.append(row('EPA screening', 'Loading…'));
    containers.msw.append(row('TCEQ MSW', 'Loading…'));
    containers.cemeteries.append(row('THC cemeteries', 'Loading…'));
    containers.entitlement.append(row('Entitlement', 'Loading…'));
    containers.transportation.append(row('TxDOT screening', 'Loading…'));
    containers.utilities.append(row('Utilities', 'Loading…'));
    containers.waterRights.append(row('TCEQ water rights', 'Loading…'));
    containers.soils.append(row('Soil screening', 'Loading…'));
    containers.terrain.append(row('Terrain', 'Loading…'));

    body.append(
      sectionHeading('BDP INTELLIGENCE'), containers.intelligence,
      sectionHeading('RED FLAGS'), containers.flags,
      sectionHeading('OWNERSHIP / TITLE REVIEW'), containers.ownershipTitle,
      sectionHeading('ACQUISITION ECONOMICS'), containers.economics, economicsForm(parcel, containers.economics),
      sectionHeading('GROWTH RADAR'), containers.growthRadar,
      sectionHeading('DEVELOPMENT / MAPPED CONSTRAINTS'), containers.developmentConstraints,
      sectionHeading('ENTITLEMENT / ZONING'), containers.entitlement,
      sectionHeading('ACCESS / TXDOT TRAFFIC'), containers.transportation,
      sectionHeading('UTILITIES / INFRASTRUCTURE'), containers.utilities,
      sectionHeading('SURFACE WATER RIGHTS / TCEQ'), containers.waterRights,
      sectionHeading('ENERGY / OIL & GAS'), containers.energy,
      sectionHeading('FLOOD / FEMA'), containers.flood,
      sectionHeading('WETLANDS'), containers.wetlands,
      sectionHeading('ENVIRONMENT / EPA CLEANUPS'), containers.cleanups,
      sectionHeading('WASTE / TCEQ MSW'), containers.msw,
      sectionHeading('CULTURAL / CEMETERIES'), containers.cemeteries,
      sectionHeading('SOIL / SSURGO'), containers.soils,
      sectionHeading('TERRAIN / 3DEP'), containers.terrain,
    );

    const disclaimer = document.createElement('p');
    disclaimer.className = 'bdp-property-disclaimer';
    disclaimer.textContent = 'BDP score is withheld until enough weighted categories have evidence. Owner/valuation records may require current CAD/deed verification. TxDOT roadway proximity does not prove legal access/frontage. Utility service areas/CCNs do not prove capacity, taps, extension cost or electric service; archived transmission mapping does not prove current line/easement conditions. TCEQ water-right points do not prove that a right belongs to the parcel owner, conveys with the tract, or provides available supply. TCEQ MSW coordinates may be a gate, benchmark, centroid, or other point and do not prove exact waste boundaries or parcel contamination. San Antonio zoning, ETJ and Future Land Use GIS are planning screens and do not establish legal entitlement, vested rights, density, overlays or permitted development. THC cemetery geometry is public screening data and is not a boundary survey; exact archeological site locations are restricted and are not publicly screened, so absence from this interface is not archeological clearance. FEMA, RRC, NWI, EPA cleanup, TCEQ MSW, THC public cultural data, TxDOT, utility GIS, TCEQ water-right GIS, SSURGO and 3DEP outputs are preliminary screening data; professional, legal, title, survey, environmental, utility, water-right, traffic/ROW, engineering and permitting due diligence remains required.';
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
        containers.intelligence.replaceChildren(row('BDP screening', 'Screening session unavailable'));
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
