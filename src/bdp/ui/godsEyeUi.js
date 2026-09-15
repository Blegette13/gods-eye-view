import './godsEyeUi.css';

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

function adaptLocationTray() {
  const search = document.getElementById('location-search');
  if (!search) return;
  search.placeholder = 'Search address, place or coordinates...';
  search.setAttribute('aria-label', 'Search map by address, place, or coordinates');
}

function decorateBdpLayerRows(container) {
  if (!container) return;

  container.querySelectorAll('.bdp-layer-section-label').forEach((node) => node.remove());
  const rows = [...container.querySelectorAll('.data-toggle-row')];
  for (const row of rows) {
    row.classList.toggle('bdp-layer-row', BDP_LAYER_IDS.has(row.dataset.layerId));
  }

  const firstBdpRow = rows.find((row) => BDP_LAYER_IDS.has(row.dataset.layerId));
  if (!firstBdpRow) return;

  const section = document.createElement('div');
  section.className = 'bdp-layer-section-label';
  section.setAttribute('role', 'separator');
  section.innerHTML = [
    '<span class="bdp-layer-section-kicker">BDP</span>',
    '<span class="bdp-layer-section-title">LAND INTELLIGENCE</span>',
    '<span class="bdp-layer-section-rule" aria-hidden="true"></span>',
  ].join('');
  firstBdpRow.before(section);
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
