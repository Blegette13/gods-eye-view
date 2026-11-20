/**
 * Step 45 trusted-server integration boundary (NOT routed to HTTP/Vite).
 *
 * Integrators must supply a genuine server-side session resolver. A resolver
 * that trusts browser-supplied roles / parcel grants is NOT authentication.
 * Local Step 42-44 CLI tooling is unchanged. The server-side append path
 * calls only the Step 46 restricted PostGIS RPC. This adapter still needs a
 * separately authenticated resolver and least-privilege DB credentials.
 * No evidence is automatically verified by a read or append.
 * The readQuery and appendQuery adapters MUST be supplied by trusted server
 * code using separately provisioned restricted read/append DB privileges,
 * never the local bdp owner/superuser connection. This module is NOT routed.
 */
import { createRegulatoryEvidenceGate } from '../../src/bdp/regulatory/evidenceAccessPolicy.js';
import {
  buildRegulatoryEvidenceIndexSql,
  validateRegulatoryEvidenceIndexResult,
} from '../../src/bdp/regulatory/evidenceIndex.js';
import {
  prepareRegulatoryEvidenceRoleAppend,
  validateRegulatoryEvidenceInsertResult,
} from '../../src/bdp/regulatory/evidenceIntake.js';

export function createScopedRegulatoryEvidenceService({
  resolveAuthenticatedIdentity,
  readQuery,
  appendQuery,
} = {}) {
  const requireAccess = createRegulatoryEvidenceGate(resolveAuthenticatedIdentity);
  if (typeof readQuery !== 'function' || typeof appendQuery !== 'function') {
    throw new TypeError('Explicitly injected separate readQuery and appendQuery adapters are required');
  }

  return Object.freeze({
    async readIndex(session, requestedScope) {
      const decision = await requireAccess(session, 'read-index', requestedScope);
      const scope = { countyFips: decision.countyFips, parcelId: decision.parcelId };
      const raw = await readQuery(buildRegulatoryEvidenceIndexSql(scope), {
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
      const prepared = prepareRegulatoryEvidenceRoleAppend(event);
      const operation = event.eventType === 'document-indexed'
        ? 'append-document' : 'append-note';
      const decision = await requireAccess(session, operation, prepared.preview);
      if (decision.countyFips !== prepared.preview.countyFips ||
          decision.parcelId !== prepared.preview.parcelId) {
        throw new Error('Regulatory evidence scope mismatch');
      }
      const raw = await appendQuery(prepared.sql, {
        timeoutMs: 20_000, maxOutputBytes: 8192,
      });
      return validateRegulatoryEvidenceInsertResult(raw, event);
    },
  });
}
