import { reviewLandCriteria } from '../acquisition/session.js';

const EARTH_RADIUS_MILES = 3958.7613;
function pointInGeometryBoundingBox(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return null;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity;
  for (const rings of polys || []) {
    for (const ring of rings || []) {
      for (const pos of ring || []) {
        if (!Array.isArray(pos) || pos.length < 2
          || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])
          || Math.abs(pos[0]) > 180 || Math.abs(pos[1]) > 90) return null;
        west = Math.min(west, pos[0]); east = Math.max(east, pos[0]);
        south = Math.min(south, pos[1]); north = Math.max(north, pos[1]);
      }
    }
  }
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  return Object.freeze({ lon: (west + east) / 2, lat: (south + north) / 2 });
}
function distanceMiles(a, b) {
  const lat1 = a.lat * Math.PI / 180; const lat2 = b.lat * Math.PI / 180;
  const dlat = lat2 - lat1;
  const dlon = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Provisional map hints from ONE verified-complete county viewport snapshot.
 * No unverified price or business use is accepted as a filter match.
 * Zero/missing acres remain UNKNOWN; do not "score" a property as buildable.
 * Radius is geodesic distance from Census county internal point to the
 * approximate polygon bounds center, not an authoritative land/survey metric.
 */
export function suggestViewportParcels({ criteria, parcels = [], center, limit = 24 } = {}) {
  if (!criteria?.county || !Array.isArray(parcels)) return Object.freeze([]);
  if (!criteria.zip && criteria.acresMin === null && criteria.acresMax === null) return Object.freeze([]);
  const result = [];
  const seen = new Set();
  for (const parcel of parcels) {
    if (result.length >= limit) break;
    const county = parcel?.county;
    const id = typeof parcel?.parcelId === 'string' ? parcel.parcelId : String(parcel?.parcelId ?? '');
    if (!county || !id || seen.has(`${county}:${id}`)) continue;
    if (criteria.radiusMiles === 0 && county !== criteria.county) continue;
    const point = pointInGeometryBoundingBox(parcel?.property?.geometry);
    if (!point) continue;
    if (criteria.radiusMiles > 0 && (!center
      || distanceMiles(point, center) > criteria.radiusMiles)) continue;
    const address = parcel.property?.situsAddress || '';
    const acresReported = parcel.property?.acres;
    const findings = reviewLandCriteria(criteria, { address, acresReported });
    const knownMatches = findings.filter((f) => f.status === 'reported-match');
    if (!knownMatches.length
      || findings.some((f) => f.status === 'reported-outside')) continue;
    seen.add(`${county}:${id}`);
    result.push(Object.freeze({
      county,
      parcelId: id,
      point,
      label: String(address || `Parcel ${id}`).slice(0, 110),
      evidence: Object.freeze(knownMatches.map((m) => m.field)),
      caveat: 'Reported source-field match only; asking price and permitted use NOT VERIFIED',
    }));
  }
  return Object.freeze(result);
}
