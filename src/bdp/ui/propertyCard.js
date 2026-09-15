import { fetchBdpParcelEnergy } from '../rrc/client.js';
import {
  fetchBdpParcelFlood,
  fetchBdpParcelWetlands,
} from '../environment/client.js';
import { fetchBdpParcelSoils } from '../soil/client.js';
import { fetchBdpParcelTerrain } from '../terrain/client.js';

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
  return `${formatNumber(number, 2)}%`;
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

export function createBdpPropertyCard({
  energyLoader = fetchBdpParcelEnergy,
  floodLoader = fetchBdpParcelFlood,
  wetlandsLoader = fetchBdpParcelWetlands,
  soilsLoader = fetchBdpParcelSoils,
  terrainLoader = fetchBdpParcelTerrain,
} = {}) {
  const root = document.createElement('aside');
  root.id = 'bdp-property-card';
  root.setAttribute('aria-live', 'polite');
  Object.assign(root.style, {
    position: 'fixed',
    top: '84px',
    right: '24px',
    width: '340px',
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
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.gap = '12px';
    header.style.marginBottom = '12px';

    const titles = document.createElement('div');
    const eyebrow = document.createElement('div');
    eyebrow.textContent = 'BDP LAND INTELLIGENCE';
    eyebrow.style.color = '#a7a7a7';
    eyebrow.style.fontSize = '10px';
    eyebrow.style.letterSpacing = '.14em';

    const title = document.createElement('strong');
    title.textContent = parcel.property?.situsAddress || `Parcel ${parcel.parcelId}`;
    title.style.display = 'block';
    title.style.marginTop = '5px';
    title.style.color = '#fff';
    title.style.fontSize = '17px';
    title.style.lineHeight = '1.2';

    const subtitle = document.createElement('div');
    subtitle.textContent = `${parcel.county || parcel.jurisdiction?.county || 'Texas'} County, Texas`;
    subtitle.style.marginTop = '4px';
    subtitle.style.color = '#bdbdbd';
    subtitle.style.fontSize = '12px';

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

    const energy = document.createElement('div');
    energy.append(row('RRC screening', 'Loading…'));
    root.append(sectionHeading('ENERGY / OIL & GAS'), energy);

    const flood = document.createElement('div');
    flood.append(row('FEMA screening', 'Loading…'));
    root.append(sectionHeading('FLOOD / FEMA'), flood);

    const wetlands = document.createElement('div');
    wetlands.append(row('NWI screening', 'Loading…'));
    root.append(sectionHeading('WETLANDS'), wetlands);

    const soils = document.createElement('div');
    soils.append(row('Soil screening', 'Loading…'));
    root.append(sectionHeading('SOIL / SSURGO'), soils);

    const terrain = document.createElement('div');
    terrain.append(row('Terrain', 'Loading…'));
    root.append(sectionHeading('TERRAIN / 3DEP'), terrain);

    const disclaimer = document.createElement('p');
    disclaimer.textContent = 'FEMA, RRC, NWI, SSURGO and 3DEP outputs are preliminary screening data. Survey, title, easement, wetland delineation, floodplain administration, jurisdictional, geotechnical, engineering and permitting verification remain separate due diligence.';
    Object.assign(disclaimer.style, {
      margin: '9px 0 0',
      color: '#8f8f8f',
      fontSize: '10px',
      lineHeight: '1.45',
    });
    root.append(disclaimer);

    root.style.display = 'block';

    Promise.resolve()
      .then(() => energyLoader(parcel))
      .then((metrics) => {
        if (token !== renderToken) return;
        energy.replaceChildren(...energyRows(metrics));
      })
      .catch((error) => {
        if (token !== renderToken) return;
        const label = error?.status === 503 ? 'PostGIS not configured' : 'Screening unavailable';
        energy.replaceChildren(row('RRC screening', label));
      });

    Promise.resolve()
      .then(() => floodLoader(parcel))
      .then((metrics) => {
        if (token !== renderToken) return;
        flood.replaceChildren(...floodRows(metrics));
      })
      .catch((error) => {
        if (token !== renderToken) return;
        const label = error?.status === 503
          ? 'PostGIS not configured'
          : error?.status === 502
            ? 'FEMA temporarily unavailable'
            : 'Screening unavailable';
        flood.replaceChildren(row('FEMA screening', label));
      });

    Promise.resolve()
      .then(() => wetlandsLoader(parcel))
      .then((metrics) => {
        if (token !== renderToken) return;
        wetlands.replaceChildren(...wetlandRows(metrics));
      })
      .catch((error) => {
        if (token !== renderToken) return;
        const label = error?.status === 503
          ? 'PostGIS not configured'
          : error?.status === 502
            ? 'NWI temporarily unavailable'
            : 'Screening unavailable';
        wetlands.replaceChildren(row('NWI screening', label));
      });

    Promise.resolve()
      .then(() => soilsLoader(parcel))
      .then((summary) => {
        if (token !== renderToken) return;
        soils.replaceChildren(...soilRows(summary));
      })
      .catch((error) => {
        if (token !== renderToken) return;
        const label = error?.status === 502 ? 'USDA soils temporarily unavailable' : 'Screening unavailable';
        soils.replaceChildren(row('Soil screening', label));
      });

    Promise.resolve()
      .then(() => terrainLoader(parcel))
      .then((metrics) => {
        if (token !== renderToken) return;
        terrain.replaceChildren(...terrainRows(metrics));
      })
      .catch((error) => {
        if (token !== renderToken) return;
        const label = error?.status === 502 ? 'USGS terrain temporarily unavailable' : 'Screening unavailable';
        terrain.replaceChildren(row('Terrain', label));
      });
  }

  function destroy() {
    renderToken += 1;
    root.remove();
  }

  return { root, show, hide, destroy };
}

export default createBdpPropertyCard;
