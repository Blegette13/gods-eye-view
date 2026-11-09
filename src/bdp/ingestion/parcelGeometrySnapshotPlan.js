import { parseBoundedParcelPageRequest } from './parcelPageContract.js';
import { buildParcelViewportProbeStatement } from './parcelViewportReadPlan.js';
import { stageParcelGeometryCandidate } from './parcelGeometryCandidate.js';

/**
 * Step 40C-16: STAGED / UNROUTED single-query snapshot design.
 *
 * Requires the separate, currently UNDEPLOYED redistribution-review table.
 * The existing least-privileged LOGIN has NO raw table privileges, so this
 * statement cannot be used by the live metadata service. A future DBA-reviewed
 * fixed-function RPC must enforce the same rights gates and least privilege.
 * NO GIS dataset is approved or copied by defining this SQL.
 *
 * One SELECT binds metadata and geometry to the SAME indexed parcel version,
 * avoiding a two-query version race. The +1 overflow sentinel returns NULL
 * geometry. Huge features also return NULL, so the downstream validator fails
 * closed instead of silently dropping them. This is NOT a public API or a
 * certification of complete spatial coverage, ownership or legal boundaries.
 */
export const PARCEL_GEOMETRY_SNAPSHOT_SQL = `
WITH bounded AS MATERIALIZED (
  SELECT
    pv.id AS parcel_version_id,
    pv.source_parcel_id,
    pv.source_version,
    pv.source_geometry_sha256,
    ir.id AS ingest_run_id,
    pv.source_id,
    pv.county_fips::text AS county_fips,
    public.ST_NPoints(pv.geometry) AS geometry_vertices,
    public.ST_MemSize(pv.geometry) AS geometry_memory_bytes,
    pv.geometry AS raw_geometry
  FROM bdp_parcel_index.source_registry AS sr
  JOIN bdp_parcel_index.geometry_publication_reviews AS rights
    ON rights.source_id = sr.source_id
    AND rights.county_fips = sr.county_fips
  JOIN bdp_parcel_index.ingest_runs AS ir
    ON ir.source_id = sr.source_id
  JOIN bdp_parcel_index.parcel_versions AS pv
    ON pv.ingest_run_id = ir.id
    AND pv.source_id = sr.source_id
    AND pv.county_fips = sr.county_fips
    AND pv.source_version = ir.source_version
  WHERE $1::text ~ '^48[0-9]{3}$'
    AND sr.county_fips = $1::char(5)
    AND sr.source_id = $2::text
    AND ir.id = $3::bigint
    AND ir.finished_at IS NOT NULL
    AND ir.outcome IN ('complete', 'partial')
    AND sr.rights_state = 'approved'
    AND sr.approved_caching_until > pg_catalog.clock_timestamp()
    AND rights.review_state = 'approved'
    AND rights.allow_geometry_redistribution = TRUE
    AND rights.review_reference IS NOT NULL
    AND rights.reviewed_at IS NOT NULL
    AND rights.reviewed_at <= pg_catalog.clock_timestamp()
    AND rights.expires_at > pg_catalog.clock_timestamp()
    AND rights.expires_at <= sr.approved_caching_until
    AND $4::double precision >= -180
    AND $6::double precision <= 180
    AND $5::double precision >= -90
    AND $7::double precision <= 90
    AND $4::double precision < $6::double precision
    AND $5::double precision < $7::double precision
    AND ($6::double precision - $4::double precision) <= 0.12
    AND ($7::double precision - $5::double precision) <= 0.12
    AND $8::integer BETWEEN 2 AND 201
    AND pv.geometry OPERATOR(public.&&)
      public.ST_MakeEnvelope($4::double precision, $5::double precision,
        $6::double precision, $7::double precision, 4326)
    AND public.ST_Intersects(pv.geometry,
      public.ST_MakeEnvelope($4::double precision, $5::double precision,
        $6::double precision, $7::double precision, 4326))
  ORDER BY pv.source_parcel_id COLLATE "C" ASC, pv.id ASC
  LIMIT $8::integer
)
SELECT
  parcel_version_id, source_parcel_id, source_version,
  source_geometry_sha256, ingest_run_id, source_id, county_fips,
  geometry_vertices, geometry_memory_bytes,
  CASE WHEN row_number() OVER (
    ORDER BY source_parcel_id COLLATE "C" ASC, parcel_version_id ASC
  ) < $8::integer
    AND geometry_vertices BETWEEN 1 AND 8000
    AND geometry_memory_bytes BETWEEN 1 AND 524288
    THEN public.ST_AsGeoJSON(raw_geometry, 9, 0)::json
    ELSE NULL
  END AS geometry
FROM bounded
ORDER BY source_parcel_id COLLATE "C" ASC, parcel_version_id ASC
`.trim();

/** Revalidate exactly the existing 8-parameter source-controlled probe. */
export function buildParcelGeometrySnapshotStatement({
  plan, trustedSourceId, trustedRunId,
} = {}) {
  const checked = plan && parseBoundedParcelPageRequest({
    countyFips: plan.countyFips, bounds: plan.bounds, limit: plan.limit,
  });
  if (!checked || plan.probeLimit !== checked.probeLimit) return null;
  const original = buildParcelViewportProbeStatement({
    plan: checked, trustedSourceId, trustedRunId,
  });
  if (!original) return null;
  return Object.freeze({
    text: PARCEL_GEOMETRY_SNAPSHOT_SQL,
    values: original.values,
  });
}

/**
 * Stage a private, NEVER-publishable GeoJSON candidate from a single DB
 * result. Only whitelist map fields. Do not spread raw source/owner records.
 * Post-query session, publication rights and source/run checks are required
 * before a future trusted transport could deliver geometry.
 */
export function stageParcelGeometrySnapshot({
  plan, rows, trustedSource, trustedRunId,
  trustedPublicationRights, nowMs,
} = {}) {
  const denied = Object.freeze({
    ok: false, reason: 'unavailable', publishAuthorized: false,
  });
  const checked = plan && parseBoundedParcelPageRequest({
    countyFips: plan.countyFips, bounds: plan.bounds, limit: plan.limit,
  });
  if (!checked || plan.probeLimit !== checked.probeLimit
    || !Array.isArray(rows) || rows.length > checked.probeLimit) return denied;

  const metadataRows = [];
  const geometryRows = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) return denied;
    const { source_parcel_id, source_version, source_geometry_sha256,
      ingest_run_id, geometry_vertices, geometry_memory_bytes,
      source_id, county_fips } = row;
    metadataRows.push({
      source_parcel_id, source_version, source_geometry_sha256,
      ingest_run_id, geometry_vertices, geometry_memory_bytes,
    });
    if (i < checked.limit) geometryRows.push({
      source_parcel_id, source_version, source_geometry_sha256,
      ingest_run_id, source_id, county_fips, geometry: row.geometry,
    });
    else if (row.geometry !== null) return denied; // +1 sentinel has no geometry
  }
  return stageParcelGeometryCandidate({
    plan: checked, metadataRows, geometryRows, trustedSource,
    trustedRunId, trustedPublicationRights, nowMs,
  });
}
