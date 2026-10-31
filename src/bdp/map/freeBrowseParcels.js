import { CENSUS_COUNTY_SOURCE, validateCountyFeatures } from './discoveryGeography.js';
import { PILOT_COUNTIES } from '../acquisition/session.js';

/** The existing altimeter is ellipsoid-relative, not ground clearance. */
export const FREE_BROWSE_PARCEL_HEIGHT_METERS = 1300;
export const MAX_FREE_BROWSE_ROWS = 1000;

export function shouldDiscoverFreeParcels(height) {
  return Number.isFinite(height) && height >= 0 && height <= FREE_BROWSE_PARCEL_HEIGHT_METERS;
}

/** ArcGIS server selects the polygon containing this real map point. */
export function freeBrowseCountyUrl(point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)
      || point.lat < 25 || point.lat > 37 || point.lon < -107 || point.lon > -93) {
    return null;
  }
  const qs = new URLSearchParams({
    f: 'geojson', where: "STATE='48'",
    geometry: JSON.stringify({ x: point.lon, y: point.lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'GEOID,NAME,STATE,INTPTLAT,INTPTLON',
    returnGeometry: 'true', outSR: '4326',
    resultRecordCount: '2',
  });
  return CENSUS_COUNTY_SOURCE + '?' + qs.toString();
}

export function countyFromFreeBrowseResponse(data) {
  const features = validateCountyFeatures(data);
  // Border cases that return 2 counties are intentionally ambiguous.
  if (features.length !== 1) return null;
  const { GEOID } = features[0].properties;
  return PILOT_COUNTIES.find((county) => county.fips === GEOID)?.name ?? null;
}

/** List the actual identifiable GIS polygons from the current map snapshot.
 * The count is of rendered source records, NEVER for-sale inventory. */
export function freeBrowseVisibleParcels({ county, parcels = [], complete = false,
  reason = 'not-complete', coverage = null } = {}) {
  if (!county || !Array.isArray(parcels) || !['complete', 'partial'].includes(reason)) {
    return Object.freeze({
      rows: Object.freeze([]), count: null, complete: false,
      message: 'Parcel records have not loaded for this map view.',
    });
  }
  const found = new Map();
  for (const parcel of parcels) {
    const id = parcel?.parcelId;
    if (parcel?.county !== county || typeof id !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)
        || !['Polygon','MultiPolygon'].includes(parcel?.property?.geometry?.type)) continue;
    const address = String(parcel.property?.situsAddress || '').trim();
    const acres = parcel.property?.acres;
    const acresReported = typeof acres === 'number' && Number.isFinite(acres) && acres > 0
      ? acres : null;
    if (!found.has(id)) found.set(id, Object.freeze({
      county, parcelId: id, label: address || 'Parcel ' + id,
      acresReported,
      caveat: 'County GIS record only. Availability, ownership and permitted use unverified.',
    }));
  }
  const rows = Object.freeze([...found.values()].slice(0, MAX_FREE_BROWSE_ROWS));
  const full = complete === true && reason === 'complete';
  return Object.freeze({
    rows, count: rows.length, complete: full,
    message: coverage?.focalOnly === true
      ? rows.length + ' sourced parcels inside the orange central discovery window. This is PARTIAL MAP COVERAGE; areas outside the outline were not searched. Properties are NOT verified for sale.'
      : full
        ? rows.length + ' identifiable source parcels in this bounded map view. They are NOT verified for sale.'
        : rows.length + ' identifiable parcels displayed from PARTIAL source coverage. More records may exist here.',
  });
}
