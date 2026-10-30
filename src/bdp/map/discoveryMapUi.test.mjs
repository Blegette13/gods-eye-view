import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  censusCountyUrl, countyForCriteria, countyPoint, validateCountyFeatures,
  radiusLineCoordinates, radiusEnvelope, countyBoundaryLines,
} from './discoveryGeography.js';
import { summarizeDiscoveryCandidates } from './discoveryFeedback.js';
import { normalizeLandCriteria } from '../acquisition/session.js';

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.dataset = {};
    this.children = [];
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.text = '';
    this.disabled = false;
    this.hidden = false;
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  remove() { this.removed = true; }
}

function fixture() {
  const body = new Element('body');
  const input = { value: '' };
  const document = {
    body, createElement: (tag) => new Element(tag),
    getElementById: (id) => id === 'location-search' ? input : null,
  };
  const subscriptions = new Map();
  const window = {
    addEventListener: (name, fn) => subscriptions.set(name, fn),
    removeEventListener: (name) => subscriptions.delete(name),
    dispatchEvent: (event) => subscriptions.get(event.type)?.(event),
  };
  class Event {
    constructor(type, { detail }) { this.type = type; this.detail = detail; }
  }
  const sources = [];
  const markers = [];
  let flights = 0;
  let markerClicked = null;
  const viewer = {
    scene: {
      canvas: {}, requestRender() {},
      pick: () => ({ id: markers[0] }),
    },
    dataSources: {
      async add(source) { sources.push(source); },
      remove(source) {
        const idx = sources.indexOf(source);
        if (idx >= 0) sources.splice(idx, 1);
      },
    },
    entities: {
      add(entity) { markers.push(entity); },
      removeById(id) {
        const idx = markers.findIndex((entry) => entry.id === id);
        if (idx >= 0) markers.splice(idx, 1);
      },
    },
    async flyTo() { flights += 1; },
  };
  const Cesium = {
    ScreenSpaceEventHandler: class {
      setInputAction(fn) { markerClicked = fn; }
      destroy() {}
    },
    ScreenSpaceEventType: { LEFT_CLICK: 1 },
    Color: {
      WHITE: 'white', TRANSPARENT: 'transparent',
      fromCssColorString: (name) => ({ name, withAlpha: (alpha) => ({ name, alpha }) }),
    },
    GeoJsonDataSource: { async load(featureCollection) { return { featureCollection }; } },
    Cartesian3: { fromDegrees: (longitude, latitude) => ({ longitude, latitude }) },
    HeightReference: { CLAMP_TO_GROUND: 1 },
    Cartesian2: class {},
    DistanceDisplayCondition: class {},
  };
  const polygon = { type: 'Polygon', coordinates: [[
    [-97.8, 30.2], [-97.7, 30.2], [-97.7, 30.3], [-97.8, 30.2],
  ]] };
  const feature = {
    type: 'Feature',
    properties: {
      GEOID: '48453', STATE: '48', NAME: 'Travis',
      INTPTLAT: '+30.245', INTPTLON: '-97.755',
    },
    geometry: polygon,
  };
  const source = readFileSync(new URL('./discoveryMap.js', import.meta.url), 'utf8')
    .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*/gm, '')
    .replace(/^export /gm, '');
  const create = runInNewContext(source + '\ncreateDiscoveryMap;', {
    Cesium, document, window, CustomEvent: Event, AbortController,
    fetch: async () => ({ ok: true, json: async () => ({
      type: 'FeatureCollection', features: [feature],
    }) }),
    console: { warn() {} },
    censusCountyUrl, countyForCriteria, countyPoint, validateCountyFeatures,
    radiusLineCoordinates, radiusEnvelope, countyBoundaryLines,
    summarizeDiscoveryCandidates,
  });
  return {
    create, body, window, Event, viewer, markers, sources, input, polygon,
    get flights() { return flights; },
    click: () => markerClicked?.({ position: { x: 1, y: 1 } }),
  };
}

function find(root, predicate) {
  return [root, ...root.children.flatMap((child) => find(child, predicate))].filter(predicate);
}

test('guided search replaces layers, tracks loaded match count and clears stale markers', async () => {
  const env = fixture();
  const criteria = normalizeLandCriteria({
    county: 'Travis', radiusMiles: 10, acresMin: 5, acresMax: 60,
    budgetMax: 600000, purpose: 'Residential development',
  });
  const map = env.create({ viewer: env.viewer, initialCriteria: criteria });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    const finder = find(env.body, (node) => node.id === 'land-discovery-finder')[0];
    const count = find(env.body, (node) => node.id === 'ldos-discovery-match-count')[0];
    const details = find(env.body, (node) => node.id === 'ldos-discovery-match-details')[0];
    assert.ok(finder);
    assert.equal(env.body.dataset.landProfile, 'active');
    assert.equal(env.body.dataset.landLayers, 'closed');
    assert.equal(count.textContent, 'Not evaluated yet');
    assert.equal(env.sources.length, 2, 'Census county boundary and radius use sourced data');
    assert.equal(env.flights, 1);

    const [enable, toggleLayers] = find(finder, (node) => node.tagName === 'button');
    let activated;
    env.window.addEventListener('land:discovery-enable-county', (event) => {
      activated = event.detail.county;
    });
    enable.listeners.click();
    assert.equal(activated, 'Travis', 'one-click enable must ask existing guarded manager');
    env.window.dispatchEvent(new env.Event('land:discovery-layer-result', {
      detail: { county: 'Travis', ok: true, status: 'zoom-in' },
    }));
    assert.match(details.textContent, /Zoom closer/);

    const parcels = Array.from({ length: 29 }, (_, i) => ({
      county: 'Travis', parcelId: String(i),
      property: { acres: 20, situsAddress: 'Austin TX 78704', geometry: env.polygon },
    }));
    env.window.dispatchEvent(new env.Event('land:parcel-viewport', {
      detail: { county: 'Travis', complete: true, reason: 'complete', parcels },
    }));
    assert.equal(count.textContent, '29 possible matches');
    assert.equal(env.markers.length, 24, 'map pin cap is not a false count cap');

    let searched = null;
    env.window.addEventListener('bdp:land-search', (event) => { searched = event.detail; });
    env.click();
    assert.equal(searched.kind, 'parcel');
    assert.equal(searched.county, 'Travis');
    assert.equal(env.input.value, 'Travis parcel: 0');

    env.window.dispatchEvent(new env.Event('land:parcel-viewport', {
      detail: { county: 'Travis', complete: false, reason: 'zoom-in', parcels: [] },
    }));
    assert.equal(count.textContent, 'Not evaluated yet');
    assert.equal(env.markers.length, 0);

    toggleLayers.listeners.click();
    assert.equal(env.body.dataset.landLayers, 'open');
    assert.equal(toggleLayers.attributes['aria-expanded'], 'true');
  } finally {
    map.destroy();
  }
});

test('browse-without-profile retains old map layer UI and does not claim candidates', async () => {
  const env = fixture();
  const map = env.create({ viewer: env.viewer });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(env.body.dataset.landProfile, 'browse');
    assert.equal(env.body.dataset.landLayers, 'open');
    const finder = find(env.body, (node) => node.id === 'land-discovery-finder')[0];
    assert.equal(finder.hidden, true);
    assert.equal(env.markers.length, 0);
  } finally {
    map.destroy();
  }
});
