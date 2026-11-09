import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { showLandDiscoveryGate } from './discoveryGate.js';
import { mountLandWorkspaces } from './acquisitionWorkspace.js';

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.value = '';
    this.hidden = false;
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() {
    return (this.text || '') + this.children.map((child) => child.textContent).join('');
  }
  append(...children) {
    this.children.push(...children);
    children.forEach((child) => { child.parentElement = this; });
  }
  replaceChildren(...children) { this.text = ''; this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((listener) => listener !== fn);
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
  }
  focus() {}
  querySelector(selector) {
    if (selector !== 'h1') return null;
    return find(this, (node) => node.tagName === 'h1')[0] || null;
  }
}

function find(element, predicate) {
  return [element, ...element.children.flatMap((child) => find(child, predicate))].filter(predicate);
}

function withDOM() {
  const body = new Element('body');
  const listeners = new Map();
  const winListeners = new Map();
  const doc = {
    body,
    createElement: (tag) => new Element(tag),
    getElementById: (id) => find(body, (node) => node.id === id)[0] || null,
    addEventListener: (type, fn) => {
      listeners.set(type, [...(listeners.get(type) || []), fn]);
    },
    removeEventListener: (type, fn) => {
      listeners.set(type, (listeners.get(type) || []).filter((listener) => listener !== fn));
    },
  };
  const win = {
    addEventListener: (type, fn) => {
      winListeners.set(type, [...(winListeners.get(type) || []), fn]);
    },
    removeEventListener: (type, fn) => {
      winListeners.set(type, (winListeners.get(type) || []).filter((listener) => listener !== fn));
    },
    dispatchEvent: (event) => {
      (winListeners.get(event.type) || []).forEach((listener) => listener(event));
    },
  };
  const originals = {
    document: globalThis.document,
    window: globalThis.window,
    CustomEvent: globalThis.CustomEvent,
  };
  globalThis.document = doc;
  globalThis.window = win;
  globalThis.CustomEvent = class {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
  return {
    doc, win, body,
    restore() {
      globalThis.document = originals.document;
      globalThis.window = originals.window;
      globalThis.CustomEvent = originals.CustomEvent;
    },
  };
}

test('startup waits for questionnaire resolution before calling the Cesium application start', () => {
  const main = readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
  const intake = main.indexOf('showLandDiscoveryGate()');
  const resolved = main.indexOf('.then((initialCriteria) => {', intake);
  const startup = main.indexOf('return application.start().then((components) => {', resolved);
  const mapReady = main.indexOf('mapDiscovery = createDiscoveryMap(', startup);
  assert.ok(intake >= 0, 'the questionnaire must open on launch');
  assert.ok(resolved > intake, 'startup must wait for questionnaire completion');
  assert.ok(startup > resolved, 'Cesium startup must occur inside the resolved intake');
  assert.ok(mapReady > startup, 'county overlays require the initialized Cesium viewer');
  assert.equal(main.slice(intake, startup).includes('application.start('), false,
    'no premature Cesium startup before onboarding');
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  assert.match(html, /<body data-land-entry="pending">/);
  assert.match(html, /:not\(#land-discovery-gate\)/);
});

test('user may skip or submit preferences before map UI is initialized', async () => {
  const env = withDOM();
  try {
    const pending = showLandDiscoveryGate();
    assert.equal(env.body.dataset.landEntry, 'pending');
    assert.ok(env.doc.getElementById('land-discovery-gate'));
    const fields = find(env.body, (node) => node.name);
    fields.find((node) => node.name === 'county').value = 'Bexar';
    fields.find((node) => node.name === 'radiusMiles').value = '25';
    fields.find((node) => node.name === 'purpose').value = 'Residential development';
    fields.find((node) => node.name === 'zip').value = '78205';
    fields.find((node) => node.name === 'budgetMax').value = '500000';
    const form = find(env.body, (node) => node.tagName === 'form')[0];
    form.listeners.submit[0]({ preventDefault() {} });
    const result = await pending;
    assert.equal(result.county, 'Bexar');
    assert.equal(result.radiusMiles, 25);
    assert.equal(result.zip, '78205');
    assert.equal(result.budgetMax, 500000);
    assert.equal(env.body.dataset.landEntry, 'complete');
    assert.equal(env.doc.getElementById('land-discovery-gate'), null);
    const skipped = showLandDiscoveryGate();
    find(env.body, (node) => node.textContent === 'Browse map without a search profile'
      && node.tagName === 'button')[0].listeners.click[0]();
    assert.equal(await skipped, null);
  } finally {
    env.restore();
  }
});

test('blank county with no preferences enters free map without validation', async () => {
  const env = withDOM();
  try {
    const ready = showLandDiscoveryGate();
    const form = find(env.body, (node) => node.tagName === 'form')[0];
    const county = find(form, (node) => node.name === 'county')[0];
    assert.equal(county.required, false);
    form.listeners.submit[0]({ preventDefault() {} });
    assert.equal(await ready, null);
    assert.equal(env.doc.getElementById('land-discovery-gate'), null);
  } finally {
    env.restore();
  }
});

test('guided search preferences with no county still require supported coverage', async () => {
  const env = withDOM();
  try {
    const ready = showLandDiscoveryGate();
    const form = find(env.body, (node) => node.tagName === 'form')[0];
    find(form, (node) => node.name === 'acresMin')[0].value = '12';
    form.listeners.submit[0]({ preventDefault() {} });
    const err = find(form, (node) => node.className === 'ldos-criteria-error')[0];
    assert.match(err.textContent, /Select a supported Texas county/);
    const skip = find(form, (node) => node.className === 'ldos-welcome-skip')[0];
    skip.listeners.click[0]();
    assert.equal(await ready, null);
  } finally {
    env.restore();
  }
});

test('session shortlist creates separate stage board, moves parcel, and returns to map', async () => {
  const env = withDOM();
  let instance;
  try {
    instance = mountLandWorkspaces({ initialCriteria: {
      county: 'Bexar', radiusMiles: 25, purpose: 'Residential development', zip: '78205',
      budgetMax: 500000, acresMin: 2, acresMax: 10,
    } });
    assert.equal(env.body.dataset.landView, 'map');
    const board = env.doc.getElementById('land-acquisition-board');
    assert.ok(board);
    assert.equal(board.hidden, true);
    env.win.dispatchEvent(new CustomEvent('land:acquisition-add', {
      detail: { parcel: {
        county: 'Bexar', parcelId: '0002',
        property: { situsAddress: '2 Example Drive San Antonio 78205', acres: 3 },
        source: { provider: 'County GIS', recordCurrency: 'unverified' },
      } },
    }));
    assert.equal(env.body.dataset.landView, 'acquisitions');
    assert.equal(board.hidden, false);
    assert.equal(instance.entries().length, 1);
    assert.equal(find(board, (node) => node.className === 'ldos-board-lane').length, 6);
    const select = find(board, (node) => node.tagName === 'select')[0];
    select.value = 'Due Diligence';
    select.listeners.change[0]({});
    assert.equal(instance.entries()[0].stage, 'Due Diligence');
    assert.match(board.textContent, /Budget \/ asking price: Unknown/);
    const toMap = find(board, (node) => node.tagName === 'button'
      && node.textContent === 'View on map')[0];
    toMap.listeners.click[0]();
    assert.equal(env.body.dataset.landView, 'map');
    assert.equal(board.hidden, true);
  } finally {
    instance?.destroy();
    env.restore();
  }
});

test('Browse freely clears county preferences but preserves the session acquisition board', async () => {
  const env = withDOM();
  let workspace;
  try {
    const updates = [];
    workspace = mountLandWorkspaces({
      initialCriteria: { county: 'Travis', radiusMiles: 50, purpose: '', zip: '',
        budgetMax: null, acresMin: 10, acresMax: 60 },
      onCriteriaChange: (value) => updates.push(value),
    });
    env.win.dispatchEvent(new CustomEvent('land:acquisition-add', {
      detail: { parcel: { county: 'Travis', parcelId: '00045', property: { situsAddress: 'Source address' } } },
    }));
    const browse = find(env.body, (node) => node.tagName === 'button'
      && node.textContent === 'Browse freely')[0];
    assert.equal(browse.hidden, false);
    browse.listeners.click[0]();
    assert.equal(workspace.getCriteria(), null);
    assert.equal(updates.at(-1), null);
    assert.equal(env.body.dataset.landView, 'map');
    assert.equal(workspace.entries().length, 1, 'do not destroy saved session candidates');
    assert.equal(browse.hidden, true);
  } finally {
    workspace?.destroy();
    env.restore();
  }
});
