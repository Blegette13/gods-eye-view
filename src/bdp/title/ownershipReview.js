export const TITLE_REVIEW_REFERENCES = Object.freeze({
  texasGuidance: 'https://www.tdi.texas.gov/title/titlefaqs.html',
  bexarRecords: 'https://www.bexar.org/2950/Real-PropertyLand-Records',
  travisRecords: 'https://countyclerk.traviscountytx.gov/departments/recording/real-property/',
  williamsonRecords: 'https://www.wilcotx.gov/1611/Search-Records',
  haysRecords: 'https://www.hayscountytx.gov/166/County-Clerk',
});

const clean = (value) => typeof value === 'string' ? value.trim() : '';
function positive(value) {
  return (typeof value === 'number' || typeof value === 'string')
    && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
}

function recordLookup(parcel) {
  const county = clean(parcel.county || parcel.jurisdiction?.county).toLowerCase().replace(/ county$/, '');
  const fips = clean(parcel.countyFips);
  // Conflicting county identifiers must never send a buyer to the wrong clerk.
  for (const [name, codes, url] of [
    ['bexar', ['48029', '029'], TITLE_REVIEW_REFERENCES.bexarRecords],
    ['travis', ['48453', '453'], TITLE_REVIEW_REFERENCES.travisRecords],
    ['williamson', ['48491', '491'], TITLE_REVIEW_REFERENCES.williamsonRecords],
    ['hays', ['48209', '209'], TITLE_REVIEW_REFERENCES.haysRecords],
  ]) {
    const byName = county === name;
    const byFips = codes.includes(fips);
    if ((byName && (!fips || byFips)) || (byFips && (!county || byName))) {
      return Object.freeze({ label: `${name[0].toUpperCase()}${name.slice(1)} County land records`, url, status: 'manual-lookup' });
    }
  }
  return Object.freeze({ label: 'County land-record lookup', url: null, status: 'not-configured' });
}

/** A document-request plan, never an automated title search or legal finding. */
export function buildOwnershipTitleReview(parcel = {}, evidence = {}) {
  const tasks = [
    { id: 'vesting-deed', label: 'Vesting / conveyance', action: 'Obtain the recorded vesting deed and match its parties and legal description to the proposed conveyance.' },
    { id: 'seller-authority', label: 'Seller authority', action: 'Document the seller’s identity and authority to convey; resolve entity, estate or other authority questions with the title reviewer.' },
    { id: 'commitment-exceptions', label: 'Title commitment', action: 'Review the title commitment, Schedule B exceptions, Schedule C requirements and the underlying exception documents.' },
    { id: 'survey-easements', label: 'Survey / easements', action: 'Reconcile the survey, recorded descriptions, easements, restrictions and encroachments for the intended use.' },
    { id: 'legal-access', label: 'Legal access', action: 'Verify recorded access rights and their suitability for the intended use. Road proximity alone does not establish legal access.' },
    { id: 'liens-releases', label: 'Liens / releases', action: 'Have the title reviewer identify liens and required releases or other closing requirements.' },
    { id: 'tax-status', label: 'Taxes / assessments', action: 'Obtain current tax and assessment evidence; CAD valuation and exemption labels do not establish taxes paid or future tax treatment.' },
    { id: 'mineral-water', label: 'Mineral / water rights', action: 'Review reservations, leases and any claimed mineral or water rights and document what interests would convey.' },
  ].map((task) => ({ ...task, status: 'unknown', priority: 'standard-review', triggers: [] }));
  const taskFor = (id) => tasks.find((task) => task.id === id);
  const trigger = (id, source, detail) => {
    const task = taskFor(id);
    task.priority = 'mapped-evidence-review';
    task.triggers.push(Object.freeze({ source, detail }));
  };
  if (positive(evidence.energy?.pipeline_crossing_count)) {
    trigger('survey-easements', 'RRC', 'Mapped pipeline intersects the parcel; obtain the easement instrument and survey location. GIS does not establish easement dimensions.');
  }
  if (positive(evidence.utilities?.transmission_crossing_count)) {
    trigger('survey-easements', 'Transmission screening', 'Archived transmission mapping crosses the parcel; verify current facilities and recorded rights.');
  }
  if (positive(evidence.growthRadar?.mtp_crossing_count)) {
    trigger('survey-easements', 'Growth Radar', 'Mapped thoroughfare alignment intersects the parcel; verify right-of-way and acquisition status with the agency and title reviewer.');
  }
  if (positive(evidence.waterRights?.water_right_points_on_parcel)) {
    trigger('mineral-water', 'TCEQ', 'A mapped surface-water-right point is on the parcel; verify authorization, holder and conveyance evidence. The point does not establish ownership.');
  }
  const wellDistance = evidence.energy?.nearest_well_m;
  if ((typeof wellDistance === 'number' || typeof wellDistance === 'string')
    && String(wellDistance).trim() !== '' && Number.isFinite(Number(wellDistance))
    && Number(wellDistance) >= 0 && Number(wellDistance) <= 500) {
    trigger('mineral-water', 'RRC', 'A mapped well is within 500 meters; review relevant leases, reservations and surface-use rights. Proximity does not establish parcel mineral ownership.');
  }
  const observedOwner = clean(parcel.owner?.name) || null;
  return Object.freeze({
    status: 'documents-required', ownership_verified: false, title_clear: null,
    legal_access_verified: null, ownership_title_score_ready: false,
    observed_cad_owner: observedOwner,
    cad_legal_description: clean(parcel.property?.legalDescription) || null,
    cad_source: Object.freeze({
      provider: clean(parcel.source?.provider || parcel.source?.cad) || null,
      recordCurrency: clean(parcel.source?.recordCurrency) || 'unknown',
      lastRetrieved: clean(parcel.source?.lastVerified) || null,
    }),
    verified_document_count: 0,
    recordLookup: recordLookup(parcel),
    guidanceUrl: TITLE_REVIEW_REFERENCES.texasGuidance,
    tasks: Object.freeze(tasks.sort((a, b) => Number(b.triggers.length > 0) - Number(a.triggers.length > 0))
      .map((task) => Object.freeze({ ...task, triggers: Object.freeze(task.triggers) }))),
    notice: 'CAD owner and legal-description fields are source observations, not verified vesting or title clearance. Source retrieval time does not establish record currency. This review plan does not search recorded instruments or validate submitted documents; every title finding remains unknown.',
  });
}
