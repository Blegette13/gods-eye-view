/**
 * Parcel-scoped, metadata-only lookup of locally indexed regulatory evidence.
 *
 * IMPORTANT: Do not expose this through the unauthenticated Vite API. Local
 * operator use only until proper authentication/authorization and privacy
 * boundaries are implemented. No document is ever treated as verified.
 */
const COUNTY_FIPS_RE = /^48\d{3}$/;
const PARCEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export function validateRegulatoryLedgerScope({ countyFips, parcelId } = {}) {
  if (typeof countyFips !== 'string' || !COUNTY_FIPS_RE.test(countyFips)) {
    throw new TypeError('Expected five-digit Texas county FIPS, e.g. 48453');
  }
  if (typeof parcelId !== 'string' || !PARCEL_ID_RE.test(parcelId)) {
    throw new TypeError('Expected a simple parcel identifier (1–80 characters)');
  }
  return Object.freeze({ countyFips, parcelId });
}

export function buildRegulatoryEvidenceIndexSql(scope, { limit = 50 } = {}) {
  const { countyFips, parcelId } = validateRegulatoryLedgerScope(scope);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('Evidence inspection limit must be 1–100');
  }
  // Identifiers have strict allowlisted alphabets (no SQL delimiters).
  // This is NOT a general SQL query builder or a substitute for bind parameters
  // in a future authenticated app/API.
  return `
WITH scoped AS (
  SELECT id, county_fips, parcel_id, task_id, event_type, source_title,
         source_date, source_sha256, verification_state, recorded_at
  FROM bdp_regulatory_evidence_events
  WHERE county_fips = '${countyFips}' AND parcel_id = '${parcelId}'
), page AS (
  SELECT * FROM scoped ORDER BY recorded_at DESC, id DESC LIMIT ${limit}
)
SELECT jsonb_build_object(
  'countyFips', '${countyFips}',
  'parcelId', '${parcelId}',
  'totalEvents', (SELECT count(*) FROM scoped),
  'returnedEvents', (SELECT count(*) FROM page),
  'truncated', (SELECT count(*) FROM scoped) > ${limit},
  'events', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'taskId', task_id,
      'eventType', event_type,
      'sourceTitle', source_title,
      'sourceDate', source_date,
      'sourceSha256', source_sha256,
      'verificationState', verification_state,
      'recordedAt', recorded_at
    ) ORDER BY recorded_at DESC, id DESC)
    FROM page
  ), '[]'::jsonb),
  'verifiedTasks', 0,
  'legalClearance', NULL,
  'acquisitionRecommendation', NULL
)::text;
`;
}

export function validateRegulatoryEvidenceIndexResult(result, scope) {
  const validated = validateRegulatoryLedgerScope(scope);
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || result.countyFips !== validated.countyFips
    || result.parcelId !== validated.parcelId
    || !Number.isInteger(result.totalEvents) || result.totalEvents < 0
    || !Number.isInteger(result.returnedEvents) || result.returnedEvents < 0
    || !Array.isArray(result.events) || result.events.length !== result.returnedEvents
    || result.totalEvents < result.returnedEvents
    || result.truncated !== (result.totalEvents > result.returnedEvents)
    || result.verifiedTasks !== 0
    || result.legalClearance !== null
    || result.acquisitionRecommendation !== null) {
    throw new Error('Malformed regulatory evidence index response; cannot report clearance');
  }
  for (const event of result.events) {
    if (!event || event.verificationState !== 'unverified' ||
      !Number.isSafeInteger(event.id) || event.id < 1) {
      throw new Error('Unrecognized evidence event or unauthorized verification state');
    }
  }
  return Object.freeze({
    countyFips: result.countyFips,
    parcelId: result.parcelId,
    totalEvents: result.totalEvents,
    returnedEvents: result.returnedEvents,
    truncated: result.truncated,
    events: Object.freeze(result.events.map((e) => Object.freeze({ ...e }))),
    verifiedTasks: 0,
    legalClearance: null,
    acquisitionRecommendation: null,
  });
}
