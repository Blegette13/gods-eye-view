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
