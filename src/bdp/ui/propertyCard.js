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

function formatDegrees(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${formatNumber(number, 1)}°`;
}

function row(label, value) {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'grid';
  wrapper.style.gridTemplateColumns = '108px minmax(0,1fr)';
  wrapper.style.gap = '12px';
  wrapper.style.padding = '7px 0';
  wrapper.style.borderBottom = '1px solid rgba(255,255,255,.08)';

  const key = document.createElement('span');
  key.textContent = label;
  key.style.color = '#9a9a9a';
  key.style.fontSize = '11px';
  key.style.textTransform = 'uppercase';
  key.style.letterSpacing = '.08em';

  const content = document.createElement('span');
  content.textContent = value === 0 ? '0' : (value || '—');
  content.style.color = '#f2f2f2';
  content.style.fontSize = '13px';
  content.style.lineHeight = '1.35';
  content.style.overflowWrap = 'anywhere';

  wrapper.append(key, content);
  return wrapper;
}

function sectionHeading(text) {
  const heading = document.createElement('div');
  heading.textContent = text;
  Object.assign(heading.style, {
    marginTop: '17px',
    marginBottom: '3px',
    color: '#d5d5d5',
    fontSize: '10px',
    fontWeight: '700',
    letterSpacing: '.14em',
  });
  return heading;
}

function sourceErrorLabel(error, source) {
  if (!error) return 'No data returned';
  if (error.status === 503) return 'PostGIS not configured';
  if (error.status === 502) return `${source} temporarily unavailable`;
  return 'Screening unavailable';
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
  const scoreLabel = score.readiness === 'insufficient-evidence'
    ? 'WITHHELD · INSUFFICIENT EVIDENCE'
    : `${formatNumber(score.confidenceAdjustedScore, 0)} / 100 · ${score.readiness.replaceAll('-', ' ').toUpperCase()}`;
  return [
    row('BDP score', scoreLabel),
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
    const label = `${item.severity.toUpperCase()} · ${item.title}`;
    return row(label, item.detail);
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

export function createBdpPropertyCard({ screeningLoader = runBdpParcelScreening } = {}) {
  const root = document.createElement('aside');
  root.id = 'bdp-property-card';
  root.setAttribute('aria-live', 'polite');
  Object.assign(root.style, {
    position: 'fixed',
    top: '84px',
    right: '24px',
    width: '360px',
    maxHeight: 'calc(100vh - 120px)',
    overflow: 'auto',
    zIndex: '1300',
    display: 'none',
    padding: '18px',
    border: '1px solid rgba(255,255,255,.16)',
    borderRadius: '10px',
    background: 'rgba(18,18,18,.94)',
    boxShadow: '0 18px 50px rgba(0,0,0,.35)',
    backdropFilter: 'blur(12px)',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  });

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

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '12px',
      marginBottom: '12px',
    });

    const titles = document.createElement('div');
    const eyebrow = document.createElement('div');
    eyebrow.textContent = 'BDP LAND INTELLIGENCE';
    Object.assign(eyebrow.style, {
      color: '#a7a7a7',
      fontSize: '10px',
      letterSpacing: '.14em',
    });

    const title = document.createElement('strong');
    title.textContent = parcel.property?.situsAddress || `Parcel ${parcel.parcelId}`;
    Object.assign(title.style, {
      display: 'block',
      marginTop: '5px',
      color: '#fff',
      fontSize: '17px',
      lineHeight: '1.2',
    });

    const subtitle = document.createElement('div');
    subtitle.textContent = `${parcel.county || parcel.jurisdiction?.county || 'Texas'} County, Texas`;
    Object.assign(subtitle.style, {
      marginTop: '4px',
      color: '#bdbdbd',
      fontSize: '12px',
    });
    titles.append(eyebrow, title, subtitle);

    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close property card');
    close.textContent = '×';
    Object.assign(close.style, {
      border: '0',
      background: 'transparent',
      color: '#d8d8d8',
      fontSize: '22px',
      cursor: 'pointer',
      alignSelf: 'flex-start',
    });
    close.addEventListener('click', hide);
    header.append(titles, close);
    root.append(header);

    root.append(
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
    );

    const containers = {
      intelligence: document.createElement('div'),
      flags: document.createElement('div'),
      energy: document.createElement('div'),
      flood: document.createElement('div'),
      wetlands: document.createElement('div'),
      soils: document.createElement('div'),
      terrain: document.createElement('div'),
    };
    containers.intelligence.append(row('BDP screening', 'Loading evidence…'));
    containers.flags.append(row('Flags', 'Loading evidence…'));
    containers.energy.append(row('RRC screening', 'Loading…'));
    containers.flood.append(row('FEMA screening', 'Loading…'));
    containers.wetlands.append(row('NWI screening', 'Loading…'));
    containers.soils.append(row('Soil screening', 'Loading…'));
    containers.terrain.append(row('Terrain', 'Loading…'));

    root.append(
      sectionHeading('BDP INTELLIGENCE'), containers.intelligence,
      sectionHeading('RED FLAGS'), containers.flags,
      sectionHeading('ENERGY / OIL & GAS'), containers.energy,
      sectionHeading('FLOOD / FEMA'), containers.flood,
      sectionHeading('WETLANDS'), containers.wetlands,
      sectionHeading('SOIL / SSURGO'), containers.soils,
      sectionHeading('TERRAIN / 3DEP'), containers.terrain,
    );

    const disclaimer = document.createElement('p');
    disclaimer.textContent = 'BDP score is withheld until enough weighted categories have evidence. FEMA, RRC, NWI, SSURGO and 3DEP outputs are preliminary screening data; professional, legal, title, survey, engineering and permitting due diligence remains required.';
    Object.assign(disclaimer.style, {
      margin: '12px 0 0',
      color: '#8f8f8f',
      fontSize: '10px',
      lineHeight: '1.45',
    });
    root.append(disclaimer);
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
