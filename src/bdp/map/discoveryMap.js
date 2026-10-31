import * as Cesium from 'cesium';
import {
  censusCountyUrl, countyForCriteria, countyPoint,
  validateCountyFeatures, radiusLineCoordinates, radiusEnvelope,
  countyBoundaryLines,
} from './discoveryGeography.js';
import { summarizeDiscoveryCandidates } from './discoveryFeedback.js';
import { fetchHighAltitudeDiscovery, HIGH_ALTITUDE_DISCOVERY_COUNTIES } from './highAltitudeDiscovery.js';
import { fetchGeographicLabels } from './geographicLabels.js';
import { frameFreeBrowse, freeBrowseLookPoint, mountCameraAltimeter, cameraHeightMeters } from './cameraAltitude.js';
import {
  freeBrowseCountyUrl, countyFromFreeBrowseResponse, shouldDiscoverFreeParcels,
  freeBrowseVisibleParcels, MAX_FREE_BROWSE_ROWS,
} from './freeBrowseParcels.js';

const icon = (className, text) => {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
};

/**
 * Public Census boundary overlay for the selected pilot county. A radius is
 * measured from Census INTPT (not the county edge or a particular address).
 * It is a geographic guide, not a claim of searched or available parcels.
 *
 * No synthetic geometry. Provider errors produce a visible "unavailable"
 * notice. County parcel layer source logic is completely separate.
 */
