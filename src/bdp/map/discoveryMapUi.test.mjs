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
import { freeBrowseCountyUrl, countyFromFreeBrowseResponse,
  shouldDiscoverFreeParcels, freeBrowseVisibleParcels } from './freeBrowseParcels.js';

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

function fixture({ preview = null, named = null } = {}) {
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
  let moveEnd = null;
  const viewer = {
    camera: {
      positionCartographic: { height: 14000 },
      moveEnd: { addEventListener(fn) { moveEnd = fn; return () => { moveEnd = null; }; } },
    },
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
      add(entity) { markers.push(entity); return entity; },
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
    LabelStyle: { FILL_AND_OUTLINE: 1 },
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
    freeBrowseCountyUrl, countyFromFreeBrowseResponse,
    shouldDiscoverFreeParcels, freeBrowseVisibleParcels,
    MAX_FREE_BROWSE_ROWS: 500,
    cameraHeightMeters: (view) => view.camera.positionCartographic.height,
    frameFreeBrowse: (view) => { view.freeBrowseFramed = true; },
    freeBrowseLookPoint: () => ({ latitude: 30.27, longitude: -97.74 }),
    mountCameraAltimeter: () => ({ destroy() {} }),
    HIGH_ALTITUDE_DISCOVERY_COUNTIES: ['Travis'],
    fetchHighAltitudeDiscovery: async (options) => (typeof preview === 'function' ? preview(options) : preview) || { state: 'unsupported', results: [] },
    fetchGeographicLabels: async () => named || { cityLabels: [], highwayLabels: [], errors: [] },
  });
  return {
    create, body, window, Event, viewer, markers, sources, input, polygon,
    get flights() { return flights; },
    moved: () => moveEnd?.(),
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
    assert.equal(env.viewer.freeBrowseFramed, true, 'free browsing triggers district-scale framing');
    const finder = find(env.body, (node) => node.id === 'land-discovery-finder')[0];
    const legend = find(env.body, (node) => node.id === 'land-discovery-map-legend')[0];
    const sidebar = find(env.body, (node) => node.id === 'land-discovery-sidebar')[0];
    assert.equal(finder.hidden, true);
    assert.equal(legend.hidden, true, 'free browse must never overlay Map Layers with Search geography');
    assert.equal(env.sources.length, 1,
      'regional Census border still renders after the geography card is hidden');
    assert.deepEqual(sidebar.children, [finder, legend],
      'guided mode stacks Search geography below results, not over the globe');
    assert.equal(env.markers.length, 0);
  } finally {
    map.destroy();
  }
});

test('countywide source preview produces persistent clickable list before neighborhood zoom', async () => {
  const preliminary = {
    county: 'Travis', parcelId: '000302959',
    label: 'Sample Avenue, Austin TX',
    acresReported: 22,
    point: { lat: 30.24, lon: -97.755 }, evidence: ['Acreage (source reported)'],
  };
  const env = fixture({
    preview: {
      state: 'sample', results: [preliminary], returned: 81, complete: false,
      message: '1 provisional match in bounded countywide sample; not exhaustive.',
    },
    named: {
      cityLabels: [{ name: 'Austin', lat: 30.27, lon: -97.74, category: 'city' }],
      highwayLabels: [{ name: 'IH 35', lat: 30.25, lon: -97.72, category: 'highway' }],
      errors: [],
    },
  });
  const criteria = normalizeLandCriteria({
    county: 'Travis', radiusMiles: 10, acresMin: 10, acresMax: 60,
  });
  const map = env.create({ viewer: env.viewer, initialCriteria: criteria });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    const count = find(env.body, (node) => node.id === 'ldos-discovery-match-count')[0];
    const results = find(env.body, (node) => node.id === 'ldos-discovery-results')[0];
    assert.match(count.textContent, /1 source-sample match/);
    const cards = find(results, (node) => node.className === 'ldos-discovery-result');
    assert.equal(cards.length, 1);
    assert.match(cards[0].textContent, /000302959/);
    const selections = [];
    env.window.addEventListener('bdp:land-search', (event) => selections.push(event.detail));
    cards[0].listeners.click();
    assert.equal(selections[0].value, '000302959');
    assert.equal(selections[0].cameraRangeMultiplier, 2.3);
    assert.equal(env.input.value, 'Travis parcel: 000302959');
    assert.equal(env.body.dataset.landProfile, 'active', 'map search stays visible');
    assert.ok(find(env.body, (node) => node.id === 'land-discovery-finder')[0]);
    assert.equal(find(results, (node) => node.className === 'ldos-discovery-result').length, 1);
    const geographicLabels = env.markers.filter((item) => item.id.startsWith('ldos-navigation:'));
    assert.equal(geographicLabels.length, 2, 'real sourced city/highway names appear as map labels');
    const labelButton = find(env.body, (node) => node.className === 'ldos-label-toggle')[0];
    labelButton.listeners.click();
    assert.ok(geographicLabels.every((item) => item.show === false));
  } finally {
    map.destroy();
  }
});

