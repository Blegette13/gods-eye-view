import assert from 'node:assert/strict';
import test from 'node:test';
import { createBdpPropertyCard } from './propertyCard.js';
import { evaluateAcquisitionEconomics } from '../economics/acquisitionEconomics.js';
import { buildOwnershipTitleReview } from '../title/ownershipReview.js';
import { buildAcquisitionBrief } from '../intelligence/acquisitionBrief.js';

// Minimal DOM for interaction tests without changing production dependencies.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.listeners = {}; this.value = ''; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map((child) => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  remove() {}
}
function find(root, predicate) {
  return [root, ...root.children.flatMap((child) => find(child, () => true))].filter(predicate);
}
const parcel = { parcelId: '123', county: 'Bexar', property: { acres: null, geometry: { type: 'Polygon' } }, valuation: { marketValue: null }, source: { recordCurrency: 'unknown' } };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function response(candidate) {
  return { evidence: { developmentConstraints: { status: 'incomplete-fema-coverage', combined_mapped_constraint_acres: 10, outside_mapped_footprint_acres: null }, acquisitionEconomics: evaluateAcquisitionEconomics(candidate), msw: { coverage_complete: false, nearest_msw_site_m: null }, growthRadar: { preliminary_plats_within_25_mi: 4 } }, errors: {},
    score: { readiness: 'insufficient-evidence', coveragePercent: 0, confidenceAdjustedCoveragePercent: 0 }, redFlags: [], redFlagSummary: { critical: 0, high: 0, medium: 0 }, sourceCoveragePercent: 0 };
}

test('native property panel keeps nulls unknown, shows Growth Radar and calculates explicit cost scenarios', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag), body: new Element('body') };
  let card;
  try {
    let resolveScreening;
    card = createBdpPropertyCard({ screeningLoader: () => new Promise((resolve) => { resolveScreening = resolve; }) });
    card.show(parcel);
    const rows = () => find(card.root, (el) => el.className === 'bdp-property-row');
    const valueFor = (key) => rows().find((el) => el.children[0].textContent === key)?.children[1].textContent;
    assert.equal(valueFor('Total value'), '—');
    assert.equal(valueFor('Verified vesting'), 'UNKNOWN');
    assert.equal(valueFor('Title clearance'), 'UNKNOWN');
    const lookup = find(card.root, (el) => el.tagName === 'a' && el.textContent === 'Open county land records')[0];
    assert.equal(lookup.href, 'https://www.bexar.org/2950/Real-PropertyLand-Records');
    assert.equal(lookup.rel, 'noopener noreferrer');
    assert.equal(valueFor('Asking price'), '—');
    assert.equal(valueFor('All-in basis'), '—');
    const input = (name) => find(card.root, (el) => el.tagName === 'input' && el.name === name)[0];
    input('askingPrice').value = '100000';
    for (const name of ['closingCosts', 'dueDiligenceCosts', 'siteWorkCosts', 'holdingCosts', 'dispositionCosts']) input(name).value = '0';
    input('exitPrice').value = '125000';
    input('targetReturnPercent').value = '25';
    const form = find(card.root, (el) => el.tagName === 'form')[0];
    form.listeners.submit({ preventDefault() {} });
    assert.equal(valueFor('All-in basis'), '$100,000');
    assert.equal(valueFor('Scenario profit'), '$25,000');
    assert.equal(valueFor('Residual max offer'), '$100,000');
    await tick();
    const screened = response(parcel);
    screened.evidence.ownershipTitle = buildOwnershipTitleReview(parcel, { energy: { pipeline_crossing_count: 1 } });
    screened.acquisitionBrief = buildAcquisitionBrief({ parcel, evidence: screened.evidence, score: screened.score,
      redFlags: [{ id: 'pipeline-crossing', severity: 'high', title: 'Pipeline brief trigger', detail: 'Easement dimensions require verification.', source: 'RRC' }] });
    resolveScreening(screened);
    await tick();
    // Late provider responses must not overwrite an edited scenario.
    assert.equal(valueFor('All-in basis'), '$100,000');
    assert.match(valueFor('PRIORITY · Survey / easements'), /Mapped pipeline/);
    assert.equal(valueFor('Verified legal access'), 'UNKNOWN');
    assert.equal(valueFor('Acquisition recommendation'), 'WITHHELD · VERIFICATION REQUIRED');
    assert.match(valueFor('HIGH · Pipeline brief trigger'), /Easement dimensions require verification/);
    const briefRisk = rows().find((el) => el.children[0].textContent === 'HIGH · Pipeline brief trigger');
    assert.deepEqual(JSON.parse(briefRisk.dataset.bdpEvidenceRefs), ['redFlags.pipeline-crossing']);
    assert.equal(valueFor('Nearest MSW ≤ 5 mi'), '—');
    assert.equal(valueFor('Points on parcel'), '—');
    assert.match(valueFor('MSW coverage'), /UNKNOWN/);
    assert.equal(valueFor('Preliminary plats ≤ 25 mi'), '4');
    assert.equal(valueFor('Combined footprint'), '10 ac');
    assert.equal(valueFor('Outside mapped footprint'), '—');
    assert.equal(valueFor('Verified buildable acres'), 'UNKNOWN');
    assert.match(valueFor('Economics score'), /WITHHELD/);
    input('siteWorkCosts').value = '';
    form.listeners.submit({ preventDefault() {} });
    assert.equal(valueFor('All-in basis'), '—');
    card.show({ ...parcel, parcelId: '456' });
    assert.equal(valueFor('HIGH · Pipeline brief trigger'), undefined);
    assert.equal(valueFor('Acquisition brief'), 'Loading evidence…');
    assert.equal(valueFor('PRIORITY · Survey / easements'), undefined);
    assert.equal(input('askingPrice').value, '');
    assert.equal(valueFor('All-in basis'), '—');
    card.hide();
  } finally {
    card?.destroy();
    globalThis.document = previous;
  }
});

test('late acquisition briefs cannot cross parcel selections and failed requests leave no loading verdict', async () => {
  const previous = globalThis.document;
  const previousWarn = console.warn;
  globalThis.document = { createElement: (tag) => new Element(tag), body: new Element('body') };
  console.warn = () => {};
  let card;
  try {
    const pending = new Map();
    card = createBdpPropertyCard({ screeningLoader: (candidate) => new Promise((resolve, reject) => pending.set(candidate.parcelId, { resolve, reject })) });
    card.show(parcel);
    await tick();
    card.show({ ...parcel, parcelId: '456' });
    await tick();
    const old = response(parcel);
    old.acquisitionBrief = buildAcquisitionBrief({ parcel, redFlags: [{ id: 'fema-floodway', severity: 'high', title: 'OLD PARCEL HAZARD', detail: 'Old evidence', source: 'FEMA' }] });
    pending.get('123').resolve(old);
    await tick();
    assert.ok(!card.root.textContent.includes('OLD PARCEL HAZARD'));
    pending.get('456').reject(new Error('Unavailable'));
    await tick();
    const briefRow = find(card.root, (el) => el.className === 'bdp-property-row' && el.children[0].textContent === 'Acquisition brief')[0];
    assert.equal(briefRow.children[1].textContent, 'Unavailable · no acquisition recommendation');
  } finally {
    card?.destroy();
    globalThis.document = previous;
    console.warn = previousWarn;
  }
});
