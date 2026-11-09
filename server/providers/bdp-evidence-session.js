/**
 * Step 49: UNROUTED session-to-PostgreSQL identity binding contract.
 *
 * This is NOT a login implementation. The caller must supply:
 * 1. a trusted server-only authenticated session resolver;
 * 2. a server-side subject -> distinct per-operator PostgreSQL LOGIN mapping;
 * 3. a connection manager that pins ONE operator-authenticated DB connection
 *    (never the owner/superuser/shared pooled login) for the entire callback.
 *
 * The session profile and the subsequent SQL are executed through the same
 * callback's query function. PostgreSQL Step 47 RLS depends on SESSION_USER.
 * The original God's Eye / Cesium UI and anonymous Vite routes are untouched.
 */
import { createRegulatoryEvidenceGate, denyEvidenceAccess } from
  '../../src/bdp/regulatory/evidenceAccessPolicy.js';
import {
  buildRegulatoryEvidenceIndexSql,
  validateRegulatoryEvidenceIndexResult,
} from '../../src/bdp/regulatory/evidenceIndex.js';
import {
  prepareRegulatoryEvidenceRoleAppend,
  validateRegulatoryEvidenceInsertResult,
} from '../../src/bdp/regulatory/evidenceIntake.js';

// A future DB-login provisioning service must create unique, nonprivileged
// PostgreSQL logins in this namespace. No login is created by this module.
const OPERATOR_LOGIN = /^bdp_operator_[a-z0-9_]{6,40}$/;

export const EVIDENCE_DB_SESSION_PROBE = `
SELECT jsonb_build_object(
  'sessionUser', session_user::text,
  'currentUser', current_user::text,
  'isSuperuser', r.rolsuper,
  'bypassRls', r.rolbypassrls,
  'canLogin', r.rolcanlogin,
  'readerRoleUsable', pg_catalog.pg_has_role(
    session_user, 'bdp_evidence_reader', 'USAGE'),
  'appenderRoleUsable', pg_catalog.pg_has_role(
    session_user, 'bdp_evidence_appender', 'USAGE')
)::text
FROM pg_catalog.pg_roles AS r
WHERE r.rolname = session_user;
`;

export function requireBoundEvidenceDbSession(profile, expectedLogin, operation) {
  if (typeof expectedLogin !== 'string' || !OPERATOR_LOGIN.test(expectedLogin)
    || !profile || typeof profile !== 'object' || Array.isArray(profile)
    || profile.sessionUser !== expectedLogin
    || profile.currentUser !== expectedLogin
    || profile.canLogin !== true
    || profile.isSuperuser !== false
    || profile.bypassRls !== false
    || (operation === 'read-index' && profile.readerRoleUsable !== true)
    || (operation === 'append-event' && profile.appenderRoleUsable !== true)
    || !['read-index', 'append-event'].includes(operation)) {
    return denyEvidenceAccess();
  }
  return true;
}

/**
 * NOTE: The database connection contract MUST pin a dedicated authenticated
 * PostgreSQL connection for each entire callback, including the probe and
 * the evidence query. For pooling, never reset/set SESSION AUTHORIZATION to
 * switch users on a shared superuser connection. A normal pg Pool's query()
 * is NOT a sufficient pinned-connection implementation.
 *
 * resolveOperatorDbLogin({subject}) must consult trusted, admin-managed
 * operator mappings, not cookies, authorization headers, or request JSON.
 */
export function createSessionBoundEvidenceService({
  resolveAuthenticatedIdentity,
  resolveOperatorDbLogin,
  withOperatorDbConnection,
} = {}) {
  const requireAccess = createRegulatoryEvidenceGate(resolveAuthenticatedIdentity);
  if (typeof resolveOperatorDbLogin !== 'function'
    || typeof withOperatorDbConnection !== 'function') {
    throw new TypeError('Trusted operator login resolver and pinned connection manager are required');
  }

  async function authorizedQuery(decision, operation, task) {
    let login;
    try {
      login = await resolveOperatorDbLogin({ subject: decision.subject });
    } catch {
      return denyEvidenceAccess();
    }
    if (typeof login !== 'string' || !OPERATOR_LOGIN.test(login)) {
      return denyEvidenceAccess();
    }
    // Do not return secrets or a client-selectable role to the caller.
    return withOperatorDbConnection(
      { login, operation, mustPinConnection: true },
      async ({ query } = {}) => {
        if (typeof query !== 'function') return denyEvidenceAccess();
        const profile = await query(EVIDENCE_DB_SESSION_PROBE, {
          timeoutMs: 5000, maxOutputBytes: 8192,
        });
        requireBoundEvidenceDbSession(profile, login, operation);
        return task(query);
      },
    );
  }

  return Object.freeze({
    async readIndex(session, requestedScope) {
      const decision = await requireAccess(session, 'read-index', requestedScope);
      const scope = { countyFips: decision.countyFips, parcelId: decision.parcelId };
      return authorizedQuery(decision, 'read-index', async (query) => {
        const raw = await query(buildRegulatoryEvidenceIndexSql(scope), {
          timeoutMs: 20000, maxOutputBytes: 200000,
        });
        return validateRegulatoryEvidenceIndexResult(raw, scope);
      });
    },

    async appendEvent(session, submittedEvent) {
      if (!submittedEvent || typeof submittedEvent !== 'object'
        || Array.isArray(submittedEvent)) {
        throw new TypeError('Expected a regulatory research event object');
      }
      // Freeze snapshot before an awaited session/role resolution.
      const event = Object.freeze({ ...submittedEvent });
      const prepared = prepareRegulatoryEvidenceRoleAppend(event);
      const op = event.eventType === 'document-indexed' ? 'append-document' : 'append-note';
      const decision = await requireAccess(session, op, prepared.preview);
      if (decision.countyFips !== prepared.preview.countyFips
        || decision.parcelId !== prepared.preview.parcelId) return denyEvidenceAccess();
      return authorizedQuery(decision, 'append-event', async (query) => {
        const raw = await query(prepared.sql, {
          timeoutMs: 20000, maxOutputBytes: 8192,
        });
        return validateRegulatoryEvidenceInsertResult(raw, event);
      });
    },
  });
}
