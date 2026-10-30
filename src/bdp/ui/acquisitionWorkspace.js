import {
  ACQUISITION_STAGES, createAcquisitionSession, reviewLandCriteria,
} from '../acquisition/session.js';
import { showLandDiscoveryGate } from './discoveryGate.js';
import { ratePreferenceEvidence } from '../acquisition/preferenceRating.js';

const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
};
function button(label, className, callback) {
  const element = make('button', className, label);
  element.type = 'button';
  element.addEventListener('click', callback);
  return element;
}
function formatCriteria(criteria) {
  if (!criteria) return ['No preferences set'];
  const labels = [];
  if (criteria.county) labels.push(`${criteria.county} County`);
  if (criteria.radiusMiles > 0) labels.push(`${criteria.radiusMiles}-mile radius · Census center`);
  if (criteria.purpose) labels.push(criteria.purpose);
  if (criteria.zip) labels.push(`ZIP ${criteria.zip}`);
  if (criteria.budgetMax !== null) labels.push(`Budget ≤ $${criteria.budgetMax.toLocaleString('en-US')}`);
  if (criteria.acresMin !== null || criteria.acresMax !== null) {
    labels.push(`Acres ${criteria.acresMin ?? 'any'} – ${criteria.acresMax ?? 'any'}`);
  }
  return labels.length ? labels : ['No preferences set'];
}

/**
 * Separate screen and interactive session pipeline. The Cesium/parcel manager
 * remains mounted for returning to Map Explorer, but its UI is hidden and
 * cannot receive pointer events while the acquisition screen is active.
 *
 * Not a CRM or a security boundary: auth + Postgres RLS-backed saves belong
 * to a later backend milestone. No localStorage persistence or account claims.
 */
