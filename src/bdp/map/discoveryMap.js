import * as Cesium from 'cesium';
import {
  censusCountyUrl, countyForCriteria, countyPoint,
  validateCountyFeatures, radiusLineCoordinates, radiusEnvelope,
  countyBoundaryLines,
} from './discoveryGeography.js';
import { suggestViewportParcels } from './candidateHints.js';

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
    window.dispatchEvent(new CustomEvent('bdp:land-search', {
      detail: { kind: 'parcel', county: candidate.county, value: candidate.parcelId },
    }));
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

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
  document.body.append(legend);

  function addLegendLine(kind, label) {
    const row = document.createElement('div');
    row.className = 'ldos-map-legend-item';
    row.append(icon(`ldos-map-key ldos-map-key-${kind}`, '—'), icon('', label));
    rows.append(row);
  }
  function clearCandidateMarkers() {
    for (const item of candidateMarkers) {
      viewer.entities.removeById('ldos-candidate:' + item.county + ':' + item.parcelId);
    }
    candidateMarkers = [];
  }

  function renderCandidateMarkers() {
    clearCandidateMarkers();
    if (!current || !censusCenter) return 0;
    for (const data of viewportByCounty.values()) {
      if (!data.complete || candidateMarkers.length >= 24) continue;
      const candidates = suggestViewportParcels({
        criteria: current, parcels: data.parcels, center: censusCenter,
        limit: 24 - candidateMarkers.length,
      });
      for (const candidate of candidates) {
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
            text: 'Possible match · ' + candidate.evidence.length + ' sourced field(s)',
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
    }
    viewer.scene.requestRender?.();
    return candidateMarkers.length;
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
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    current = criteria?.county ? criteria : null;
    await erase();
    censusCenter = null;
    clearCandidateMarkers();
    if (!current || destroyed) {
      status('No county selected. Choose a county in Edit criteria to display verified source boundaries.');
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
        const hints = renderCandidateMarkers();
        status(
          neighborsUnavailable
            ? 'Source county line loaded; neighboring boundaries unavailable. Radius is a distance guide.'
            : hints + ' preliminary parcel pins in loaded map views (maximum 24). Not a complete county inventory. Zoom closer and enable parcels for local suggestions.',
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

  const onParcelViewport = (event) => {
    const { county, complete, parcels } = event?.detail || {};
    if (typeof county !== 'string') return;
    viewportByCounty.set(county, {
      complete: complete === true,
      parcels: complete && Array.isArray(parcels) ? parcels : [],
    });
    if (!current || !censusCenter || destroyed) return;
    const n = renderCandidateMarkers();
    status(n + ' preliminary markers from complete loaded map views (max 24). Not countywide; prices and permitted uses UNKNOWN. Click a green pin for the source parcel.', {
      withRadius: current.radiusMiles > 0,
      withNearby: rows.textContent?.includes('Neighbor county borders') ?? false,
    });
  };
  window.addEventListener('land:parcel-viewport', onParcelViewport);

  status('Choose a county to display public geographic reference boundaries.');
  if (initialCriteria) void setCriteria(initialCriteria);

  return Object.freeze({
    setCriteria,
    destroy() {
      destroyed = true;
      controller?.abort();
      sequence++;
      window.removeEventListener('land:parcel-viewport', onParcelViewport);
      click.destroy();
      clearCandidateMarkers();
      void erase();
      legend.remove();
    },
  });
}
