import './godsEyeUi.css';
import './landSearch.css';
import './persistentSearch.css';
import './layerPreset.css';
import './workspace.css';
import './professionalTheme.css';
import { parseBdpLandSearch } from './landSearch.js';
import { BDP_LAYER_STATE_REGISTRY } from '../config/layerRegistry.js';
import { mountPersistentLandSearch } from './persistentSearch.js';
import { landLayerGroup, landLayerDisplayName } from './landLayerPresentation.js';

// Internal bdp-* IDs are intentionally preserved for data, share-state and DB compatibility.
const BDP_LAYER_IDS = new Set(BDP_LAYER_STATE_REGISTRY.map(({ id }) => id));

let layerObserver = null;

function replaceTitleText() {
  const titleBar = document.getElementById('title-bar');
  if (!titleBar) return;

  titleBar.dataset.bdpMode = 'true';

  const titleText = titleBar.querySelector('h1 > span:last-child');
  if (titleText) {
    titleText.replaceChildren();
    titleText.append(document.createTextNode('LAND '));
    const accent = document.createElement('span');
    accent.className = 'title-accent';
    accent.textContent = 'DEVELOPMENT';
    titleText.append(accent);
  }

  const subtitle = titleBar.querySelector('.subtitle');
  if (subtitle) subtitle.textContent = 'OPERATING SYSTEM';

  if (!titleBar.querySelector('.bdp-title-mode')) {
    const mode = document.createElement('span');
    mode.className = 'bdp-title-mode';
    mode.textContent = 'Texas preview';
    titleBar.append(mode);
  }
}

function signalLandSearchState(search, state, message = '') {
  search.dataset.bdpSearchState = state;
  search.title = message;
  if (state !== 'searching') search.classList.remove('searching');

  const status = document.getElementById('location-mini-poi');
  if (status && message) status.textContent = message;
  const visibleStatus = document.getElementById('land-search-status');
  if (visibleStatus) {
    visibleStatus.textContent = message;
    visibleStatus.dataset.searchState = state;
  }

  if (state === 'success' || state === 'error') {
    window.setTimeout(() => {
      if (search.dataset.bdpSearchState === state) delete search.dataset.bdpSearchState;
    }, 2600);
  }
}

function pendingMessage(command) {
  if (command.kind === 'owner') return `Searching ${command.county || 'Bexar'} parcels for owner ${command.value}…`;
  return `Looking up ${command.county || 'Bexar'} parcel ${command.value}…`;
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
  mountPersistentLandSearch();
  attachLandSearch(search);
}

function createPresetButton(mode, label, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bdp-layer-preset-button';
  button.dataset.bdpPreset = mode;
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', () => {
    if (button.dataset.busy === 'true') return;
    button.dataset.busy = 'true';
    button.setAttribute('aria-busy', 'true');
    window.dispatchEvent(new CustomEvent('bdp:layer-preset', {
      detail: { mode },
    }));
  });
  return button;
}

function createBdpLayerSectionLabel() {
  const section = document.createElement('div');
  section.className = 'bdp-layer-section-label';
  section.setAttribute('role', 'group');
  section.setAttribute('aria-label', 'Land development layers');

  const kicker = document.createElement('span');
  kicker.className = 'bdp-layer-section-kicker';
  kicker.textContent = 'Land';

  const title = document.createElement('span');
  title.className = 'bdp-layer-section-title';
  title.textContent = 'Available datasets';

  const rule = document.createElement('span');
  rule.className = 'bdp-layer-section-rule';
  rule.setAttribute('aria-hidden', 'true');

  const actions = document.createElement('span');
  actions.className = 'bdp-layer-section-actions';
  actions.append(
    createPresetButton('screen', 'Enable all', 'Enable all available land-screening map layers'),
    createPresetButton('clear', 'Clear', 'Turn off all land-screening map layers'),
  );

  section.append(kicker, title, rule, actions);
  return section;
}

