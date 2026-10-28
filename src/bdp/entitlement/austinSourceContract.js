/**
 * Official City of Austin GIS sources for preliminary point-level discovery.
 * This is NOT a zoning determination, parcel intersection, or land-use approval.
 * Before adding parcel screening, intersect full parcel polygons in PostGIS and
 * evaluate jurisdiction, all applicable overlays, and conflicting classifications.
 */
export const AUSTIN_SOURCE_LAYERS = Object.freeze({
  jurisdiction: Object.freeze({
    url: 'https://maps.austintexas.gov/arcgis/rest/services/Shared/JurisdictionsFill/MapServer/0',
    fields: Object.freeze(['CITY_NAME', 'JURISDICTION_TYPE', 'JURISDICTION_TYPE_SPECIFICS']),
  }),
  zoning: Object.freeze({
    url: 'https://maps.austintexas.gov/arcgis/rest/services/Shared/Zoning_1/MapServer/0',
    fields: Object.freeze(['ZONING_ZTYPE', 'ZONING_BASE']),
  }),
  etodOverlay: Object.freeze({
    url: 'https://maps.austintexas.gov/arcgis/rest/services/Shared/Zoning_2/MapServer/14',
    fields: Object.freeze(['ZONING_OVERLAY_NAME', 'ZONING_OVERLAY_SUB_NAME', 'ZONING_STATUS']),
  }),
});

export function buildAustinPointQueryUrl(sourceName, longitude, latitude) {
  const source = AUSTIN_SOURCE_LAYERS[sourceName];
  if (!source) throw new Error('Unknown Austin GIS source');
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error('WGS84 longitude and latitude are required');
  }
  const url = new URL(`${source.url}/query`);
  url.search = new URLSearchParams({
    where: '1=1',
    geometry: JSON.stringify({
      x: longitude,
      y: latitude,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: source.fields.join(','),
    returnGeometry: 'false',
    resultRecordCount: '20',
    f: 'json',
  }).toString();
  return url;
}

/**
 * Return observed attributes with conservative coverage semantics.
 * Empty, ambiguous and capped results never assert that a property is unzoned.
 */
export function summarizeAustinPointResponse(sourceName, response) {
  const source = AUSTIN_SOURCE_LAYERS[sourceName];
  if (!source || !response || response.error || !Array.isArray(response.features)) {
    throw new Error('Austin GIS did not return a valid ArcGIS feature response');
  }
  const records = response.features.map((item) => {
    if (!item || typeof item.attributes !== 'object' || item.attributes === null) {
      throw new Error('Austin GIS returned missing attributes');
    }
    return Object.fromEntries(source.fields.map((field) => {
      const value = item.attributes[field];
      return [field, typeof value === 'string' || typeof value === 'number' ? value : null];
    }));
  });
  const capped = response.exceededTransferLimit === true || records.length >= 20;
  return Object.freeze({
    sourceName,
    status: capped ? 'incomplete'
      : records.length === 0 ? 'unknown-no-point-match'
      : records.length > 1 ? 'ambiguous-multiple-point-matches'
      : 'preliminary-point-match',
    count: records.length,
    capped,
    records,
    disclaimer: 'Point-only GIS screening, NOT verified parcel zoning, permitted uses, or jurisdiction; inspect official Austin Property Profile and regulatory records.',
  });
}
