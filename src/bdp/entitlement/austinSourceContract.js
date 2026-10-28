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


/**
 * Request only *candidate* GIS polygons whose geometry intersects the bounding
 * box of the complete cadastral parcel. An envelope is intentionally NOT the
 * final zoning intersection: PostGIS must calculate exact parcel overlap, and
 * no downstream system can call these candidates verified zoning evidence.
 */
export function austinParcelBounds(geometry) {
  if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) {
    throw new Error('Full Polygon or MultiPolygon parcel geometry is required');
  }
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) {
    throw new Error('Parcel geometry lacks polygons');
  }
  const extent = [Infinity, Infinity, -Infinity, -Infinity];
  let coordinateCount = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) throw new Error('Parcel polygon lacks rings');
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error('Invalid parcel polygon ring');
      const first = ring[0], last = ring.at(-1);
      if (!Array.isArray(first) || !Array.isArray(last)
        || Number(first[0]) !== Number(last[0]) || Number(first[1]) !== Number(last[1])) {
        throw new Error('Parcel polygon ring must be closed');
      }
      for (const coord of ring) {
        if (!Array.isArray(coord) || coord.length < 2
          || typeof coord[0] !== 'number' || typeof coord[1] !== 'number'
          || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])
          || Math.abs(coord[0]) > 180 || Math.abs(coord[1]) > 90) {
          throw new Error('Parcel geometry must contain finite WGS84 lon/lat coordinates');
        }
        extent[0] = Math.min(extent[0], coord[0]);
        extent[1] = Math.min(extent[1], coord[1]);
        extent[2] = Math.max(extent[2], coord[0]);
        extent[3] = Math.max(extent[3], coord[1]);
        coordinateCount += 1;
        if (coordinateCount > 50000) throw new Error('Parcel geometry is too complex');
      }
    }
  }
  if (!(extent[0] < extent[2]) || !(extent[1] < extent[3])) {
    throw new Error('Parcel polygon bounds are invalid');
  }
  return Object.freeze(extent);
}

export function buildAustinParcelCandidateQueryUrl(sourceName, geometry, { limit = 100 } = {}) {
  const source = AUSTIN_SOURCE_LAYERS[sourceName];
  if (!source) throw new Error('Unknown Austin GIS source');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Austin GIS candidate limit must be 1–500');
  }
  const bounds = austinParcelBounds(geometry);
  const url = new URL(`${source.url}/query`);
  url.search = new URLSearchParams({
    where: '1=1',
    geometry: bounds.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: source.fields.join(','),
    returnGeometry: 'true',
    resultRecordCount: String(limit),
    f: 'geojson',
  }).toString();
  return url;
}

/**
 * Reject incomplete or malformed upstream candidate geometry before spatial
 * calculations. A zero-result envelope query is only UNKNOWN (not no zoning).
 */
export function validateAustinCandidateCollection(sourceName, response, { limit = 100 } = {}) {
  if (!AUSTIN_SOURCE_LAYERS[sourceName] || !response
    || response.type !== 'FeatureCollection' || !Array.isArray(response.features)
    || response.error || response.exceededTransferLimit === true
    || response.features.length >= limit) {
    throw new Error('Austin GIS candidates are missing, truncated or malformed');
  }
  for (const feature of response.features) {
    if (!['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
      || !feature.properties || typeof feature.properties !== 'object'
      || !Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length === 0) {
      throw new Error('Austin GIS candidate has missing polygon geometry or properties');
    }
    // Validate ring topology and coordinate range without modifying the data.
    austinParcelBounds(feature.geometry);
  }
  return Object.freeze({
    sourceName,
    candidateCount: response.features.length,
    status: response.features.length ? 'unverified-envelope-candidates' : 'unknown-no-envelope-candidates',
    exactOverlapCalculated: false,
    // Do not expose features as a verified GIS clearance or zoning assignment.
    features: response.features,
  });
}


/**
 * Austin's jurisdiction polygons can cover an entire city and contain tens
 * of thousands of vertices. Downloading the entire geometry for a parcel-sized
 * envelope risks oversized responses and falsely "fixing" the problem by
 * simplifying the authoritative border.
 *
 * Retrieve attributes only for jurisdiction DISCOVERY; this is not an exact
 * parcel intersection and cannot establish a zoning jurisdiction or its share.
 * Do not pass these records into PostGIS area calculations.
 */
export function buildAustinJurisdictionAttributeQueryUrl(geometry, { limit = 100 } = {}) {
  const url = buildAustinParcelCandidateQueryUrl('jurisdiction', geometry, { limit });
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');
  url.searchParams.delete('outSR');
  return url;
}

export function summarizeAustinJurisdictionCandidates(response, { limit = 100 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500
    || !response || response.error || !Array.isArray(response.features)
    || response.exceededTransferLimit === true || response.features.length >= limit) {
    throw new Error('Austin jurisdiction attribute candidates are missing, capped or malformed');
  }
  const source = AUSTIN_SOURCE_LAYERS.jurisdiction;
  const features = response.features.map((feature) => {
    if (!feature?.attributes || typeof feature.attributes !== 'object'
      || Array.isArray(feature.attributes)) {
      throw new Error('Austin jurisdiction candidate lacks attributes');
    }
    const properties = Object.fromEntries(source.fields.map((field) => {
      const value = feature.attributes[field];
      if (value === null || value === undefined) return [field, null];
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error('Austin jurisdiction candidate has invalid attribute value');
      }
      return [field, value];
    }));
    return Object.freeze({ properties });
  });
  return Object.freeze({
    sourceName: 'jurisdiction',
    candidateCount: features.length,
    status: features.length
      ? 'unverified-envelope-attribute-candidates'
      : 'unknown-no-envelope-candidates',
    exactOverlapCalculated: false,
    geometryReturned: false,
    // These values ONLY come from polygons whose bounding boxes meet a parcel
    // envelope. They cannot establish municipal/ETJ jurisdiction or its area.
    features: Object.freeze(features),
  });
}
