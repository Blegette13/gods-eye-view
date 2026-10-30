import { suggestViewportParcels } from './candidateHints.js';

/**
 * These are countable, provisional *source-field matches*, not a full county
 * search, sale listings, or verified suitability. Count the complete loaded
 * viewport independently of the 24 visible pin cap.
 */
export function summarizeDiscoveryCandidates({ criteria, center, viewports = [], pinLimit = 24 } = {}) {
  if (!criteria?.county) return Object.freeze({
    state: 'browse', count: null, scanned: 0, pins: [], message: 'Choose a search county to begin guided discovery.',
  });
  const evaluable = Boolean(criteria.zip || criteria.acresMin !== null && criteria.acresMin !== undefined
    || criteria.acresMax !== null && criteria.acresMax !== undefined);
  if (!evaluable) return Object.freeze({
    state: 'needs-evidence', count: null, scanned: 0, pins: [],
    message: 'Add a ZIP or acreage preference for preliminary source matching. Budget and land use cannot be verified from county parcel data.',
  });
  const relevant = criteria.radiusMiles === 0
    ? viewports.filter((item) => !item?.county || item.county === criteria.county)
    : viewports;
  const complete = relevant.filter((item) => item?.complete === true && Array.isArray(item.parcels));
  if (!complete.length) {
    const reasons = relevant.map((item) => item?.reason);
    const detail = reasons.includes('over-limit')
      ? 'Map area exceeds the GIS response limit. Zoom closer; no complete parcel inventory was loaded.'
      : reasons.includes('error')
        ? 'County source failed. Retry or inspect the GIS service; no match count is available.'
        : reasons.includes('partial')
          ? 'Source geometry is incomplete; no verified-complete viewport to evaluate.'
          : reasons.includes('loading')
            ? 'Loading bounded county parcel records…'
            : 'Zoom into a neighborhood and enable the county parcel layer. No countywide search has been performed.';
    return Object.freeze({
      state: 'not-scanned', count: null, scanned: 0, pins: [],
      message: 'Not scanned yet · ' + detail,
    });
  }
  const all = complete.flatMap((item) => item.parcels);
  const unique = new Set(all.map((parcel) => parcel?.county + ':' + parcel?.parcelId));
  const matches = suggestViewportParcels({
    criteria, center, parcels: all, limit: all.length,
  });
  const pins = matches.slice(0, pinLimit);
  const count = matches.length;
  const scanned = unique.size;
  return Object.freeze({
    state: count ? 'matches' : 'zero',
    count, scanned, pins: Object.freeze(pins),
    message: count
      ? `${count} possible ${count === 1 ? 'match' : 'matches'} in ${scanned} loaded map-view parcels · ${pins.length} pins shown. Not a countywide result.`
      : `0 preliminary matches among ${scanned} loaded map-view parcels. This does NOT mean none exist in the county or radius.`,
  });
}