export function createDiscoveryMap({ viewer, initialCriteria = null } = {}) {
  if (!viewer?.dataSources || !viewer.scene) {
    throw new Error('Cesium viewer required for county discovery boundary');
  }
  let current = null;
  let controller = null;
  let sequence = 0;
  let sources = [];
  let destroyed = false;
  let censusCenter = null;
  let candidateMarkers = [];
  const viewportByCounty = new Map();
  let neighborsVisible = false;
  let boundaryAvailable = false;
  let sourcePreview = null;
  let sourceScan = null;
  let labelsScan = null;
  let navLabels = [];
  let navLabelsEnabled = true;
  const MAX_RESULT_CARDS = 40;
  let freeRows = null;
  let freeCoverage = null;
  let freeCounty = null;
  let freeRequest = null;
  let freeSequence = 0;
  let freeMapLayersOpen = false;
  let freeSnapshotPinned = false;
  const click = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  click.setInputAction((movement) => {
    const hit = viewer.scene.pick(movement.position);
    const id = hit?.id?.id;
    if (typeof id !== 'string' || !id.startsWith('ldos-candidate:')) return;
    const key = id.slice('ldos-candidate:'.length);
    const candidate = candidateMarkers.find((item) => item.county + ':' + item.parcelId === key);
    if (!candidate) return;
    const input = document.getElementById('location-search');
    if (input) input.value = `${candidate.county} parcel: ${candidate.parcelId}`;
    openProperty(candidate);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  const altimeter = mountCameraAltimeter(viewer);
  const sidebar = document.createElement('div');
  sidebar.id = 'land-discovery-sidebar';
  sidebar.setAttribute('aria-label', 'Land discovery tools');

  const legend = document.createElement('aside');
  legend.id = 'land-discovery-map-legend';
  legend.setAttribute('aria-label', 'County and radius map legend');
  const title = document.createElement('strong');
  title.textContent = 'Search geography';
  const description = document.createElement('p');
  description.className = 'ldos-map-legend-description';
  const rows = document.createElement('div');
  rows.className = 'ldos-map-legend-rows';
  const sourceLink = document.createElement('a');
  sourceLink.href = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer';
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener noreferrer';
  sourceLink.textContent = 'Boundaries: U.S. Census Bureau TIGERweb · preliminary mapping';
  legend.append(title, description, rows, sourceLink);
  // The geography legend lives below the property results, not over the globe.

  // Guided search replaces the full layer registry as the primary left-panel
  // action. Source layers remain accessible on demand, never deleted.
  const finder = document.createElement('aside');
  finder.id = 'land-discovery-finder';
  finder.setAttribute('aria-label', 'Guided property discovery');
  const finderKicker = document.createElement('span');
  finderKicker.className = 'ldos-finder-kicker';
  finderKicker.textContent = 'YOUR LAND SEARCH';
  const finderTitle = document.createElement('h2');
  const matchCount = document.createElement('strong');
  matchCount.id = 'ldos-discovery-match-count';
  matchCount.setAttribute('aria-live', 'polite');
  const matchDetails = document.createElement('p');
  matchDetails.id = 'ldos-discovery-match-details';
  const finderHelp = document.createElement('p');
  finderHelp.className = 'ldos-finder-help';
  finderHelp.textContent = 'Matches are preliminary GIS acreage/address evidence only. Budget, availability and permitted use remain UNKNOWN.';
  const finderActions = document.createElement('div');
  finderActions.className = 'ldos-finder-actions';
  const enableParcels = document.createElement('button');
  enableParcels.type = 'button';
  enableParcels.textContent = 'Enable county parcels';
  const layersButton = document.createElement('button');
  layersButton.type = 'button';
  layersButton.textContent = 'Map layers';
  layersButton.setAttribute('aria-expanded', 'false');
  layersButton.setAttribute('aria-controls', 'data-panel');
  enableParcels.addEventListener('click', () => {
    if (!current?.county) return;
    enableParcels.disabled = true;
    enableParcels.textContent = 'Enabling…';
    window.dispatchEvent(new CustomEvent('land:discovery-enable-county', {
      detail: { county: current.county },
    }));
  });
  layersButton.addEventListener('click', () => {
    const open = document.body.dataset.landLayers !== 'open';
    document.body.dataset.landLayers = open ? 'open' : 'closed';
    if (!current) freeMapLayersOpen = open;
    layersButton.setAttribute('aria-expanded', String(open));
    layersButton.textContent = open ? 'Hide map layers' : 'Map layers';
  });
  finderActions.append(enableParcels, layersButton);
  const labelButton = document.createElement('button');
  labelButton.type = 'button';
  labelButton.className = 'ldos-label-toggle';
  labelButton.setAttribute('aria-pressed', 'true');
  labelButton.textContent = 'City & highway labels: On';
  labelButton.addEventListener('click', () => {
    navLabelsEnabled = !navLabelsEnabled;
    labelButton.setAttribute('aria-pressed', String(navLabelsEnabled));
    labelButton.textContent = 'City & highway labels: ' + (navLabelsEnabled ? 'On' : 'Off');
    for (const entity of navLabels) entity.show = navLabelsEnabled;
    viewer.scene.requestRender?.();
  });
  finderActions.append(labelButton);
  const labelsStatus = document.createElement('p');
  labelsStatus.className = 'ldos-navigation-label-status';
  labelsStatus.setAttribute('role', 'status');
  labelsStatus.textContent = 'Map place and highway names: sourced from Census and TxDOT where available.';
  const resultsHeading = document.createElement('h3');
  resultsHeading.className = 'ldos-discovery-list-heading';
  resultsHeading.textContent = 'Property results';
  const results = document.createElement('ol');
  results.id = 'ldos-discovery-results';
  results.setAttribute('aria-label', 'Preliminary property candidates');
  const moreButton = document.createElement('button');
  moreButton.type = 'button';
  moreButton.className = 'ldos-discovery-more';
  moreButton.textContent = 'Load more county source records';
  moreButton.hidden = true;
  moreButton.addEventListener('click', async () => {
    const snapshot = sourcePreview;
    if (!current || snapshot?.state !== 'sample' || !snapshot.moreAvailable
        || snapshot.sampled >= 320) return;
    const token = sequence;
    sourceScan?.abort();
    sourceScan = new AbortController();
    const signal = sourceScan.signal;
    moreButton.disabled = true;
    moreButton.textContent = 'Loading more source records…';
    try {
      const page = await fetchHighAltitudeDiscovery({
        criteria: current, center: censusCenter,
        offset: snapshot.sampled, signal,
      });
      if (signal.aborted || token !== sequence || destroyed) return;
      const seen = new Map();
      for (const record of [...snapshot.results, ...page.results]) {
        seen.set(record.county + ':' + record.parcelId, record);
      }
      const combined = [...seen.values()];
      const loaded = snapshot.sampled + page.sampled;
      sourcePreview = {
        ...page,
        results: combined,
        sampled: loaded,
        moreAvailable: page.moreAvailable && loaded < 320,
        message: combined.length + ' provisional candidates among ' + loaded +
          ' sampled Travis GIS records. This is NOT a complete county/radius search.',
      };
      renderCandidateMarkers();
    } catch (error) {
      if (signal.aborted || token !== sequence || destroyed) return;
      matchDetails.textContent = 'Additional source page unavailable: ' + (error?.message || 'Source failure') +
        '. Previously fetched candidates remain visible.';
    } finally {
      if (!signal.aborted && token === sequence && !destroyed) {
        moreButton.disabled = false;
        moreButton.textContent = 'Load more county source records';
        moreButton.hidden = !sourcePreview?.moreAvailable;
      }
    }
  });
  finder.append(finderKicker, finderTitle, matchCount, matchDetails, finderHelp,
    finderActions, labelsStatus, resultsHeading, results, moreButton);
  sidebar.append(finder, legend);
  document.body.append(sidebar);

  function openProperty(candidate) {
    const input = document.getElementById('location-search');
    if (input) input.value = candidate.county + ' parcel: ' + candidate.parcelId;
    window.dispatchEvent(new CustomEvent('bdp:land-search', {
      detail: {
        kind: 'parcel', county: candidate.county,
        value: candidate.parcelId, cameraRangeMultiplier: 2.3,
      },
    }));
  }

  function availableResults(viewSummary) {
    const collected = new Map();
    // High-altitude county source samples are independent of current camera.
    for (const record of sourcePreview?.results || []) {
      collected.set(record.county + ':' + record.parcelId, record);
    }
    // As the operator explores, viewport results can enrich the list without
    // erasing the county preview or confusing the two different scan scopes.
    for (const record of viewSummary.pins) {
      const key = record.county + ':' + record.parcelId;
      if (!collected.has(key)) collected.set(key, record);
    }
    return [...collected.values()];
  }

  function renderResultList(records) {
    results.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('li');
      empty.className = 'ldos-discovery-result-empty';
      empty.textContent = !current
        ? 'No confirmed complete parcel list for this map view yet.'
        : sourcePreview?.state === 'loading'
          ? 'Searching the county source…'
          : 'No preview results available. Try another acreage range, or browse the map.';
      results.append(empty);
      return;
    }
    for (const candidate of records.slice(0, current ? MAX_RESULT_CARDS : MAX_FREE_BROWSE_ROWS)) {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ldos-discovery-result';
      const name = document.createElement('strong');
      name.textContent = candidate.label;
      const meta = document.createElement('span');
      const acres = candidate.acresReported;
      meta.textContent = candidate.county + ' · Parcel ' + candidate.parcelId +
        (typeof acres === 'number' && acres > 0 ? ' · ' + acres + ' reported ac' : ' · acreage UNKNOWN');
      const note = document.createElement('small');
      note.textContent = current
        ? 'Preliminary source match · View intelligence →'
        : 'Mapped source parcel · View intelligence →';
      button.append(name, meta, note);
      button.addEventListener('click', () => openProperty(candidate));
      row.append(button);
      results.append(row);
    }
  }

  function updateFinder() {
    const active = Boolean(current?.county);
    document.body.dataset.landProfile = active ? 'active' : 'browse';
    if (active && !document.body.dataset.landLayers) {
      document.body.dataset.landLayers = 'closed';
    }
    finder.hidden = !active;
    legend.hidden = !active;
    moreButton.hidden = !active || sourcePreview?.state !== 'sample' || !sourcePreview.moreAvailable;
    if (!active) {
      // Free browsing never pretends that every parcel is for sale. The left
      // list appears only after a real GIS snapshot has been rendered.
      const hasSnapshot = Boolean(freeCoverage && freeCounty
        && (freeSnapshotPinned || shouldDiscoverFreeParcels(cameraHeightMeters(viewer))));
      document.body.dataset.landBrowseResults = hasSnapshot ? 'open' : 'closed';
      finder.hidden = !hasSnapshot;
      legend.hidden = true;
      document.body.dataset.landLayers = hasSnapshot && !freeMapLayersOpen ? 'closed' : 'open';
      layersButton.textContent = freeMapLayersOpen ? 'Hide map layers' : 'Map layers';
      layersButton.setAttribute('aria-expanded', String(freeMapLayersOpen));
      if (!hasSnapshot) return;
      finderKicker.textContent = 'YOUR LAND SEARCH';
      finderTitle.textContent = 'Nearby · ' + freeCounty + ' County';
      matchCount.textContent = freeCoverage?.count === null
        ? 'Not evaluated yet'
        : freeRows.length + ' mapped ' + (freeRows.length === 1 ? 'parcel' : 'parcels');
      matchDetails.textContent = (freeCoverage?.message || 'Source coverage unverified') +
        (freeSnapshotPinned ? ' · Previous neighborhood snapshot; pan map to refresh.' : '');
      finderHelp.textContent = 'Map-view GIS records only. Sale availability, legal use, ownership and financial suitability are unverified.';
      enableParcels.hidden = true;
      labelButton.hidden = true;
      labelsStatus.hidden = true;
      moreButton.hidden = true;
      resultsHeading.textContent = 'Parcels in mapped neighborhood';
      renderResultList(freeRows);
      return;
    }
    document.body.dataset.landBrowseResults = 'closed';
    finderKicker.textContent = 'YOUR LAND SEARCH';
    finderHelp.textContent = 'Matches are preliminary GIS acreage/address evidence only. Budget, availability and permitted use remain UNKNOWN.';
    enableParcels.hidden = false;
    labelButton.hidden = false;
    labelsStatus.hidden = false;
    resultsHeading.textContent = 'Property results';
    const profile = current;
    finderTitle.textContent = profile.county + ' County' +
      (profile.radiusMiles ? ' · ' + profile.radiusMiles + ' mi' : '');
    if (!enableParcels.disabled && !enableParcels.textContent.startsWith('Retry')
        && !enableParcels.textContent.startsWith('Refresh')) {
      enableParcels.textContent = 'Enable ' + profile.county + ' parcels';
    }
    const summary = summarizeDiscoveryCandidates({
      criteria: current,
      center: censusCenter,
      viewports: [...viewportByCounty.values()],
    });
    if (sourcePreview?.state === 'loading') {
      matchCount.textContent = 'Searching county source…';
      matchDetails.textContent = 'Sampling real county GIS records independently of camera zoom. Results are NOT a complete county inventory.';
    } else if (sourcePreview?.state === 'sample') {
      const records = availableResults(summary);
      matchCount.textContent = sourcePreview.results.length + ' source-sample ' +
        (sourcePreview.results.length === 1 ? 'match' : 'matches');
      matchDetails.textContent = sourcePreview.message +
        (summary.count === null ? '' : ' Local map view: ' + summary.count + ' additional/overlapping preliminary matches.');
      renderResultList(records);
      return;
    } else if (sourcePreview?.state === 'error') {
      matchCount.textContent = 'County scan unavailable';
      matchDetails.textContent = sourcePreview.message + ' · ' + summary.message;
    } else {
      matchCount.textContent = summary.count === null
        ? 'Not evaluated yet'
        : summary.count + ' possible ' + (summary.count === 1 ? 'match' : 'matches');
      matchDetails.textContent = summary.message;
    }
    renderResultList(availableResults(summary));
  }
  const onLayerResult = (event) => {
    if (!current || event?.detail?.county !== current.county) return;
    enableParcels.disabled = false;
    enableParcels.textContent = event.detail.ok ? 'Refresh county parcels' : 'Retry county parcels';
    if (!event.detail.ok) {
      matchDetails.textContent = 'County parcel layer unavailable: ' + event.detail.message +
        '. No source-backed results can be claimed.';
    } else if (event.detail.status === 'zoom-in') {
      matchDetails.textContent = 'Parcel layer enabled. Zoom closer to a neighborhood to load source records and evaluate matching parcels.';
    }
  };
  window.addEventListener('land:discovery-layer-result', onLayerResult);


  function addLegendLine(kind, label) {
    const row = document.createElement('div');
    row.className = 'ldos-map-legend-item';
    row.append(icon(`ldos-map-key ldos-map-key-${kind}`, '—'), icon('', label));
    rows.append(row);
  }
  function clearNavigationLabels() {
    for (const entity of navLabels) viewer.entities.removeById(entity.id);
    navLabels = [];
    viewer.scene.requestRender?.();
  }

  function addNavigationLabels(data) {
    clearNavigationLabels();
    const taken = new Set();
    for (const item of [...data.cityLabels, ...data.highwayLabels]) {
      const key = item.category + ':' + item.name;
      if (taken.has(key)) continue;
      taken.add(key);
      const isCity = item.category === 'city';
      const entity = viewer.entities.add({
        id: 'ldos-navigation:' + key,
        position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, 120),
        label: {
          text: item.name,
          font: isCity ? 'bold 15px sans-serif' : 'bold 12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString('#153e57'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: !isCity,
          backgroundColor: Cesium.Color.fromCssColorString('#173e56').withAlpha(0.78),
          pixelOffset: new Cesium.Cartesian2(0, isCity ? -16 : -10),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isCity ? 550000 : 170000),
        },
      });
      entity.show = navLabelsEnabled;
      navLabels.push(entity);
    }
    viewer.scene.requestRender?.();
  }

  function clearCandidateMarkers() {
    for (const item of candidateMarkers) {
      viewer.entities.removeById('ldos-candidate:' + item.county + ':' + item.parcelId);
    }
    candidateMarkers = [];
  }

  function renderCandidateMarkers() {
    clearCandidateMarkers();
    const summary = summarizeDiscoveryCandidates({
      criteria: current, center: censusCenter,
      viewports: [...viewportByCounty.values()],
    });
    const combined = availableResults(summary);
    for (const candidate of combined.slice(0, 24)) {
      viewer.entities.add({
        id: 'ldos-candidate:' + candidate.county + ':' + candidate.parcelId,
        name: candidate.label,
        position: Cesium.Cartesian3.fromDegrees(candidate.point.lon, candidate.point.lat),
        point: {
          pixelSize: 11,
          color: Cesium.Color.fromCssColorString('#16866e'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: 'Possible source match',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#1a4153').withAlpha(0.9),
          font: '12px sans-serif',
          pixelOffset: new Cesium.Cartesian2(0, -20),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 30000),
        },
      });
      candidateMarkers.push(candidate);
    }
    updateFinder();
    viewer.scene.requestRender?.();
    return summary;
  }

  function status(message, { withNearby = false, withRadius = false } = {}) {
    rows.replaceChildren();
    if (current) addLegendLine('county', `${current.county} County (Census)`);
    if (withNearby) addLegendLine('neighbor', 'Neighbor county borders (context only)');
    if (withRadius) addLegendLine('radius', `${current.radiusMiles}-mile radius from Census county internal point`);
    if (candidateMarkers.length) addLegendLine('candidate', 'Green pins: tentative source-acreage / address matches');
    description.textContent = message;
  }

  async function erase() {
    for (const source of sources) viewer.dataSources.remove(source, true);
    sources = [];
    viewer.scene.requestRender?.();
  }
  async function loadLineSource(features, color, width) {
    const fc = countyBoundaryLines(features);
    if (!fc.features.length) throw new Error('County source contained no drawable boundary lines');
    return Cesium.GeoJsonDataSource.load(fc, {
      clampToGround: true,
      stroke: Cesium.Color.fromCssColorString(color).withAlpha(0.95),
      fill: Cesium.Color.TRANSPARENT,
      strokeWidth: width,
    });
  }
  async function fetchCounties(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Census boundary service HTTP ${response.status}`);
    return validateCountyFeatures(await response.json());
  }

  async function setCriteria(criteria) {
    const token = ++sequence;
    freeRequest?.abort();
    freeRequest = null;
    freeSequence++;
    freeRows = null;
    freeCoverage = null;
    freeCounty = null;
    freeSnapshotPinned = false;
    freeMapLayersOpen = false;
    sourceScan?.abort();
    sourceScan = null;
    labelsScan?.abort();
    labelsScan = null;
    clearNavigationLabels();
    sourcePreview = null;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const wasGuided = Boolean(current?.county);
    current = criteria?.county ? criteria : null;
    if (current && !wasGuided) document.body.dataset.landLayers = 'closed';
    if (!current) document.body.dataset.landLayers = 'open';
    await erase();
    censusCenter = null;
    boundaryAvailable = false;
    neighborsVisible = false;
    viewportByCounty.clear();
    clearCandidateMarkers();
    updateFinder();
    if (!current || destroyed) {
      // No county is necessary for Free Exploration. Frame the current local
      // district at a readable medium altitude, never a rooftop close-up or
      // statewide overview, while preserving user's map controls and layers.
      frameFreeBrowse(viewer);
      void activateFreeParcelDiscovery();
      status('Free browsing · county outlines shown for local context only.');
      if (viewer.camera) {
        const center = freeBrowseLookPoint(viewer);
        const lat = center.latitude;
        const lon = center.longitude;
        if (Number.isFinite(lat) && Number.isFinite(lon)
            && lat >= 25 && lat <= 37 && lon >= -107 && lon <= -93) {
          try {
            const nearby = await fetchCounties(censusCountyUrl({
              envelope: radiusEnvelope({ lat, lon }, 26),
            }), signal);
            if (signal.aborted || token !== sequence || destroyed) return;
            if (nearby.length > 0 && nearby.length <= 16) {
              const contextSource = await loadLineSource(nearby, '#869daf', 1.8);
              if (signal.aborted || token !== sequence || destroyed) return;
              await viewer.dataSources.add(contextSource);
              sources.push(contextSource);
              // In Free Explorer the native Map Layers panel owns the left rail.
              // Do NOT open the separate Search Geography card over it. The
              // sourced county outlines still render as contextual map lines.
              legend.hidden = true;
              viewer.scene.requestRender?.();
            }
          } catch (error) {
            if (signal.aborted || token !== sequence || destroyed) return;
            console.warn('Free-browse contextual county outlines unavailable:', error);
            legend.hidden = true;
          }
        }
      }
      return;
    }
    const selected = countyForCriteria(current);
    if (!selected) {
      status('This county has no supported source configuration.');
      return;
    }
    status('Loading official county outlines…');
    try {
      const features = await fetchCounties(censusCountyUrl({ geoid: selected.fips }), signal);
      if (signal.aborted || token !== sequence || destroyed) return;
      const county = features.find((feature) => feature.properties.GEOID === selected.fips);
      if (!county) throw new Error('Selected Census county ID was not returned');
      const point = countyPoint(county);
      if (!point) throw new Error('Census county internal point was not returned');
      censusCenter = point;
      updateFinder();
      let neighbors = [];
      let neighborsUnavailable = false;
      if (current.radiusMiles > 0) {
        try {
          const envelope = radiusEnvelope(point, current.radiusMiles);
          const nearby = await fetchCounties(censusCountyUrl({ envelope }), signal);
          if (nearby.length > 40) throw new Error('County response exceeds safe display scope');
          neighbors = nearby.filter((feature) => feature.properties.GEOID !== selected.fips);
        } catch (error) {
          if (signal.aborted) return;
          neighborsUnavailable = true;
          console.warn('Neighbor county outlines unavailable:', error);
        }
      }
      if (signal.aborted || token !== sequence || destroyed) return;
      const resultSources = [];
      try {
        if (neighbors.length) {
          resultSources.push(await loadLineSource(neighbors, '#8397a8', 1.5));
        }
        const main = await loadLineSource([county], '#1b64ab', 4);
        resultSources.push(main);
        if (current.radiusMiles > 0) {
          const circle = radiusLineCoordinates(point, current.radiusMiles);
          if (!circle.length) throw new Error('Radius geometry unavailable');
          resultSources.push(await Cesium.GeoJsonDataSource.load({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: { label: 'Search-radius guide, not a guarantee of parcel coverage' },
              geometry: { type: 'LineString', coordinates: circle },
            }],
          }, {
            clampToGround: true,
            stroke: Cesium.Color.fromCssColorString('#d47c39'),
            strokeWidth: 4,
          }));
        }
        if (signal.aborted || token !== sequence || destroyed) return;
        for (const source of resultSources) {
          await viewer.dataSources.add(source);
          sources.push(source);
        }
        boundaryAvailable = true;
        neighborsVisible = neighbors.length > 0;
        labelsScan = new AbortController();
        labelsStatus.textContent = 'Loading Census city and TxDOT highway labels…';
        const navController = labelsScan;
        void fetchGeographicLabels({
          countyFeature: county, point, radiusMiles: current.radiusMiles,
          signal: navController.signal,
        }).then((data) => {
          if (navController.signal.aborted || token !== sequence || destroyed) return;
          addNavigationLabels(data);
          labelsStatus.textContent = (data.cityLabels.length + data.highwayLabels.length) +
            ' sourced map names loaded · Census / TxDOT' +
            (data.errors.length ? ' · some sources unavailable' : '');
          if (data.errors.length) {
            console.warn('Some sourced navigation labels are unavailable:', data.errors.join(', '));
          }
        }).catch((error) => {
          if (navController.signal.aborted || token !== sequence || destroyed) return;
          labelsStatus.textContent = 'City/highway labels unavailable from source services; map remains navigable.';
          console.warn('Census/TxDOT map labels unavailable:', error);
        });
        // County discovery uses acreage predicates at the source itself. This
        // is bounded sampling, not an inaccurate promise of countywide counts.
        if (HIGH_ALTITUDE_DISCOVERY_COUNTIES.includes(current.county)) {
          sourceScan = new AbortController();
          const sampleController = sourceScan;
          sourcePreview = { state: 'loading', results: [] };
          updateFinder();
          void fetchHighAltitudeDiscovery({
            criteria: current, center: point, signal: sampleController.signal,
          }).then((snapshot) => {
            if (sampleController.signal.aborted || token !== sequence || destroyed) return;
            sourcePreview = snapshot;
            renderCandidateMarkers();
          }).catch((error) => {
            if (sampleController.signal.aborted || token !== sequence || destroyed) return;
            sourcePreview = {
              state: 'error', results: [],
              message: 'Travis countywide preview source error: ' +
                (error instanceof Error ? error.message : 'Unknown source failure'),
            };
            console.warn('High-altitude discovery unavailable:', error);
            updateFinder();
          });
        } else {
          sourcePreview = { state: 'unsupported', results: [] };
        }
        const summary = renderCandidateMarkers();
        status(
          neighborsUnavailable
            ? 'Source county line loaded; neighboring boundaries unavailable. Radius is a distance guide.'
            : 'Source geometry only · match totals appear in the left search panel for loaded parcel views.',
          { withRadius: current.radiusMiles > 0, withNearby: neighbors.length > 0 },
        );
        await viewer.flyTo(main, { duration: 1.5 });
        viewer.scene.requestRender?.();
      } finally {
        if (signal.aborted || token !== sequence || destroyed) {
          for (const source of resultSources) viewer.dataSources.remove(source, true);
        }
      }
    } catch (error) {
      if (signal.aborted || token !== sequence || destroyed) return;
      console.warn('Census county boundary unavailable:', error);
      status(`County boundary unavailable: ${error.message}. No guessed boundaries displayed.`);
    }
  }

  async function activateFreeParcelDiscovery() {
    if (current || destroyed) return;
    const height = cameraHeightMeters(viewer);
    if (!shouldDiscoverFreeParcels(height)) {
      // Hide actual county polygons as well as UI when zooming above 1.3 km.
      // The guarded manager only refreshes already-enabled layers.
      if (freeCounty) window.dispatchEvent(new CustomEvent('land:discovery-free-zoomed-out', {
        detail: { county: freeCounty },
      }));
      if (!freeSnapshotPinned) {
        freeRows = null;
        freeCoverage = null;
      }
      updateFinder();
      return;
    }
    const point = freeBrowseLookPoint(viewer);
    const url = freeBrowseCountyUrl({ lat: point.latitude, lon: point.longitude });
    if (!url) return;
    freeRequest?.abort();
    freeRequest = new AbortController();
    const signal = freeRequest.signal;
    const token = ++freeSequence;
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error('Census lookup HTTP ' + response.status);
      const county = countyFromFreeBrowseResponse(await response.json());
      if (signal.aborted || destroyed || current || token !== freeSequence
          || !shouldDiscoverFreeParcels(cameraHeightMeters(viewer))) return;
      if (!county) {
        freeRows = null;
        freeCounty = null;
        freeCoverage = null;
        updateFinder();
        return;
      }
      if (county !== freeCounty) {
        freeRows = [];
        freeCoverage = { count: null, complete: false,
          message: 'Checking county GIS parcel coverage at this camera view…' };
        freeSnapshotPinned = false;
        freeCounty = county;
        updateFinder();
      }
      // Calls exactly the existing guarded DataLayerManager. The manager
      // refreshes the same enabled layer on each camera move, and the county
      // adapter enforces viewport bounds, provider caps and 1.3km visibility.
      window.dispatchEvent(new CustomEvent('land:discovery-enable-county', {
        detail: { county, mode: 'free-browse' },
      }));
    } catch (error) {
      if (signal.aborted || destroyed || current || token !== freeSequence) return;
      console.warn('Free-browse Census county identification unavailable:', error);
    }
  }
  const onFreeCameraStop = () => { void activateFreeParcelDiscovery(); };
  const unlistenFreeCamera = viewer.camera?.moveEnd?.addEventListener?.(onFreeCameraStop);

  const onParcelViewport = (event) => {
    const { county, complete, parcels, reason, coverage } = event?.detail || {};
    if (typeof county !== 'string') return;
    viewportByCounty.set(county, {
      county,
      complete: complete === true,
      reason: reason || 'not-complete',
      parcels: complete && Array.isArray(parcels) ? parcels : [],
    });
    if (!current && !destroyed && county === freeCounty) {
      if (reason === 'focused-search') {
        // Keep the list while the selected parcel intelligence card opens.
        // Do not mislabel that list as the newly rendered entire viewport.
        freeSnapshotPinned = true;
        updateFinder();
      } else if (reason === 'complete' || reason === 'partial') {
        freeCoverage = freeBrowseVisibleParcels({county, parcels, complete, reason, coverage});
        freeRows = freeCoverage.rows;
        freeSnapshotPinned = false;
        updateFinder();
      } else if (['loading','zoom-in','over-limit','error'].includes(reason)) {
        freeRows = [];
        freeCoverage = {
          count: null, complete: false,
          message: reason === 'loading'
            ? 'Loading real county parcel polygons for this map view…'
            : reason === 'over-limit'
              ? 'County GIS response is too dense for complete coverage at this viewpoint. Zoom closer; no total can be claimed.'
              : reason === 'error'
                ? 'County GIS service unavailable. Parcel coverage is UNKNOWN; retry or browse another area.'
                : 'County GIS viewport exceeds the safe spatial range. Zoom closer or adjust the view.',
        };
        freeSnapshotPinned = false;
        updateFinder();
      }
      return;
    }
    if (!current || destroyed) return;
    renderCandidateMarkers();
    if (boundaryAvailable) {
      status('Boundary colors show geography only. Match counts reflect the current loaded map view.', {
        withRadius: current.radiusMiles > 0,
        withNearby: neighborsVisible,
      });
    }
  };
  window.addEventListener('land:parcel-viewport', onParcelViewport);

  updateFinder();
  status('Choose a county to display public geographic reference boundaries.');
  void setCriteria(initialCriteria);

  return Object.freeze({
    setCriteria,
    destroy() {
      destroyed = true;
      controller?.abort();
      sequence++;
      sourceScan?.abort();
      labelsScan?.abort();
      freeRequest?.abort();
      freeSequence++;
      if (typeof unlistenFreeCamera === 'function') unlistenFreeCamera();
      clearNavigationLabels();
      altimeter.destroy();
      window.removeEventListener('land:parcel-viewport', onParcelViewport);
      window.removeEventListener('land:discovery-layer-result', onLayerResult);
      click.destroy();
      clearCandidateMarkers();
      void erase();
      sidebar.remove();
      delete document.body.dataset.landProfile;
      delete document.body.dataset.landLayers;
      delete document.body.dataset.landBrowseResults;
    },
  });
}