export function mountLandWorkspaces({ initialCriteria = null, onCriteriaChange = null } = {}) {
  const acquisitions = createAcquisitionSession();
  let criteria = initialCriteria;
  let current = 'map';

  const nav = make('nav', 'ldos-workspace-nav');
  nav.id = 'land-workspace-nav';
  nav.setAttribute('aria-label', 'Land development workspace');
  const mapButton = button('Map explorer', 'ldos-nav-button', () => open('map'));
  const boardButton = button('Acquisition board · 0', 'ldos-nav-button', () => open('acquisitions'));
  const refineButton = button('Edit criteria', 'ldos-nav-button ldos-nav-minor', async () => {
    const edited = await showLandDiscoveryGate();
    if (edited !== null) {
      criteria = edited;
      onCriteriaChange?.(criteria);
    }
    renderBoard();
  });
  nav.append(mapButton, boardButton, refineButton);

  const board = make('main', 'ldos-acquisition-screen');
  board.id = 'land-acquisition-board';
  board.hidden = true;
  board.setAttribute('aria-label', 'Acquisition board');
  // Keep native select, button and keyboard controls working here while
  // stopping upstream map shortcuts attached at document/window bubble phase.
  board.addEventListener('keydown', (event) => event.stopPropagation());
  nav.addEventListener('keydown', (event) => event.stopPropagation());
  const header = make('div', 'ldos-board-header');
  const headingBlock = make('div', '');
  headingBlock.append(
    make('p', 'ldos-board-eyebrow', 'ACQUISITIONS · TEXAS PILOT'),
    make('h1', '', 'Acquisition board'),
    make('p', 'ldos-board-lede', 'Move shortlisted parcels through your acquisition process. Records remain preliminary until independently verified.'),
  );
  header.append(headingBlock, button('Back to map →', 'ldos-board-back', () => open('map')));
  const sessionNotice = make('p', 'ldos-board-session-notice',
    'SESSION PREVIEW — Your shortlist and preferences are not stored in an account. They will be lost on reload or closing this tab. No property is approved, market-listed, or cleared for development by this board.');
  const criteriaBlock = make('section', 'ldos-board-criteria');
  const lanes = make('div', 'ldos-board-lanes');
  lanes.setAttribute('aria-label', 'Acquisition pipeline stages');
  board.append(header, sessionNotice, criteriaBlock, lanes);

  function open(view) {
    current = view === 'acquisitions' ? 'acquisitions' : 'map';
    document.body.dataset.landView = current;
    board.hidden = current !== 'acquisitions';
    mapButton.setAttribute('aria-current', current === 'map' ? 'page' : 'false');
    boardButton.setAttribute('aria-current', current === 'acquisitions' ? 'page' : 'false');
    if (current === 'acquisitions') {
      renderBoard();
      board.scrollTop = 0;
      board.querySelector('h1')?.focus?.();
    } else {
      document.getElementById('location-search')?.focus?.();
    }
  }

  function renderBoard() {
    const entries = acquisitions.all();
    boardButton.textContent = `Acquisition board · ${entries.length}`;
    criteriaBlock.replaceChildren();
    const top = make('div', 'ldos-board-criteria-top');
    top.append(make('h2', '', 'Your search criteria'), button('Update', 'ldos-board-link', async () => {
      const edited = await showLandDiscoveryGate();
      if (edited !== null) {
        criteria = edited;
        onCriteriaChange?.(criteria);
      }
      renderBoard();
    }));
    const tags = make('div', 'ldos-board-criteria-tags');
    for (const label of formatCriteria(criteria)) tags.append(make('span', 'ldos-criteria-tag', label));
    const help = make('p', 'ldos-board-criteria-note',
      'These are preferences, not automatic qualification. GIS acreage and situs ZIPs are provisional; asking prices and legally permitted uses may be unknown.');
    criteriaBlock.append(top, tags, help);

    lanes.replaceChildren();
    for (const stage of ACQUISITION_STAGES) {
      const items = entries.filter((entry) => entry.stage === stage);
      const lane = make('section', 'ldos-board-lane');
      lane.setAttribute('aria-label', stage);
      const laneHeader = make('div', 'ldos-board-lane-title');
      laneHeader.append(make('h2', '', stage), make('span', 'ldos-stage-count', items.length));
      lane.append(laneHeader);
      if (items.length === 0) {
        lane.append(make('p', 'ldos-board-lane-empty', 'No parcels in this stage.'));
      }
      for (const entry of items) {
        const card = make('article', 'ldos-acquisition-card');
        card.append(
          make('div', 'ldos-acquisition-county', `${entry.county} County · Source record`),
          make('h3', '', entry.address),
          make('p', 'ldos-acquisition-id', `Parcel ID: ${entry.parcelId}`),
          make('p', 'ldos-acquisition-owner', `CAD-listed owner: ${entry.ownerReported}`),
          make('p', 'ldos-acquisition-acres', `Reported acres: ${entry.acresReported ?? 'UNKNOWN'}`),
          make('p', 'ldos-acquisition-provider', `Source: ${entry.provider || 'UNKNOWN'}`),
          make('p', 'ldos-acquisition-unknown', `Source currency: ${entry.recordCurrency.toUpperCase()} · Not a listing or title verification`),
        );
        const fit = ratePreferenceEvidence(criteria, entry);
        const rating = make('div', 'ldos-property-fit-rating');
        rating.dataset.fit = fit.label === 'Source-reported mismatch' ? 'outside'
          : fit.label === 'Possible profile match' ? 'possible' : 'unknown';
        rating.append(
          make('strong', '', `Profile fit · ${fit.label}`),
          make('span', '', fit.configured
            ? `${fit.matched} reported matches · ${fit.outside} outside · ${fit.unknown} unknown (${fit.configured} criteria)`
            : 'No profile criteria to compare'),
          make('small', '', 'Use-specific suitability and purchase value are NOT SCORED. Verify zoning, allowed business use, price and site constraints.'),
        );
        card.append(rating);
        const findings = reviewLandCriteria(criteria, entry);
        if (findings.length) {
          const matches = make('div', 'ldos-acquisition-findings');
          for (const finding of findings) {
            const text = finding.status === 'reported-match'
              ? 'Source indicates match'
              : finding.status === 'reported-outside'
                ? 'Source indicates outside'
                : 'Unknown';
            const badge = make('span', 'ldos-finding', `${finding.field}: ${text}`);
            badge.dataset.finding = finding.status;
            matches.append(badge);
          }
          card.append(matches);
        }
        const stageLabel = make('label', 'ldos-board-stage-field');
        stageLabel.append(make('span', '', 'Pipeline stage'));
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Pipeline stage for ${entry.address}`);
        for (const optionName of ACQUISITION_STAGES) {
          const option = make('option', '', optionName);
          option.value = optionName;
          option.selected = optionName === entry.stage;
          select.append(option);
        }
        select.addEventListener('change', () => {
          acquisitions.move(entry.key, select.value);
          renderBoard();
        });
        stageLabel.append(select);
        const actions = make('div', 'ldos-board-card-actions');
        actions.append(
          button('View on map', 'ldos-board-link', () => {
            open('map');
            const input = document.getElementById('location-search');
            if (input) input.value = `${entry.county} parcel: ${entry.parcelId}`;
            window.dispatchEvent(new CustomEvent('bdp:land-search', {
              detail: { kind: 'parcel', county: entry.county, value: entry.parcelId },
            }));
          }),
          button('Remove', 'ldos-board-remove', () => {
            acquisitions.remove(entry.key);
            renderBoard();
          }),
        );
        card.append(stageLabel, actions);
        lane.append(card);
      }
      lanes.append(lane);
    }
  }

  const onSave = (event) => {
    const added = acquisitions.add(event?.detail?.parcel);
    if (!added) return;
    renderBoard();
    open('acquisitions');
  };
  window.addEventListener('land:acquisition-add', onSave);
  document.body.append(nav, board);
  renderBoard();
  open('map');

  return Object.freeze({
    open, getCriteria: () => criteria, entries: acquisitions.all,
    destroy() {
      window.removeEventListener('land:acquisition-add', onSave);
      nav.remove(); board.remove();
      delete document.body.dataset.landView;
    },
  });
}
