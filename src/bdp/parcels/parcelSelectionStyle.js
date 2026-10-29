/**
 * Apply a visual selection to validated county GIS parcel features.
 *
 * These are provisional GIS boundaries, NOT surveyed/legal boundary lines.
 * Source IDs and Cesium entity identities are never changed. All entities
 * receive explicit normal styles on each call, so stale selections cannot
 * leak into a later viewport snapshot.
 */
export function styleSelectedParcelEntities(entities, selectedParcelId, {
  parcelIdForEntity,
  defaultOutline,
  selectedOutline,
  defaultFill,
  selectedFill,
  defaultWidth = 2,
  selectedWidth = 5,
} = {}) {
  if (!Array.isArray(entities) || typeof parcelIdForEntity !== 'function') return 0;
  let selectedEntities = 0;
  const selectedId = typeof selectedParcelId === 'string' ? selectedParcelId : '';
  for (const entity of entities) {
    if (!entity?.polyline && !entity?.polygon) continue;
    const id = parcelIdForEntity(entity);
    const selected = Boolean(selectedId && id === selectedId);
    if (selected) selectedEntities += 1;
    if (entity.polyline) {
      entity.polyline.material = selected ? selectedOutline : defaultOutline;
      entity.polyline.width = selected ? selectedWidth : defaultWidth;
    }
    if (entity.polygon) {
      entity.polygon.material = selected ? selectedFill : defaultFill;
      entity.polygon.outline = false;
    }
  }
  return selectedEntities;
}

/**
 * Read all exterior rings (including multipart parcels); holes remain in the
 * original GeoJSON outline datasource and are styled by the same selection ID.
 * Ignore malformed geographic points rather than deriving a false location.
 */
export function parcelExteriorCoordinates(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons)) return [];
  const coordinates = [];
  for (const rings of polygons) {
    const outer = Array.isArray(rings) ? rings[0] : null;
    if (!Array.isArray(outer)) return [];
    for (const point of outer) {
      if (!Array.isArray(point) || point.length < 2) return [];
      const [longitude, latitude] = point;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
        || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return [];
      coordinates.push([longitude, latitude]);
    }
  }
  return coordinates;
}

/**
 * Suggest a camera distance from the source polygon's actual angular extent.
 * This controls viewing only. Never interprets acreage, legal boundaries or
 * buildability; a missing/malformed geometry gets no guessed camera target.
 */
export function recommendedParcelFocusRange(geometry) {
  const coordinates = parcelExteriorCoordinates(geometry);
  if (!coordinates.length) return null;
  const longitude = coordinates.map((point) => point[0]);
  const latitude = coordinates.map((point) => point[1]);
  const midLatitude = (Math.min(...latitude) + Math.max(...latitude)) / 2;
  const widthMeters = (Math.max(...longitude) - Math.min(...longitude))
    * 111320 * Math.max(0, Math.cos(midLatitude * Math.PI / 180));
  const heightMeters = (Math.max(...latitude) - Math.min(...latitude)) * 111320;
  if (!Number.isFinite(widthMeters) || !Number.isFinite(heightMeters)) return null;
  // Do not zoom into a building's interior. Leave room around larger tracts.
  return Math.max(450, Math.max(widthMeters, heightMeters) * 4);
}
