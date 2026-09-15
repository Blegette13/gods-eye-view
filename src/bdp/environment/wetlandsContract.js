export const BDP_ENVIRONMENT_API_BASE = '/api/bdp/environment';
export const NWI_WETLANDS_QUERY_URL =
  'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query';

export const NWI_MAX_PARCEL_POSITIONS = 20_000;
export const NWI_MAX_SOURCE_FEATURES = 5_000;
export const NWI_MAX_PARCEL_SPAN_DEGREES = 1.5;

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function validatePosition(position, state) {
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
  if (state.positions > NWI_MAX_PARCEL_POSITIONS) {
    throw new Error('Parcel geometry is too complex for a wetlands screening request');
  }
}

function validateCoordinates(node, state) {
  if (!Array.isArray(node) || node.length === 0) {
    throw new Error('Parcel geometry coordinates are required');
  }
  if (typeof node[0] === 'number') {
    validatePosition(node, state);
    return;
  }
  for (const child of node) validateCoordinates(child, state);
}

export function normalizeWetlandsParcelRequest(input = {}) {
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
  validateCoordinates(geometry.coordinates, state);
  if (state.positions < 4) throw new Error('Parcel geometry does not contain enough positions');

  if (
    state.east - state.west > NWI_MAX_PARCEL_SPAN_DEGREES
    || state.north - state.south > NWI_MAX_PARCEL_SPAN_DEGREES
  ) {
    throw new Error(`Parcel wetlands screening span must be ${NWI_MAX_PARCEL_SPAN_DEGREES} degrees or smaller`);
  }

  return Object.freeze({
    geometry: Object.freeze({
      type: geometry.type,
      coordinates: structuredClone(geometry.coordinates),
    }),
    bounds: Object.freeze({
      west: state.west,
      south: state.south,
      east: state.east,
      north: state.north,
    }),
  });
}

export function buildNwiParcelQueryUrl(requestInput) {
  const request = normalizeWetlandsParcelRequest(requestInput);
  const { west, south, east, north } = request.bounds;
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${west},${south},${east},${north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'ATTRIBUTE,WETLAND_TYPE,ACRES',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(NWI_MAX_SOURCE_FEATURES),
    f: 'geojson',
  });
  return `${NWI_WETLANDS_QUERY_URL}?${params.toString()}`;
}

export function normalizeNwiFeatureCollection(input) {
  if (!input || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error('USFWS NWI returned malformed GeoJSON');
  }
  if (input.features.length > NWI_MAX_SOURCE_FEATURES) {
    throw new Error('USFWS NWI returned too many wetlands for one parcel screening request');
  }

  const features = input.features
    .filter((feature) => feature?.geometry && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type))
    .map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        ATTRIBUTE: feature.properties?.ATTRIBUTE ?? null,
        WETLAND_TYPE:
          feature.properties?.WETLAND_TYPE
          ?? feature.properties?.WETLAND_TY
          ?? null,
        ACRES: feature.properties?.ACRES ?? null,
      },
    }));

  return Object.freeze({ type: 'FeatureCollection', features });
}

export function buildNwiOverlapSql(parcelInput, featureCollectionInput) {
  const request = normalizeWetlandsParcelRequest(parcelInput);
  const featureCollection = normalizeNwiFeatureCollection(featureCollectionInput);
  const parcelJson = JSON.stringify(request.geometry);
  const nwiJson = JSON.stringify(featureCollection);

  return `
WITH parcel AS (
  SELECT ST_CollectionExtract(
    ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(parcelJson)}), 4326)),
    3
  ) AS geom
),
nwi_source AS (
  SELECT
    feature,
    ST_CollectionExtract(
      ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(feature -> 'geometry'), 4326)),
      3
    ) AS geom,
    COALESCE(
      NULLIF(feature -> 'properties' ->> 'WETLAND_TYPE', ''),
      NULLIF(feature -> 'properties' ->> 'ATTRIBUTE', ''),
      'Unknown'
    ) AS wetland_type
  FROM jsonb_array_elements(${sqlTextLiteral(nwiJson)}::jsonb -> 'features') AS feature
),
intersecting AS (
  SELECT n.geom, n.wetland_type
  FROM nwi_source n
  CROSS JOIN parcel p
  WHERE NOT ST_IsEmpty(n.geom)
    AND ST_Intersects(n.geom, p.geom)
),
wetland_union AS (
  SELECT ST_UnaryUnion(ST_Collect(geom)) AS geom
  FROM intersecting
),
metrics AS (
  SELECT
    ST_Area(p.geom::geography) AS parcel_area_m2,
    COALESCE(
      ST_Area(
        ST_Intersection(p.geom, COALESCE(w.geom, ST_GeomFromText('POLYGON EMPTY', 4326)))::geography
      ),
      0
    ) AS overlap_area_m2,
    (SELECT COUNT(*) FROM intersecting) AS feature_count,
    (SELECT COUNT(DISTINCT wetland_type) FROM intersecting) AS wetland_type_count
  FROM parcel p
  CROSS JOIN wetland_union w
)
SELECT jsonb_build_object(
  'parcel_acres', ROUND((parcel_area_m2 / 4046.8564224)::numeric, 2),
  'nwi_mapped_acres', ROUND((overlap_area_m2 / 4046.8564224)::numeric, 2),
  'nwi_percent', ROUND((CASE WHEN parcel_area_m2 > 0 THEN 100 * overlap_area_m2 / parcel_area_m2 ELSE 0 END)::numeric, 2),
  'nwi_feature_count', feature_count,
  'nwi_type_count', wetland_type_count,
  'preliminary_non_nwi_acres', ROUND(((GREATEST(parcel_area_m2 - overlap_area_m2, 0)) / 4046.8564224)::numeric, 2)
)::text
FROM metrics;
`.trim();
}
