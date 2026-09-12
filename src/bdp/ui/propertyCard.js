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
  content.textContent = value || '—';
  content.style.color = '#f2f2f2';
  content.style.fontSize = '13px';
  content.style.lineHeight = '1.35';
  content.style.overflowWrap = 'anywhere';

  wrapper.append(key, content);
  return wrapper;
}

export function createBdpPropertyCard() {
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

  function hide() {
    root.style.display = 'none';
    root.replaceChildren();
  }

  function show(parcel) {
    if (!parcel) return hide();
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

    root.style.display = 'block';
  }

  function destroy() {
    root.remove();
  }

  return { root, show, hide, destroy };
}

export default createBdpPropertyCard;
