/**
 * Phase 2 onboarding and session-only acquisitions model.
 *
 * IMPORTANT: This is an interface prototype, not a customer account or
 * persistent CRM. Records and buyer criteria live in memory until tab reload.
 * Never equate an asking budget with verified pricing or a planned land use
 * with confirmed zoning/entitlements.
 */
export const ACQUISITION_STAGES = Object.freeze([
  'Identified', 'Screening', 'Due Diligence',
  'Negotiation', 'Under Contract', 'Acquired',
]);
export const LAND_PURPOSES = Object.freeze([
  'Residential development',
  'Commercial development',
  'Industrial / logistics',
  'Agriculture / rural',
  'Hold for investment',
  'Other / undecided',
]);

function optionalNonnegative(value, label) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000000000) {
    throw new Error(`${label} must be a valid nonnegative number.`);
  }
  return number;
}

export function normalizeLandCriteria(input = {}) {
  const purpose = String(input.purpose || '').trim();
  if (purpose && !LAND_PURPOSES.includes(purpose)) throw new Error('Choose a listed land use.');
  const zip = String(input.zip || '').trim();
  if (zip && !/^\d{5}$/.test(zip)) throw new Error('Enter a five-digit ZIP code.');
  const budgetMax = optionalNonnegative(input.budgetMax, 'Budget');
  const acresMin = optionalNonnegative(input.acresMin, 'Minimum acres');
  const acresMax = optionalNonnegative(input.acresMax, 'Maximum acres');
  if (acresMin !== null && acresMax !== null && acresMax < acresMin) {
    throw new Error('Maximum acres cannot be smaller than minimum acres.');
  }
  return Object.freeze({ purpose, zip, budgetMax, acresMin, acresMax });
}

const COUNTIES = new Set(['Bexar', 'Travis', 'Williamson', 'Hays', 'Dallas', 'Harris']);
function safeText(input, max = 220) {
  return typeof input === 'string' ? input.slice(0, max).trim() : '';
}

export function acquisitionSnapshot(parcel) {
  if (!parcel || !COUNTIES.has(parcel.county)) return null;
  const parcelId = safeText(parcel.parcelId, 100);
  if (!parcelId) return null;
  const countyFips = safeText(parcel.countyFips, 8);
  // County + external parcel ID are the durable logical identity for a
  // future server-side account model, but this object is NOT persisted.
  const key = `${parcel.county}:${parcelId}`;
  const acreage = parcel.property?.acres;
  return Object.freeze({
    key,
    county: parcel.county,
    countyFips: countyFips || null,
    parcelId,
    address: safeText(parcel.property?.situsAddress) || `Parcel ${parcelId}`,
    ownerReported: safeText(parcel.owner?.name) || 'Not provided',
    acresReported: typeof acreage === 'number' && Number.isFinite(acreage) ? acreage : null,
    provider: safeText(parcel.source?.provider || parcel.source?.cad),
    recordCurrency: safeText(parcel.source?.recordCurrency) || 'unknown',
    stage: ACQUISITION_STAGES[0],
  });
}

/**
 * All mutations return new immutable snapshots. No localStorage, cookies,
 * outbound API calls, or implied multi-user authentication.
 */
export function createAcquisitionSession() {
  const entries = new Map();
  return Object.freeze({
    add(parcel) {
      const entry = acquisitionSnapshot(parcel);
      if (!entry) return null;
      if (!entries.has(entry.key)) entries.set(entry.key, entry);
      return entries.get(entry.key);
    },
    move(key, stage) {
      if (!ACQUISITION_STAGES.includes(stage) || !entries.has(key)) return false;
      entries.set(key, Object.freeze({ ...entries.get(key), stage }));
      return true;
    },
    remove(key) { return entries.delete(key); },
    all() { return Object.freeze([...entries.values()]); },
  });
}

/**
 * Criteria badges are NOT a candidate score and never filter out missing
 * records. Sourced acreage/addresses are provisional, sale asking prices
 * and legal development rights are UNKNOWN until separately evidenced.
 */
export function reviewLandCriteria(criteria, entry) {
  const findings = [];
  if (criteria?.zip) {
    // Only interpret a ZIP at the end of the situs address; a five-digit
    // street number or arbitrary parcel text must not masquerade as a ZIP.
    const match = entry?.address?.match(/(?:^|\s)(\d{5})(?:-\d{4})?\s*$/);
    findings.push(Object.freeze({
      field: 'ZIP (source address)',
      status: match ? (match[1] === criteria.zip ? 'reported-match' : 'reported-outside') : 'unknown',
    }));
  }
  if (criteria?.acresMin !== null && criteria?.acresMin !== undefined
      || criteria?.acresMax !== null && criteria?.acresMax !== undefined) {
    const a = entry?.acresReported;
    findings.push(Object.freeze({
      field: 'Acreage (source reported)',
      status: typeof a !== 'number' || a <= 0
        ? 'unknown'
        : (criteria.acresMin !== null && criteria.acresMin !== undefined && a < criteria.acresMin)
          || (criteria.acresMax !== null && criteria.acresMax !== undefined && a > criteria.acresMax)
          ? 'reported-outside' : 'reported-match',
    }));
  }
  if (criteria?.budgetMax !== null && criteria?.budgetMax !== undefined) {
    findings.push(Object.freeze({ field: 'Budget / asking price', status: 'unknown' }));
  }
  if (criteria?.purpose) {
    findings.push(Object.freeze({ field: 'Permitted land use', status: 'unknown' }));
  }
  return Object.freeze(findings);
}
