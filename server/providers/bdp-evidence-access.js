/**
 * Step 45 trusted-server integration boundary (NOT routed to HTTP/Vite).
 *
 * Integrators must supply a genuine server-side session resolver. A resolver
 * that trusts browser-supplied roles / parcel grants is NOT authentication.
 * Local Step 42-44 CLI tooling is unchanged. No evidence is automatically
 * verified by a read or append.
 */
import { queryPostgisJsonStdin } from './bdp-psql.js';
import { createRegulatoryEvidenceGate } from '../../src/bdp/regulatory/evidenceAccessPolicy.js';
import {
  buildRegulatoryEvidenceIndexSql,
  validateRegulatoryEvidenceIndexResult,
} from '../../src/bdp/regulatory/evidenceIndex.js';
import {
  prepareRegulatoryEvidenceInsert,
  validateRegulatoryEvidenceInsertResult,
} from '../../src/bdp/regulatory/evidenceIntake.js';

export function createScopedRegulatoryEvidenceService({
  resolveAuthenticatedIdentity,
  query = queryPostgisJsonStdin,
} = {}) {
  const requireAccess = createRegulatoryEvidenceGate(resolveAuthenticatedIdentity);
  if (typeof query !== 'function') {
    throw new TypeError('Trusted PostGIS query adapter must be a function');
  }

  return Object.freeze({
    async readIndex(session, requestedScope) {
      const decision = await requireAccess(session, 'read-index', requestedScope);
      const scope = { countyFips: decision.countyFips, parcelId: decision.parcelId };
      const raw = await query(buildRegulatoryEvidenceIndexSql(scope), {
        timeoutMs: 20_000, maxOutputBytes: 200_000,
      });
      return validateRegulatoryEvidenceIndexResult(raw, scope);
    },

    async appendEvent(session, submittedEvent) {
      // Defensive snapshot: an async session resolution cannot change which
      // parcel the subsequently persisted event belongs to.
      if (!submittedEvent || typeof submittedEvent !== 'object'
        || Array.isArray(submittedEvent)) {
        throw new TypeError('Expected a regulatory research event object');
      }
      const event = Object.freeze({ ...submittedEvent });
      const prepared = prepareRegulatoryEvidenceInsert(event);
      const operation = event.eventType === 'document-indexed'
        ? 'append-document' : 'append-note';
      const decision = await requireAccess(session, operation, prepared.preview);
      if (decision.countyFips !== prepared.preview.countyFips ||
          decision.parcelId !== prepared.preview.parcelId) {
        throw new Error('Regulatory evidence scope mismatch');
      }
      const raw = await query(prepared.sql, {
        timeoutMs: 20_000, maxOutputBytes: 8192,
      });
      return validateRegulatoryEvidenceInsertResult(raw, event);
    },
  });
}
