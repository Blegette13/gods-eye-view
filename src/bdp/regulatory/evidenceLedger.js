/**
 * BDP regulatory evidence ledger contract (pre-review / not legal clearance).
 * All records are parcel-scoped and append-only when persisted in PostGIS.
 * No GIS result or user-submitted document can automatically satisfy a task.
 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TASK_PATTERN = /^[a-z][a-z0-9-]{2,79}$/;
const EVENT_TYPES = Object.freeze(['document-indexed', 'review-note', 'correction-note']);

function textField(value, name, limit, required = false) {
  if (typeof value !== 'string' || value !== value.trim() || value.length > limit
    || (required && !value)) {
    throw new TypeError(`${name} must be a ${required ? 'nonempty ' : ''}trimmed string up to ${limit} characters`);
  }
  return value;
}

export function createRegulatoryEvidenceEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Evidence event must be an object');
  }
  const countyFips = textField(input.countyFips, 'countyFips', 5, true);
  if (!/^48\d{3}$/.test(countyFips)) throw new Error('Evidence county FIPS must be a Texas five-digit FIPS code');
  const parcelId = textField(input.parcelId, 'parcelId', 80, true);
  if (!ID_PATTERN.test(parcelId)) throw new Error('Invalid parcel identifier');
  const taskId = textField(input.taskId, 'taskId', 80, true);
  if (!TASK_PATTERN.test(taskId)) throw new Error('Invalid due diligence task identifier');
  const eventType = textField(input.eventType, 'eventType', 40, true);
  if (!EVENT_TYPES.includes(eventType)) throw new Error('Unsupported evidence event type');

  const sourceUrl = input.sourceUrl == null ? null : textField(input.sourceUrl, 'sourceUrl', 2048, true);
  if (sourceUrl) {
    let url;
    try { url = new URL(sourceUrl); } catch { throw new Error('Evidence source URL must be a valid HTTPS URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname
      || url.hash || /\s/.test(sourceUrl)) {
      throw new Error('Evidence source URL must use HTTPS without embedded credentials or fragments');
    }
  }
  const sourceTitle = input.sourceTitle == null ? null
    : textField(input.sourceTitle, 'sourceTitle', 250, true);
  const sourceDate = input.sourceDate == null ? null
    : textField(input.sourceDate, 'sourceDate', 10, true);
  if (sourceDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)
      || !Number.isFinite(Date.parse(sourceDate + 'T00:00:00Z'))
      || new Date(sourceDate + 'T00:00:00Z').toISOString().slice(0, 10) !== sourceDate) {
      throw new Error('sourceDate must be a valid ISO date or null (unknown)');
    }
  }
  const sourceSha256 = input.sourceSha256 == null ? null
    : textField(input.sourceSha256, 'sourceSha256', 64, true);
  if (sourceSha256 && !SHA256_PATTERN.test(sourceSha256)) {
    throw new Error('sourceSha256 must be a lowercase SHA-256 hex digest');
  }
  const notes = textField(input.notes, 'notes', 4000, true);
  const enteredBy = textField(input.enteredBy, 'enteredBy', 120, true);
  if (eventType === 'document-indexed' && (!sourceUrl || !sourceTitle)) {
    throw new Error('Document entries require source URL and source title');
  }
  return Object.freeze({
    countyFips, parcelId, taskId, eventType, sourceUrl, sourceTitle,
    sourceDate, sourceSha256, notes, enteredBy,
    verificationState: 'unverified',
    legalClearance: null, developmentRights: null, acquisitionRecommendation: null,
  });
}

/**
 * Ledger entries do not close the due diligence checklist. Completing a task
 * needs a separate authorized review and provenance workflow, not yet built.
 */
export function summarizeRegulatoryEvidence(events = []) {
  if (!Array.isArray(events)) throw new TypeError('Evidence entries must be an array');
  const eventsByTask = Object.create(null);
  for (const event of events) {
    if (event?.verificationState !== 'unverified' || !TASK_PATTERN.test(String(event.taskId || ''))) {
      throw new Error('Unrecognized evidence record');
    }
    eventsByTask[event.taskId] = (eventsByTask[event.taskId] || 0) + 1;
  }
  return Object.freeze({
    indexedRecords: events.length,
    taskEventCounts: Object.freeze(eventsByTask),
    verifiedTasks: 0,
    regulatoryClearance: null,
    acquisitionRecommendation: null,
  });
}
