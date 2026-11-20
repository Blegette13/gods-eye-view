import { parseBoundedParcelPageRequest } from './parcelPageContract.js';

/**
 * Step 40C-2: UNROUTED server-side PostGIS read plan. Query metadata only.
 * Not an HTTP endpoint, datastore connector, authorization system, grant,
 * importer, map tile encoder or a statement that any provider permits storage.
 *
 * The caller MUST resolve trustedSourceId and trustedRunId from a server-side
 * authority; they must NEVER be copied from the browser. The SQL checks source
 * rights again at read time, but full identity, per-user county permissions,
 * usage limits, session handling and read-only DB roles remain integration
 * prerequisites. Use a parameterized database client, never interpolate text.
 *
 * A known run is not countywide coverage. The returned metadata cannot be
 * used to certify that a viewport or county has been fully evaluated.
 */

const SOURCE_ID = /^[a-z][a-z0-9_-]{2,79}$/;

/**
 * PostgreSQL $1..$8 bind variables; no dynamic identifiers or user SQL.
 * A single complete OR partial finished ingest run is selected, rather than
 * mixing incompatible source versions or inferring a countywide snapshot.
 *
 * ST_Intersects uses the GiST geometry index from parcelIndexFoundation.sql.
 * This query intentionally does NOT serialize full polygon geometries.
 * Geometry and payload budgets must be enforced before any future map output.
 * The one-record LIMIT probe signals page overflow; pagination is not built.
 */
export const PARCEL_VIEWPORT_PROBE_SQL = `
WITH requested_bounds AS (
  SELECT ST_MakeEnvelope(
    $4::double precision, $5::double precision,
    $6::double precision, $7::double precision, 4326
  ) AS bounds
)
SELECT
  pv.id AS parcel_version_id,
  pv.source_parcel_id,
  pv.source_version,
  pv.source_geometry_sha256,
  pv.source_currency,
  pv.source_modified_at,
  ST_NPoints(pv.geometry) AS geometry_vertices,
  ST_MemSize(pv.geometry) AS geometry_memory_bytes,
  ir.id AS ingest_run_id
FROM bdp_parcel_index.source_registry AS sr
JOIN bdp_parcel_index.ingest_runs AS ir
  ON ir.source_id = sr.source_id
JOIN bdp_parcel_index.parcel_versions AS pv
  ON pv.ingest_run_id = ir.id
 AND pv.source_id = sr.source_id
 AND pv.county_fips = sr.county_fips
 AND pv.source_version = ir.source_version
CROSS JOIN requested_bounds AS b
WHERE sr.county_fips = $1::char(5)
  AND sr.source_id = $2::text
  AND ir.id = $3::bigint
  AND ir.finished_at IS NOT NULL
  AND ir.outcome IN ('complete', 'partial')
  AND sr.rights_state = 'approved'
  AND sr.approved_caching_until > clock_timestamp()
  AND pv.geometry && b.bounds
  AND ST_Intersects(pv.geometry, b.bounds)
ORDER BY pv.source_parcel_id COLLATE "C" ASC, pv.id ASC
LIMIT $8::integer
`.trim();

/**
 * Produce a parameterized, immutable query description or null (fail closed).
 * `plan` must come from parseBoundedParcelPageRequest(). Revalidation protects
 * against mutation and fabricated limit/extent values at this boundary.
 *
 * Important: read-time registry rights checks also belong in the eventual
 * geometry and coverage queries. This planner does not grant access to anyone.
 */
export function buildParcelViewportProbeStatement({ plan, trustedSourceId, trustedRunId } = {}) {
  const checked = plan && parseBoundedParcelPageRequest({
    countyFips: plan.countyFips,
    bounds: plan.bounds,
    limit: plan.limit,
  });
  if (!checked || plan.probeLimit !== checked.probeLimit
      || typeof trustedSourceId !== 'string' || !SOURCE_ID.test(trustedSourceId)
      || !Number.isSafeInteger(trustedRunId) || trustedRunId <= 0) return null;

  const { west, south, east, north } = checked.bounds;
  const values = Object.freeze([
    checked.countyFips, trustedSourceId, trustedRunId,
    west, south, east, north, checked.probeLimit,
  ]);
  return Object.freeze({ text: PARCEL_VIEWPORT_PROBE_SQL, values });
}

/**
 * Fail-closed shape check for the metadata-only probe result. Does not claim
 * full source or viewport coverage, and exposes no geometry to the browser.
 * This does not validate the database's source evidence or authorization.
 */
export function summarizeParcelViewportProbe({ plan, rows } = {}) {
  const checked = plan && parseBoundedParcelPageRequest({
    countyFips: plan.countyFips, bounds: plan.bounds, limit: plan.limit,
  });
  if (!checked || plan.probeLimit !== checked.probeLimit
      || !Array.isArray(rows) || rows.length > checked.probeLimit) return null;
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || typeof row.source_parcel_id !== 'string'
      || row.source_parcel_id.length < 1
      || !Number.isSafeInteger(row.geometry_vertices) || row.geometry_vertices < 1
      || !Number.isSafeInteger(row.geometry_memory_bytes) || row.geometry_memory_bytes < 1
      || ids.has(row.source_parcel_id)) return null;
    ids.add(row.source_parcel_id);
  }
  const overflow = rows.length > checked.limit;
  return Object.freeze({
    acceptedCount: Math.min(rows.length, checked.limit),
    overflow,
    // Absence of overflowing rows alone is never evidence of completeness.
    viewportCoverage: 'unknown',
    geometryDelivered: false,
  });
}
