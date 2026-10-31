/**
 * Build an explicitly append-only research event INSERT for a LOCAL operator CLI.
 * All caller-supplied text travels as UTF-8 hex bytes decoded by PostgreSQL,
 * never as SQL syntax, connection arguments or CLI options.
 *
 * WARNING: Not a general query builder, not a remote API and not legal clearance.
 */
import { createRegulatoryEvidenceEvent } from './evidenceLedger.js';

const FIELDS = Object.freeze([
  'countyFips', 'parcelId', 'taskId', 'eventType',
  'sourceUrl', 'sourceTitle', 'sourceDate', 'sourceSha256',
  'notes', 'enteredBy',
]);

export function prepareRegulatoryEvidenceInsert(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Expected a plain research event object');
  }
  const extras = Object.keys(input).filter((name) => !FIELDS.includes(name));
  if (extras.length > 0) {
    throw new Error('Unexpected regulatory evidence input fields; no approval fields are accepted');
  }
  const event = createRegulatoryEvidenceEvent(input);
  const payload = Object.fromEntries(FIELDS.map((key) => [key, event[key]]));
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('hex');
  // JSON is reconstituted via decode() + convert_from(): no user-controlled
  // literal includes a quote, semicolon, backslash, dollar marker or newline.
  const sql = `
WITH payload AS (
  SELECT convert_from(decode('${encoded}', 'hex'), 'UTF8')::jsonb AS d
), inserted AS (
  INSERT INTO bdp_regulatory_evidence_events
    (county_fips, parcel_id, task_id, event_type, source_url,
     source_title, source_date, source_sha256, notes, entered_by)
  SELECT d->>'countyFips', d->>'parcelId', d->>'taskId', d->>'eventType',
         d->>'sourceUrl', d->>'sourceTitle', (d->>'sourceDate')::date,
         d->>'sourceSha256', d->>'notes', d->>'enteredBy'
  FROM payload
  RETURNING id, county_fips, parcel_id, task_id, event_type,
            verification_state, recorded_at
)
SELECT jsonb_build_object(
  'eventId', id,
  'countyFips', trim(county_fips),
  'parcelId', parcel_id,
  'taskId', task_id,
  'eventType', event_type,
  'verificationState', verification_state,
  'recordedAt', recorded_at,
  'legalClearance', NULL,
  'acquisitionRecommendation', NULL
)::text FROM inserted;
`;
  return Object.freeze({ sql, preview: Object.freeze({
    countyFips: event.countyFips,
    parcelId: event.parcelId,
    taskId: event.taskId,
    eventType: event.eventType,
    sourceDate: event.sourceDate,
    hasSourceUrl: event.sourceUrl !== null,
    hasSourceSha256: event.sourceSha256 !== null,
    verificationState: 'unverified',
    legalClearance: null,
    acquisitionRecommendation: null,
  }) });
}

export function validateRegulatoryEvidenceInsertResult(output, expected) {
  const { preview } = prepareRegulatoryEvidenceInsert(expected);
  if (!output || typeof output !== 'object' || Array.isArray(output)
    || !Number.isSafeInteger(output.eventId) || output.eventId < 1
    || output.countyFips !== preview.countyFips
    || output.parcelId !== preview.parcelId
    || output.taskId !== preview.taskId
    || output.eventType !== preview.eventType
    || output.verificationState !== 'unverified'
    || typeof output.recordedAt !== 'string'
    || !Number.isFinite(Date.parse(output.recordedAt))
    || output.legalClearance !== null
    || output.acquisitionRecommendation !== null) {
    throw new Error('Regulatory evidence append result failed parcel/provenance or unverified-state checks');
  }
  return Object.freeze({
    eventId: output.eventId, countyFips: preview.countyFips,
    parcelId: preview.parcelId, taskId: preview.taskId, eventType: preview.eventType,
    verificationState: 'unverified', recordedAt: output.recordedAt,
    legalClearance: null, acquisitionRecommendation: null,
  });
}

/**
 * Step 46 service-account variant: call the ONLY RPC granted to the NOLOGIN
 * bdp_evidence_appender role. Never grant that role direct table access.
 * Authorization still requires a separately authenticated, parcel-scoped
 * server session. Local owner-only CLIs retain the original INSERT builder.
 */
export function prepareRegulatoryEvidenceRoleAppend(input) {
  const { preview } = prepareRegulatoryEvidenceInsert(input);
  const event = createRegulatoryEvidenceEvent(input);
  const payload = Object.fromEntries(FIELDS.map((key) => [key, event[key]]));
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('hex');
  const sql = `
SELECT public.bdp_evidence_append_unverified(
  convert_from(decode('${encoded}', 'hex'), 'UTF8')::jsonb
)::text;
`;
  return Object.freeze({ sql, preview });
}