function attachPresetFeedback() {
  if (document.body.dataset.bdpPresetFeedbackBound === 'true') return;
  document.body.dataset.bdpPresetFeedbackBound = 'true';

  window.addEventListener('bdp:layer-preset-result', (event) => {
    const result = event.detail || {};
    document.querySelectorAll('.bdp-layer-preset-button').forEach((button) => {
      button.dataset.busy = 'false';
      button.setAttribute('aria-busy', 'false');
    });

    const status = document.getElementById('location-mini-poi');
    if (!status) return;
    if (result.ok) {
      status.textContent = result.mode === 'clear'
        ? 'Land screening layers cleared'
        : `Land screen active · ${result.enabledCount || 0} layers`;
    } else {
      status.textContent = result.message || 'Land layer preset unavailable';
    }
  });
}

function createLandLayerCategoryLabel(group) {
  const section = document.createElement('div');
  section.className = 'bdp-layer-category-label';
  section.dataset.landGroup = group.id;
  section.setAttribute('role', 'heading');
  section.setAttribute('aria-level', '3');
  section.textContent = group.label;
  return section;
}

function decorateBdpLayerRows(container) {
  if (!container) return;

  const rows = [...container.querySelectorAll('.data-toggle-row')];
  let previousLandGroupId = null;
  for (const row of rows) {
    const isLand = BDP_LAYER_IDS.has(row.dataset.layerId);
    row.classList.toggle('bdp-layer-row', isLand);
    if (!isLand) continue;

    // Display name changes never touch the registered IDs or the manager's
    // source metadata. The original toggle buttons keep their event handlers.
    const name = row.querySelector('.data-name');
    if (name) {
      const label = landLayerDisplayName(name.textContent);
      if (name.textContent !== label) name.textContent = label;
    }

    const group = landLayerGroup(row.dataset.layerId);
    if (!group || previousLandGroupId === group.id) continue;
    previousLandGroupId = group.id;

    // Insert a heading at the first row of each consecutive group.
    // The data manager retains the original row order and click handlers.
    const previous = row.previousElementSibling;
    if (previous?.classList.contains('bdp-layer-category-label')
      && previous.dataset.landGroup === group.id) continue;
    if (previous?.classList.contains('bdp-layer-category-label')) previous.remove();
    row.before(createLandLayerCategoryLabel(group));
  }

  const firstBdpRow = rows.find((row) => BDP_LAYER_IDS.has(row.dataset.layerId));
  const existing = container.querySelector('.bdp-layer-section-label');

  if (!firstBdpRow) {
    existing?.remove();
    container.querySelectorAll('.bdp-layer-category-label').forEach((heading) => heading.remove());
    return;
  }

  const firstGroupHeading = firstBdpRow.previousElementSibling;
  const firstContent = firstGroupHeading?.classList.contains('bdp-layer-category-label')
    ? firstGroupHeading
    : firstBdpRow;
  if (existing?.nextElementSibling === firstContent) return;

  existing?.remove();
  firstContent.before(createBdpLayerSectionLabel());
}

function adaptLayerPanel() {
  const dataToggles = document.getElementById('data-toggles');
  const panel = dataToggles?.closest('.panel-collapsible');
  const title = panel?.querySelector('.panel-title');
  if (title && title.textContent?.trim() === 'DATA LAYERS') {
    title.textContent = 'Map layers';
    title.title = 'Toggle land-development map layers';
  }
  if (!dataToggles) return;

  attachPresetFeedback();
  decorateBdpLayerRows(dataToggles);
  layerObserver?.disconnect();
  if (typeof MutationObserver === 'function') {
    layerObserver = new MutationObserver(() => decorateBdpLayerRows(dataToggles));
    layerObserver.observe(dataToggles, { childList: true });
  }
}

function applyNow() {
  document.title = 'Land Development Operating System · Texas Pilot';
  document.body.dataset.bdpProduct = 'land-development-os';
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
