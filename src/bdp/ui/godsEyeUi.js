import './godsEyeUi.css';

function replaceTitleText() {
  const titleBar = document.getElementById('title-bar');
  if (!titleBar) return;

  titleBar.dataset.bdpMode = 'true';

  const titleText = titleBar.querySelector('h1 > span:last-child');
  if (titleText) {
    titleText.replaceChildren();
    titleText.append(document.createTextNode("BDP GOD'S EYE "));
    const accent = document.createElement('span');
    accent.className = 'title-accent';
    accent.textContent = 'LAND';
    titleText.append(accent);
  }

  const subtitle = titleBar.querySelector('.subtitle');
  if (subtitle) subtitle.textContent = 'LAND ACQUISITION INTELLIGENCE';

  if (!titleBar.querySelector('.bdp-title-mode')) {
    const mode = document.createElement('span');
    mode.className = 'bdp-title-mode';
    mode.textContent = 'Texas parcel intelligence';
    titleBar.append(mode);
  }
}

function adaptLocationTray() {
  const search = document.getElementById('location-search');
  if (!search) return;
  search.placeholder = 'Search address, place or coordinates...';
  search.setAttribute('aria-label', 'Search map by address, place, or coordinates');
}

function adaptLayerPanel() {
  const dataToggles = document.getElementById('data-toggles');
  const panel = dataToggles?.closest('.panel-collapsible');
  const title = panel?.querySelector('.panel-title');
  if (title && title.textContent?.trim() === 'DATA LAYERS') {
    title.textContent = 'DATA LAYERS';
    title.title = 'Toggle God\'s Eye and BDP land-intelligence map layers';
  }
}

function applyNow() {
  document.title = "BDP God's Eye · Land Intelligence";
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
