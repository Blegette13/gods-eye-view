export const BDP_TERRAIN_API_BASE = '/api/bdp/terrain';
export const USGS_3DEP_IMAGE_SERVER =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
export const USGS_3DEP_STATS_URL = `${USGS_3DEP_IMAGE_SERVER}/computeStatisticsHistograms`;
export const TERRAIN_MAX_PARCEL_POSITIONS = 20_000;
export const TERRAIN_MAX_PARCEL_SPAN_DEGREES = 1.5;
export const TERRAIN_SCREENING_PIXEL_SIZE_METERS = 10;

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function signedArea(ring) {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function orientRing(ring, clockwise) {
  const isClockwise = signedArea(ring) < 0;
  return isClockwise === clockwise ? ring : [...ring].reverse();
}

function validateRing(ring, state, { clockwise }) {
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new Error('Parcel polygon ring must contain at least four positions');
  }
  const positions = ring.map((position) => {
    if (!Array.isArray(position) || position.length < 2) {
      throw new Error('Parcel geometry contains an invalid coordinate');
    }
    const longitude = finiteNumber(position[0], 'longitude');
    const latitude = finiteNumber(position[1], 'latitude');
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      throw new Error('Parcel geometry contains coordinates outside WGS84 bounds');
    }
    state.positions += 1;
    state.west = Math.min(state.west, longitude);
    state.south = Math.min(state.south, latitude);
    state.east = Math.max(state.east, longitude);
    state.north = Math.max(state.north, latitude);
    if (state.positions > TERRAIN_MAX_PARCEL_POSITIONS) {
      throw new Error('Parcel geometry is too complex for a terrain screening request');
    }
    return [longitude, latitude];
  });
  const first = positions[0];
  const last = positions.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new Error('Parcel polygon rings must be closed');
  }
  return orientRing(positions, clockwise);
}

function polygonRings(coordinates, state) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw new Error('Parcel polygon coordinates are required');
  }
  return coordinates.map((ring, index) => validateRing(ring, state, {
    clockwise: index === 0,
  }));
}

export function normalizeTerrainParcelRequest(input = {}) {
  const geometry = input?.geometry;
  if (!geometry || typeof geometry !== 'object') throw new Error('Parcel geometry is required');
  if (!['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error('Parcel geometry must be a Polygon or MultiPolygon');
  }

  const state = {
    positions: 0,
    west: Infinity,
    south: Infinity,
    east: -Infinity,
    north: -Infinity,
  };
  const polygons = geometry.type === 'Polygon'
    ? [polygonRings(geometry.coordinates, state)]
    : geometry.coordinates.map((polygon) => polygonRings(polygon, state));

  if (
    state.east - state.west > TERRAIN_MAX_PARCEL_SPAN_DEGREES
    || state.north - state.south > TERRAIN_MAX_PARCEL_SPAN_DEGREES
  ) {
    throw new Error(`Parcel terrain screening span must be ${TERRAIN_MAX_PARCEL_SPAN_DEGREES} degrees or smaller`);
  }

  return Object.freeze({
    arcgisGeometry: Object.freeze({
      rings: Object.freeze(polygons.flat()),
      spatialReference: Object.freeze({ wkid: 4326 }),
    }),
    positions: state.positions,
  });
}

export function build3depStatisticsUrl(input, { mode = 'elevation' } = {}) {
  const request = normalizeTerrainParcelRequest(input);
  if (!['elevation', 'slope'].includes(mode)) throw new Error(`Unsupported terrain statistics mode: ${mode}`);
  const renderingRule = mode === 'slope'
    ? { rasterFunction: 'Slope Degrees' }
    : { rasterFunction: 'None' };
  const params = new URLSearchParams({
    geometryType: 'esriGeometryPolygon',
    geometry: JSON.stringify(request.arcgisGeometry),
    renderingRule: JSON.stringify(renderingRule),
    pixelSize: `${TERRAIN_SCREENING_PIXEL_SIZE_METERS},${TERRAIN_SCREENING_PIXEL_SIZE_METERS}`,
    f: 'json',
  });
  return `${USGS_3DEP_STATS_URL}?${params.toString()}`;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeArcgisBandStatistics(payload) {
  const statistic = Array.isArray(payload?.statistics) ? payload.statistics[0] : null;
  if (!statistic) throw new Error('USGS 3DEP returned no raster statistics');
  return Object.freeze({
    min: finiteOrNull(statistic.min),
    max: finiteOrNull(statistic.max),
    mean: finiteOrNull(statistic.mean),
    standardDeviation: finiteOrNull(statistic.standardDeviation),
    count: finiteOrNull(statistic.count),
  });
}

function metersToFeet(value) {
  return Number.isFinite(value) ? value * 3.280839895 : null;
}

function terrainClass(meanSlope) {
  if (!Number.isFinite(meanSlope)) return 'unknown';
  if (meanSlope < 5) return 'gentle';
  if (meanSlope < 10) return 'moderate';
  if (meanSlope < 20) return 'steep';
  return 'very-steep';
}

export function summarizeTerrainStatistics(elevationPayload, slopePayload) {
  const elevation = normalizeArcgisBandStatistics(elevationPayload);
  const slope = normalizeArcgisBandStatistics(slopePayload);
  const reliefMeters = Number.isFinite(elevation.min) && Number.isFinite(elevation.max)
    ? elevation.max - elevation.min
    : null;

  return Object.freeze({
    elevation: Object.freeze({
      minMeters: elevation.min,
      maxMeters: elevation.max,
      meanMeters: elevation.mean,
      reliefMeters,
      minFeet: metersToFeet(elevation.min),
      maxFeet: metersToFeet(elevation.max),
      meanFeet: metersToFeet(elevation.mean),
      reliefFeet: metersToFeet(reliefMeters),
    }),
    slope: Object.freeze({
      minDegrees: slope.min,
      maxDegrees: slope.max,
      meanDegrees: slope.mean,
      standardDeviation: slope.standardDeviation,
    }),
    terrainClass: terrainClass(slope.mean),
    screeningPixelSizeMeters: TERRAIN_SCREENING_PIXEL_SIZE_METERS,
  });
}
