import { execFileSync } from 'node:child_process';
import { buildFemaOverlapSql } from '../../src/bdp/environment/floodContract.js';
import { buildDevelopmentConstraintSql } from '../../src/bdp/development/constraintFootprint.js';

const rectangle = (west, east) => ({ type: 'Polygon', coordinates: [[[west,29.4],[east,29.4],[east,29.41],[west,29.41],[west,29.4]]] });
const parcel = { geometry: rectangle(-98.5,-98.49) };
const empty = { type: 'FeatureCollection', features: [] };
const collection = (...features) => ({ type: 'FeatureCollection', features });
const feature = (geometry, properties = {}) => ({ type: 'Feature', geometry, properties });
const sfha = feature(rectangle(-98.5,-98.4925), { FLD_ZONE: 'AE', SFHA_TF: 'T' });
const zoneX = feature(parcel.geometry, { FLD_ZONE: 'X' });
const wetland = feature(rectangle(-98.4975,-98.49), { ATTRIBUTE: 'PFO1A' });
const cases = [
  ['overlapping duplicate polygons', parcel, { flood: collection(sfha,sfha,zoneX), wetlands: collection(wetland,wetland) }, `
    IF abs((m->>'combined_mapped_constraint_acres')::float8 - (m->>'parcel_acres')::float8) > 0.01 THEN RAISE EXCEPTION 'Union must cover parcel once: %',m; END IF;
    IF (m->>'shared_flood_nwi_acres')::float8 <= 0 THEN RAISE EXCEPTION 'Overlap should be positive'; END IF;
    IF abs((m->>'mapped_flood_acres')::float8 + (m->>'mapped_nwi_acres')::float8 - (m->>'shared_flood_nwi_acres')::float8 - (m->>'combined_mapped_constraint_acres')::float8) > 0.01 THEN RAISE EXCEPTION 'Union arithmetic mismatch'; END IF;
    IF abs((m->>'outside_mapped_footprint_acres')::float8) > 0.01 THEN RAISE EXCEPTION 'Outside footprint should be zero'; END IF;`],
  ['no mapped constraints with evaluated FEMA coverage', parcel, { flood: collection(zoneX), wetlands: empty }, `
    IF (m->>'combined_mapped_constraint_acres')::float8 <> 0 THEN RAISE EXCEPTION 'Empty footprint should be zero'; END IF;
    IF abs((m->>'outside_mapped_footprint_acres')::float8 - (m->>'parcel_acres')::float8) > 0.01 THEN RAISE EXCEPTION 'Complement mismatch'; END IF;`],
  ['missing FEMA polygons', parcel, { flood: empty, wetlands: collection(wetland) }, `
    IF m->>'outside_mapped_footprint_acres' IS NOT NULL OR m->>'status' <> 'incomplete-fema-coverage' THEN RAISE EXCEPTION 'Missing coverage cannot provide available acreage'; END IF;
    IF (m->>'combined_mapped_constraint_acres')::float8 <= 0 THEN RAISE EXCEPTION 'Known wetland footprint must remain visible'; END IF;`],
  ['undetermined FEMA zone', parcel, { flood: collection(feature(parcel.geometry,{ FLD_ZONE: 'D' })), wetlands: empty }, `
    IF m->>'outside_mapped_footprint_acres' IS NOT NULL THEN RAISE EXCEPTION 'Undetermined zone cannot provide complement'; END IF;`],
  ['partial FEMA coverage', parcel, { flood: collection(feature(rectangle(-98.5,-98.495),{ FLD_ZONE: 'X' })), wetlands: empty }, `
    IF m->>'outside_mapped_footprint_acres' IS NOT NULL THEN RAISE EXCEPTION 'Partial coverage cannot provide complement'; END IF;`],
];
const holeParcel = { geometry: { type: 'Polygon', coordinates: [parcel.geometry.coordinates[0], rectangle(-98.498,-98.496).coordinates[0].map(([x,y])=>[x, y === 29.4 ? 29.402 : 29.408]).reverse()] } };
cases.push(['parcel hole', holeParcel, { flood: collection(zoneX), wetlands: collection(feature(parcel.geometry)) }, `
  IF abs((m->>'combined_mapped_constraint_acres')::float8 - (m->>'parcel_acres')::float8) > 0.01 THEN RAISE EXCEPTION 'Hole must be excluded from all acreage'; END IF;`]);
const multipart = { geometry: { type: 'MultiPolygon', coordinates: [rectangle(-98.5,-98.497).coordinates,rectangle(-98.493,-98.49).coordinates] } };
cases.push(['multipart tract', multipart, { flood: collection(zoneX), wetlands: collection(feature(parcel.geometry)) }, `
  IF abs((m->>'combined_mapped_constraint_acres')::float8 - (m->>'parcel_acres')::float8) > 0.01 THEN RAISE EXCEPTION 'Multipart clipping mismatch'; END IF;`]);

for (const [label, candidate, sources, assertions] of cases) {
  const query = buildDevelopmentConstraintSql(candidate, sources).replace(/;\s*$/, '');
  const floodQuery = buildFemaOverlapSql(candidate, sources.flood).replace(/;\s*$/, '');
  const sql = `DO $check$ DECLARE m jsonb; f jsonb; BEGIN
    f := (${floodQuery})::jsonb;
    m := (${query})::jsonb;
    IF m->>'verified_buildable_acres' IS NOT NULL OR (m->>'development_score_ready')::boolean THEN RAISE EXCEPTION 'Screening cannot certify buildability'; END IF;
    IF (m->>'status' = 'incomplete-fema-coverage') AND ((f->>'coverage_complete')::boolean OR f->>'preliminary_non_mapped_flood_acres' IS NOT NULL) THEN RAISE EXCEPTION 'Individual flood screen must also withhold missing coverage'; END IF;
    ${assertions}
  END $check$;`;
  // Pipe SQL rather than putting geometry payloads into OS argument-limited command strings.
  execFileSync('psql', ['-v','ON_ERROR_STOP=1'], { input: sql, stdio: ['pipe','inherit','inherit'] });
  console.log(`[BDP:Development] ${label}: passed`);
}
