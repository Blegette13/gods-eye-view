import { normalizeWetlandsParcelRequest } from '../environment/wetlandsContract.js';

export const BDP_WATER_API_BASE = '/api/bdp/water';

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

export function normalizeWaterParcelRequest(input = {}) {
  return normalizeWetlandsParcelRequest(input);
}

export function buildTceqParcelWaterSql(input) {
  const request = normalizeWaterParcelRequest(input);
  const geometryJson = JSON.stringify(request.geometry);
  return `
SELECT row_to_json(metrics)::text
FROM bdp_tceq_parcel_water_metrics(
  ST_SetSRID(ST_GeomFromGeoJSON(${sqlTextLiteral(geometryJson)}), 4326)
) AS metrics;
`.trim();
}
