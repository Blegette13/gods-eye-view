import { runBdpParcelScreening } from '../intelligence/screeningSession.js';

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(number);
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(number);
}

function formatMiles(meters) {
  const number = Number(meters);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number / 1609.344, 2)} mi`;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number, 1)}%`;
}

function formatAcres(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number, 2)} ac`;
}

function formatFeet(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number, 0)} ft`;
}

function formatDistanceFeetFromMeters(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number * 3.280839895, 0)} ft`;
}

function formatDegrees(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number, 1)}°`;
}

function formatVehicles(value) {
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

function energyRows(metrics) {
  if (!metrics) return [row('RRC screening', 'No metrics returned')];
  return [
    row('Nearest well', formatMiles(metrics.nearest_well_m)),
    row('Wells ≤ 1 mi', String(metrics.wells_within_1_mi ?? 0)),
    row('Wells ≤ 2 mi', String(metrics.wells_within_2_mi ?? 0)),
    row('Wells ≤ 5 mi', String(metrics.wells_within_5_mi ?? 0)),
    row('Nearest pipe', formatMiles(metrics.nearest_pipeline_m)),
    row('Pipe crossings', String(metrics.pipeline_crossing_count ?? 0)),
    row('Pipe on tract', formatMiles(metrics.pipeline_length_on_parcel_m)),
  ];
}

function floodRows(metrics) {
  if (!metrics) return [row('FEMA screening', 'No metrics returned')];
  return [
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
    row('NWI features', String(metrics.nwi_feature_count ?? 0)),
    row('NWI types', String(metrics.nwi_type_count ?? 0)),
    row('Non-NWI acres', formatAcres(metrics.preliminary_non_nwi_acres)),
  ];
}

function cleanupRows(metrics) {
  if (!metrics) return [row('EPA screening', 'No metrics returned')];
  return [
    row('Nearest cleanup', formatMiles(metrics.nearest_cleanup_m)),
    row('Nearest site', metrics.nearest_site_name || '—'),
    row('On parcel', String(metrics.cleanup_sites_on_parcel ?? 0)),
    row('Sites ≤ 1 mi', String(metrics.cleanup_sites_within_1_mi ?? 0)),
    row('Sites ≤ 3 mi', String(metrics.cleanup_sites_within_3_mi ?? 0)),
    row('Sites ≤ 5 mi', String(metrics.cleanup_sites_within_5_mi ?? 0)),
    row('Superfund ≤ 5 mi', String(metrics.superfund_within_5_mi ?? 0)),
    row('RCRA CA ≤ 5 mi', String(metrics.rcra_within_5_mi ?? 0)),
    row('Brownfields ≤ 5 mi', String(metrics.brownfields_within_5_mi ?? 0)),
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
    row('Roads ≤ 250 ft', String(metrics.road_centerlines_within_250_ft ?? 0)),
    row('Nearest AADT', formatVehicles(metrics.nearest_aadt_current)),
    row('AADT route', metrics.nearest_aadt_route || '—'),
    row('AADT distance', formatMiles(metrics.nearest_aadt_m)),
    row('Count station', metrics.nearest_station_id || '—'),
    row('Station distance', formatMiles(metrics.nearest_station_m)),
    row('Latest count year', metrics.nearest_station_latest_year ? String(metrics.nearest_station_latest_year) : '—'),
    row('5-year change', formatPercent(metrics.nearest_station_5yr_change_percent)),
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
    row('Map units', String(summary.mapunitCount ?? 0)),
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
  containers.transportation.replaceChildren(...(
    evidence.transportation
      ? transportationRows(evidence.transportation)
      : [row('TxDOT screening', sourceErrorLabel(errors.transportation, 'TxDOT'))]
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

export function createBdpPropertyCard({ screeningLoader = runBdpParcelScreening } = {}) {
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
      row('Value / acre', formatMoney(parcel.acquisition?.pricePerAcre)),
      row('Property use', parcel.providerData?.propertyUse),
      row('Legal', parcel.property?.legalDescription),
      row('Mailing', parcel.owner?.mailingAddress),
      row('Source', parcel.source?.provider || parcel.source?.cad),
      ...sourceQualityRows(parcel),
    );

    const containers = {
      intelligence: document.createElement('div'),
      flags: document.createElement('div'),
      energy: document.createElement('div'),
      flood: document.createElement('div'),
      wetlands: document.createElement('div'),
      cleanups: document.createElement('div'),
      transportation: document.createElement('div'),
      soils: document.createElement('div'),
      terrain: document.createElement('div'),
    };
    containers.intelligence.append(row('BDP screening', 'Loading evidence…'));
    containers.flags.append(row('Flags', 'Loading evidence…'));
    containers.energy.append(row('RRC screening', 'Loading…'));
    containers.flood.append(row('FEMA screening', 'Loading…'));
    containers.wetlands.append(row('NWI screening', 'Loading…'));
    containers.cleanups.append(row('EPA screening', 'Loading…'));
    containers.transportation.append(row('TxDOT screening', 'Loading…'));
    containers.soils.append(row('Soil screening', 'Loading…'));
    containers.terrain.append(row('Terrain', 'Loading…'));

    body.append(
      sectionHeading('BDP INTELLIGENCE'), containers.intelligence,
      sectionHeading('RED FLAGS'), containers.flags,
      sectionHeading('ACCESS / TXDOT TRAFFIC'), containers.transportation,
      sectionHeading('ENERGY / OIL & GAS'), containers.energy,
      sectionHeading('FLOOD / FEMA'), containers.flood,
      sectionHeading('WETLANDS'), containers.wetlands,
      sectionHeading('ENVIRONMENT / EPA CLEANUPS'), containers.cleanups,
      sectionHeading('SOIL / SSURGO'), containers.soils,
      sectionHeading('TERRAIN / 3DEP'), containers.terrain,
    );

    const disclaimer = document.createElement('p');
    disclaimer.className = 'bdp-property-disclaimer';
    disclaimer.textContent = 'BDP score is withheld until enough weighted categories have evidence. Owner/valuation records may require current CAD/deed verification. TxDOT roadway proximity does not prove legal access/frontage. FEMA, RRC, NWI, EPA cleanup, TxDOT, SSURGO and 3DEP outputs are preliminary screening data; professional, legal, title, survey, environmental, traffic/ROW, engineering and permitting due diligence remains required.';
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
