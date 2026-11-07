/**
 * Step 45: DENY-BY-DEFAULT evidence access policy, for future trusted-server
 * integration only. This module DOES NOT authenticate a user. Its identity
 * resolver MUST validate a real server-side session and MUST NOT trust roles,
 * scopes, or the authenticated flag supplied by the browser.
 *
 * No grants for verification, deletion, correction-in-place, bulk reading
 * or clearance decisions exist.
 */
import { validateRegulatoryLedgerScope } from './evidenceIndex.js';

const READ_ROLES = new Set(['evidence-reader', 'evidence-researcher']);
const APPEND_ROLES = new Set(['evidence-researcher']);
const OPERATIONS = new Set(['read-index', 'append-note', 'append-document']);

export function denyEvidenceAccess() {
  const error = new Error('BDP regulatory evidence access denied');
  error.code = 'BDP_EVIDENCE_ACCESS_DENIED';
  throw error;
}

function allowed(identity, operation, scope) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)
    || identity.authenticated !== true
    || typeof identity.subject !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,119}$/.test(identity.subject)
    || !Array.isArray(identity.roles)
    || !Array.isArray(identity.parcelGrants)
    || !OPERATIONS.has(operation)) return false;

  const roles = operation === 'read-index' ? READ_ROLES : APPEND_ROLES;
  if (!identity.roles.some((role) => roles.has(role))) return false;

  // Always require a positive per-parcel grant, including for researchers.
  // No county-wide wildcards, superuser, "all", or default-open policy.
  return identity.parcelGrants.some((grant) =>
    grant && typeof grant === 'object'
    && grant.countyFips === scope.countyFips
    && grant.parcelId === scope.parcelId);
}

/**
 * Resolve a VERIFIED server-side session into a trusted identity object:
 * {
 *   authenticated: true,
 *   subject: 'operator-123',
 *   roles: ['evidence-reader' | 'evidence-researcher'],
 *   parcelGrants: [{ countyFips: '48453', parcelId: '302959' }]
 * }
 *
 * `session` is an opaque server-side session handle, not a request body.
 * A resolver that simply returns client claims is unsafe and prohibited.
 */
export function createRegulatoryEvidenceGate(resolveAuthenticatedIdentity) {
  if (typeof resolveAuthenticatedIdentity !== 'function') {
    throw new TypeError('A trusted server-side identity resolver is required');
  }

  return async (session, operation, requestedScope) => {
    let scope;
    try {
      scope = validateRegulatoryLedgerScope(requestedScope);
    } catch {
      return denyEvidenceAccess();
    }
    let identity;
    try {
      identity = await resolveAuthenticatedIdentity(session);
    } catch {
      return denyEvidenceAccess();
    }
    if (!allowed(identity, operation, scope)) return denyEvidenceAccess();

    // Decision is for trusted server internals only, not an approval status.
    return Object.freeze({
      operation,
      countyFips: scope.countyFips,
      parcelId: scope.parcelId,
      subject: identity.subject,
      legalClearance: null,
      acquisitionRecommendation: null,
    });
  };
}
