/**
 * Convert already-validated county parcel polygons into Cesium GeoJSON features.
 *
 * Cesium does not draw PolygonGraphics outlines when polygon surfaces are clamped
 * to terrain. Explicit, ground-clamped LineString features make every boundary
 * (including holes and MultiPolygon parts) visible and pickable without changing
 * the CAD geometry or creating synthetic parcel identities.
 */
export function parcelGeoJsonWithBoundaries(parcels, { focalBounds = null } = {}) {
  const features = [];
  if (focalBounds) {
    const { west, south, east, north } = focalBounds;
    if (![west, south, east, north].every(Number.isFinite)
        || west >= east || south >= north) {
      throw new Error('Invalid sourced focus footprint');
    }
    // The orange outline is a QUERY footprint, not a parcel/legal boundary.
    // Only parcels inside its complete GIS response can be claimed mapped.
    features.push({
      type: 'Feature', id: 'land-discovery-focus-footprint',
      geometry: { type: 'LineString', coordinates: [
        [west, south], [east, south], [east, north],
        [west, north], [west, south],
      ] },
      properties: { bdpFocusFootprint: true, bdpParcelId: null },
    });
  }
  for (const parcel of parcels) {
    const geometry = parcel.property?.geometry;
    if (!geometry) continue;

    const properties = {
      bdpParcelId: parcel.id,
      parcelId: parcel.parcelId,
      owner: parcel.owner?.name || '',
      acres: parcel.property?.acres,
      county: parcel.county,
    };
    features.push({
      type: 'Feature',
      id: parcel.id,
      geometry,
      properties,
    });

    const polygons = geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
    if (!Array.isArray(polygons)) throw new Error('Parcel geometry must be Polygon or MultiPolygon');

    polygons.forEach((rings, polygonIndex) => {
      if (!Array.isArray(rings) || rings.length === 0) {
        throw new Error('Parcel polygon has missing rings');
      }
      rings.forEach((ring, ringIndex) => {
        if (!Array.isArray(ring) || ring.length < 4 || ring.some(
          (point) => !Array.isArray(point)
            || point.length < 2
            || !Number.isFinite(Number(point[0]))
            || !Number.isFinite(Number(point[1])),
        )) throw new Error('Parcel polygon has invalid boundary coordinates');

        features.push({
          type: 'Feature',
          id: `bdp-boundary:${parcel.id}:${polygonIndex}:${ringIndex}`,
          geometry: { type: 'LineString', coordinates: ring },
          // Preserve the same lookup key for selecting a line or polygon body.
          properties: { ...properties, bdpBoundary: true },
        });
      });
    });
  }

  return { type: 'FeatureCollection', features };
}
