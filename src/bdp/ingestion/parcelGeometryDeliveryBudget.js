import { summarizeParcelViewportProbe } from './parcelViewportReadPlan.js';

/**
 * Step 40C-3: UNROUTED, pure budgets for a future PostGIS parcel map page.
 * Does NOT grant source rights, establish user identity, execute SQL, fetch
 * polygons, simplify surveyed shapes, or expose an HTTP endpoint.
 *
 * DB geometry memory bytes are not wire bytes. Both limits are independently
 * enforced. Over-budget pages are rejected as a unit, never silently clipped.
 */
export const PARCEL_MAX_FEATURE_VERTICES = 8_000;
export const PARCEL_MAX_PAGE_VERTICES = 60_000;
export const PARCEL_MAX_FEATURE_GEOMETRY_MEMORY_BYTES = 512 * 1024;
export const PARCEL_MAX_PAGE_GEOMETRY_MEMORY_BYTES = 4 * 1024 * 1024;
export const PARCEL_MAX_PAGE_GEOJSON_BYTES = 2 * 1024 * 1024;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const own = Object.prototype.hasOwnProperty;
const allowedKeys = (object, keys) => {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
  const prototype = Object.getPrototypeOf(object);
  return (prototype === Object.prototype || prototype === null)
    && Object.keys(object).length === keys.length
    && keys.every((key) => own.call(object, key));
};

const reject = (reason) => Object.freeze({ ok: false, reason });

/**
 * Validate the whole bounded probe, then assess only feature rows excluding
 * its optional one-record overflow probe. Rejection must trigger a smaller
 * spatial query or an explicit unavailable/partial page, never mark coverage.
 */
export function assessParcelGeometryMetadata({ plan, rows } = {}) {
  const probe = summarizeParcelViewportProbe({ plan, rows });
  if (!probe) return reject('invalid-metadata');

  let vertices = 0;
  let memoryBytes = 0;
  for (const row of rows.slice(0, probe.acceptedCount)) {
    if (!ID.test(row.source_parcel_id)
      || row.geometry_vertices > PARCEL_MAX_FEATURE_VERTICES
      || row.geometry_memory_bytes > PARCEL_MAX_FEATURE_GEOMETRY_MEMORY_BYTES) {
      return reject('feature-budget-exceeded');
    }
    vertices += row.geometry_vertices;
    memoryBytes += row.geometry_memory_bytes;
    if (vertices > PARCEL_MAX_PAGE_VERTICES
      || memoryBytes > PARCEL_MAX_PAGE_GEOMETRY_MEMORY_BYTES) {
      return reject('page-budget-exceeded');
    }
  }
  return Object.freeze({
    ok: true,
    acceptedCount: probe.acceptedCount,
    overflow: probe.overflow,
    vertices,
    geometryMemoryBytes: memoryBytes,
    // No index query or geometry budget proves viewport completeness.
    viewportCoverage: 'unknown',
  });
}

function inspectGeometry(geometry, limit) {
  if (!allowedKeys(geometry, ['type', 'coordinates'])) return null;
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length) return null;
  let vertices = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) return null;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4 || ring.length > limit) return null;
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (!Array.isArray(first) || first.length !== 2
        || !Array.isArray(last) || last.length !== 2
        || first[0] !== last[0] || first[1] !== last[1]) return null;
      for (const coordinate of ring) {
        if (!Array.isArray(coordinate) || coordinate.length !== 2) return null;
        const [lon, lat] = coordinate;
        if (typeof lon !== 'number' || typeof lat !== 'number'
          || !Number.isFinite(lon) || !Number.isFinite(lat)
          || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
        if (++vertices > limit) return null;
      }
    }
  }
  return vertices;
}

/**
 * A pure preflight for already server-assembled, 2D WGS84 source geometries.
 * The future authenticated service must build features from its own verified
 * PostGIS rows, not user input, and must check source rights at read time.
 * No legal boundary/topology claim follows from this structural validation.
 * The original source polygon must remain available for selected parcels.
 *
 * Only the map-safe source parcel ID is permitted in the payload; no owner,
 * contact, address, financial or inferred buildability attributes are copied.
 */
export function assessParcelGeoJsonPage({ plan, rows, collection } = {}) {
  const metadata = assessParcelGeometryMetadata({ plan, rows });
  if (!metadata.ok) return metadata;
  if (!allowedKeys(collection, ['type', 'features'])
    || collection.type !== 'FeatureCollection'
    || !Array.isArray(collection.features)
    || collection.features.length !== metadata.acceptedCount) return reject('invalid-collection');

  for (let i = 0; i < collection.features.length; i++) {
    const feature = collection.features[i];
    const source = rows[i];
    if (!allowedKeys(feature, ['type', 'id', 'properties', 'geometry'])
      || feature.type !== 'Feature'
      || feature.id !== source.source_parcel_id
      || !allowedKeys(feature.properties, ['sourceParcelId'])
      || feature.properties.sourceParcelId !== source.source_parcel_id) {
      return reject('invalid-feature');
    }
    // No third-party geometry may masquerade as the probed source geometry.
    const counted = inspectGeometry(feature.geometry, PARCEL_MAX_FEATURE_VERTICES);
    if (counted === null || counted !== source.geometry_vertices) return reject('invalid-geometry');
  }

  let wireBytes;
  try {
    const json = JSON.stringify(collection);
    if (typeof json !== 'string') return reject('invalid-collection');
    wireBytes = Buffer.byteLength(json, 'utf8');
  } catch {
    return reject('invalid-collection');
  }
  if (wireBytes > PARCEL_MAX_PAGE_GEOJSON_BYTES) return reject('wire-budget-exceeded');
  return Object.freeze({
    ...metadata,
    geoJsonBytes: wireBytes,
    // Passing this preflight is NOT permission to publish a page.
    publishAuthorized: false,
  });
}