test('load-more respects bounded source pages and deduplicates candidates without losing cards', async () => {
  const sourceRow = (id) => ({
    county: 'Travis', parcelId: id, label: 'Example GIS address',
    acresReported: 25, point: { lat: 30.24, lon: -97.75 },
    evidence: ['Acreage (source reported)'],
  });
  const seenOffsets = [];
  const env = fixture({
    preview: async ({ offset = 0 }) => {
      seenOffsets.push(offset);
      return offset === 0
        ? { state: 'sample', results: [sourceRow('001')], complete: false,
            sampled: 80, moreAvailable: true, message: 'First bounded source sample.' }
        : { state: 'sample', results: [sourceRow('001'), sourceRow('002')], complete: false,
            sampled: 80, moreAvailable: false, message: 'Second bounded source page.' };
    },
  });
  const criteria = normalizeLandCriteria({
    county: 'Travis', acresMin: 10, acresMax: 60,
  });
  const map = env.create({ viewer: env.viewer, initialCriteria: criteria });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    const more = find(env.body, (node) => node.className === 'ldos-discovery-more')[0];
    assert.equal(more.hidden, false);
    await more.listeners.click();
    const list = find(env.body, (node) => node.id === 'ldos-discovery-results')[0];
    const cards = find(list, (node) => node.className === 'ldos-discovery-result');
    assert.equal(cards.length, 2);
    assert.deepEqual(seenOffsets, [0, 80]);
    assert.equal(more.hidden, true);
    const count = find(env.body, (node) => node.id === 'ldos-discovery-match-count')[0];
    assert.match(count.textContent, /2 source-sample matches/);
  } finally {
    map.destroy();
  }
});

test('1.3km free browsing auto-resolves county and lists every rendered GIS parcel', async () => {
  const env = fixture();
  const activated = [];
  env.window.addEventListener('land:discovery-enable-county',
    (event) => activated.push(event.detail.county));
  const map = env.create({ viewer: env.viewer });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    env.viewer.camera.positionCartographic.height = 1301;
    env.moved();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(activated, [], 'parcels cannot auto-activate above the threshold');
    env.viewer.camera.positionCartographic.height = 1300;
    env.moved();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(activated, ['Travis']);
    const record = (id, acreage) => ({
      county: 'Travis', parcelId: id,
      property: { situsAddress: 'Source GIS Road', acres: acreage, geometry: env.polygon },
    });
    env.window.dispatchEvent(new env.Event('land:parcel-viewport', {
      detail: { county: 'Travis', complete: true, reason: 'complete',
        parcels: [record('00001', 1.1), record('00002', 2.2), record('00003', 3.3)] },
    }));
    const finder = find(env.body, (node) => node.id === 'land-discovery-finder')[0];
    const results = find(env.body, (node) => node.id === 'ldos-discovery-results')[0];
    const count = find(env.body, (node) => node.id === 'ldos-discovery-match-count')[0];
    assert.equal(finder.hidden, false);
    assert.equal(env.body.dataset.landBrowseResults, 'open');
    assert.equal(env.body.dataset.landLayers, 'closed');
    assert.equal(count.textContent, '3 mapped parcels');
    assert.equal(find(results, (node) => node.className === 'ldos-discovery-result').length, 3);

    const selections = [];
    env.window.addEventListener('bdp:land-search', (event) => selections.push(event.detail));
    const card = find(results, (node) => node.className === 'ldos-discovery-result')[1];
    card.listeners.click();
    assert.equal(selections[0].value, '00002', 'preserve leading zeros');
    assert.equal(selections[0].cameraRangeMultiplier, 2.3);
    env.window.dispatchEvent(new env.Event('land:parcel-viewport', {
      detail: { county: 'Travis', complete: false, reason: 'focused-search', parcels: [] },
    }));
    assert.equal(finder.hidden, false, 'left list stays mounted during Property Intelligence');
    assert.equal(find(results, (node) => node.className === 'ldos-discovery-result').length, 3);

    let ascended = null;
    env.window.addEventListener('land:discovery-free-zoomed-out', (event) => {
      ascended = event.detail.county;
    });
    env.viewer.camera.positionCartographic.height = 1301;
    env.moved();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ascended, 'Travis');
    assert.equal(finder.hidden, true);
    assert.equal(env.body.dataset.landLayers, 'open');
  } finally {
    map.destroy();
  }
});
