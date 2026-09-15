import './godsEyeUi.css';
import './landSearch.css';
import { parseBdpLandSearch } from './landSearch.js';

const BDP_LAYER_IDS = new Set([
  'bdp-bexar-parcels',
  'bdp-fema-flood',
  'bdp-rrc-energy',
  'bdp-nwi-wetlands',
  'bdp-ssurgo-soils',
]);

let layerObserver = null;

function replaceTitleText() {
  const titleBar = document.getElementById('title-bar');
  if (!titleBar) return;

  titleBar.dataset.bdpMode = 'true';

  const titleText = titleBar.querySelector('h1 > span:last-child');
  if (titleText) {
    titleText.replaceChildren();
    titleText.append(document.createTextNode("GOD'S EYE "));
    const accent = document.createElement('span');
    accent.className = 'title-accent';
    accent.textContent = 'VIEW';
    titleText.append(accent);
  }

  const subtitle = titleBar.querySelector('.subtitle');
  if (subtitle) subtitle.textContent = 'BDP LAND ACQUISITION INTELLIGENCE';

  if (!titleBar.querySelector('.bdp-title-mode')) {
    const mode = document.createElement('span');
    mode.className = 'bdp-title-mode';
    mode.textContent = 'Texas land intelligence';
    titleBar.append(mode);
  }
}

function signalLandSearchState(search, state, message = '') {
  search.dataset.bdpSearchState = state;
  search.title = message;
  if (state !== 'searching') search.classList.remove('searching');

  const status = document.getElementById('location-mini-poi');
  if (status && message) status.textContent = message;

  if (state === 'success' || state === 'error') {
    window.setTimeout(() => {
      if (search.dataset.bdpSearchState === state) delete search.dataset.bdpSearchState;
    }, 2600);
  }
}

function pendingMessage(command) {
  if (command.kind === 'owner') return `Searching Bexar parcels for owner ${command.value}…`;
  return `Looking up parcel ${command.value}…`;
}

function successMessage(result) {
  if (result.kind === 'owner') {
    const count = Number(result.count) || 0;
    return `${count} parcel${count === 1 ? '' : 's'} · owner ${result.query}`;
  }
  return `Parcel ${result.parcelId || result.query || ''} · ${result.owner || 'owner unavailable'}`;
}

function attachLandSearch(search) {
  if (!search || search.dataset.bdpLandSearchBound === 'true') return;
  search.dataset.bdpLandSearchBound = 'true';

  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const command = parseBdpLandSearch(search.value);
    if (!command) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    search.classList.add('searching');
    signalLandSearchState(search, 'searching', pendingMessage(command));
    window.dispatchEvent(new CustomEvent('bdp:land-search', { detail: command }));
  }, true);

  window.addEventListener('bdp:land-search-result', (event) => {
    const result = event.detail || {};
    if (result.ok) {
      signalLandSearchState(search, 'success', successMessage(result));
      return;
    }
    signalLandSearchState(
      search,
      'error',
      result.message || 'Land lookup unavailable',
    );
  });
}

function adaptLocationTray() {
  const search = document.getElementById('location-search');
  if (!search) return;
  search.placeholder = 'Address/place/coords · parcel: ID · owner: NAME';
  search.setAttribute('aria-label', 'Search map by address, place, coordinates, parcel id, or owner command');
  attachLandSearch(search);
}

function createBdpLayerSectionLabel() {
  const section = document.createElement('div');
  section.className = 'bdp-layer-section-label';
  section.setAttribute('role', 'separator');
  section.innerHTML = [
    '<span class="bdp-layer-section-kicker">BDP</span>',
    '<span class="bdp-layer-section-title">LAND INTELLIGENCE</span>',
    '<span class="bdp-layer-section-rule" aria-hidden="true"></span>',
  ].join('');
  return section;
}

function decorateBdpLayerRows(container) {
  if (!container) return;

  const rows = [...container.querySelectorAll('.data-toggle-row')];
  for (const row of rows) {
    row.classList.toggle('bdp-layer-row', BDP_LAYER_IDS.has(row.dataset.layerId));
  }

  const firstBdpRow = rows.find((row) => BDP_LAYER_IDS.has(row.dataset.layerId));
  const existing = container.querySelector('.bdp-layer-section-label');

  if (!firstBdpRow) {
    existing?.remove();
    return;
  }
  if (existing?.nextElementSibling === firstBdpRow) return;

  existing?.remove();
  firstBdpRow.before(createBdpLayerSectionLabel());
}

function adaptLayerPanel() {
  const dataToggles = document.getElementById('data-toggles');
  const panel = dataToggles?.closest('.panel-collapsible');
  const title = panel?.querySelector('.panel-title');
  if (title && title.textContent?.trim() === 'DATA LAYERS') {
    title.title = "Toggle God's Eye and BDP land-intelligence map layers";
  }
  if (!dataToggles) return;

  decorateBdpLayerRows(dataToggles);
  layerObserver?.disconnect();
  if (typeof MutationObserver === 'function') {
    layerObserver = new MutationObserver(() => decorateBdpLayerRows(dataToggles));
    layerObserver.observe(dataToggles, { childList: true });
  }
}

function applyNow() {
  document.title = "BDP · God's Eye View · Land Intelligence";
  document.body.dataset.bdpProduct = 'land-intelligence';
  replaceTitleText();
  adaptLocationTray();
  adaptLayerPanel();
}

export function applyBdpGodsEyeUi() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyNow, { once: true });
    return;
  }
  applyNow();
}

export default applyBdpGodsEyeUi;
