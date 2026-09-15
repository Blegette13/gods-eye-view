import { fetchBdpParcelEnergy } from '../rrc/client.js';

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

export function createBdpPropertyCard({ energyLoader = fetchBdpParcelEnergy } = {}) {
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

    const disclaimer = document.createElement('p');
    disclaimer.textContent = 'RRC GIS metrics are preliminary screening data; survey, title, easement and operator verification remain separate due diligence.';
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
  }

  function destroy() {
    renderToken += 1;
    root.remove();
  }

  return { root, show, hide, destroy };
}

export default createBdpPropertyCard;
