const EMPTY_OWNER = Object.freeze({
  name: '',
  mailingAddress: '',
});

const EMPTY_PROPERTY = Object.freeze({
  situsAddress: '',
  legalDescription: '',
  acres: null,
  geometry: null,
});

const EMPTY_VALUATION = Object.freeze({
  landValue: null,
  improvementValue: null,
  marketValue: null,
  assessedValue: null,
});

const EMPTY_ACQUISITION = Object.freeze({
  askingPrice: null,
  verifiedSalePrice: null,
  estimatedValue: null,
  pricePerAcre: null,
});

const EMPTY_JURISDICTION = Object.freeze({
  city: '',
  county: '',
  etj: '',
  schoolDistrict: '',
});

const EMPTY_SOURCE = Object.freeze({
  cad: '',
  recordUrl: '',
  provider: '',
  lastVerified: '',
});

function clone(value) {
  return structuredClone(value);
}

function finiteNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createEmptyParcel() {
  return {
    id: '',
    parcelId: '',
    county: '',
    countyFips: '',
    owner: clone(EMPTY_OWNER),
    property: clone(EMPTY_PROPERTY),
    valuation: clone(EMPTY_VALUATION),
    acquisition: clone(EMPTY_ACQUISITION),
    jurisdiction: clone(EMPTY_JURISDICTION),
    source: clone(EMPTY_SOURCE),
  };
}

/**
 * Merge provider/CAD output into the canonical BDP parcel contract.
 * County adapters should map their source fields into this shape before
 * rendering, scoring, reporting, or AI analysis.
 */
export function normalizeParcel(input = {}) {
  const parcel = createEmptyParcel();

  parcel.id = String(input.id || '').trim();
  parcel.parcelId = String(input.parcelId || '').trim();
  parcel.county = String(input.county || input.jurisdiction?.county || '').trim();
  parcel.countyFips = String(input.countyFips || '').trim();

  Object.assign(parcel.owner, input.owner || {});
  Object.assign(parcel.property, input.property || {});
  Object.assign(parcel.valuation, input.valuation || {});
  Object.assign(parcel.acquisition, input.acquisition || {});
  Object.assign(parcel.jurisdiction, input.jurisdiction || {});
  Object.assign(parcel.source, input.source || {});

  parcel.property.acres = finiteNumberOrNull(parcel.property.acres);

  for (const key of ['landValue', 'improvementValue', 'marketValue', 'assessedValue']) {
    parcel.valuation[key] = finiteNumberOrNull(parcel.valuation[key]);
  }

  for (const key of ['askingPrice', 'verifiedSalePrice', 'estimatedValue', 'pricePerAcre']) {
    parcel.acquisition[key] = finiteNumberOrNull(parcel.acquisition[key]);
  }

  if (!parcel.jurisdiction.county) parcel.jurisdiction.county = parcel.county;
  if (!parcel.county && parcel.jurisdiction.county) parcel.county = parcel.jurisdiction.county;

  if (!parcel.id) {
    const countyKey = parcel.countyFips || parcel.county.toLowerCase().replace(/\s+/g, '-');
    parcel.id = [countyKey, parcel.parcelId].filter(Boolean).join(':');
  }

  return parcel;
}

export function validateParcel(parcel) {
  const errors = [];
  if (!parcel || typeof parcel !== 'object') return ['parcel must be an object'];
  if (!parcel.parcelId) errors.push('parcelId is required');
  if (!parcel.county && !parcel.jurisdiction?.county) errors.push('county is required');
  if (parcel.property?.acres !== null && !Number.isFinite(parcel.property?.acres)) {
    errors.push('property.acres must be a finite number or null');
  }
  if (parcel.property?.geometry !== null && typeof parcel.property?.geometry !== 'object') {
    errors.push('property.geometry must be a GeoJSON-like object or null');
  }
  return errors;
}
