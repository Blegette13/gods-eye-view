import { buildParcelViewportProbeStatement } from './parcelViewportReadPlan.js';

/**
 * Step 40C-30 — private, UNROUTED, first-page SQL CALL contract.
 * Requires the separately staged `parcel_geometry_sealed_initial_rpc` SQL
 * foundation, itself gated by an immutable complete-run seal and independent
 * source-caching / geometry-publication rights in PostGIS.
 *
 * This is only parameter construction, NOT user authentication, a DB client,
 * transport, SQL deployment, or redistribution authorization. Caller must
 * independently verify current session, county grants, source review, quotas,
 * and authorization before and AFTER reading; absent that, do not execute.
 */
export const PRIVATE_SEALED_INITIAL_RPC_SQL = [
  'SELECT * FROM bdp_parcel_index.parcel_geometry_sealed_initial_rpc(',
  '$1::text,$2::text,$3::bigint,',
  '$4::double precision,$5::double precision,',
  '$6::double precision,$7::double precision,$8::integer)',
].join('');

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

export function buildPrivateSealedInitialRpcStatement({
  plan, trustedSourceId, trustedRunId,
} = {}) {
  if (!exact(plan, ['countyFips', 'bounds', 'limit', 'probeLimit'])
    || !exact(plan.bounds, ['west', 'south', 'east', 'north'])) return null;
  const probe = buildParcelViewportProbeStatement({
    plan, trustedSourceId, trustedRunId,
  });
  if (!probe || probe.values.length !== 8) return null;
  return Object.freeze({
    text: PRIVATE_SEALED_INITIAL_RPC_SQL,
    values: probe.values,
    publishAuthorized: false,
    viewportCoverage: 'unknown',
    geometryDelivered: false,
  });
}
