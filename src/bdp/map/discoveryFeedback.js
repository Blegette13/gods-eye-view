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
  const complete = viewports.filter((item) => item?.complete === true && Array.isArray(item.parcels));
  if (!complete.length) return Object.freeze({
    state: 'not-scanned', count: null, scanned: 0, pins: [],
    message: 'Not scanned yet · Zoom into a neighborhood and enable the county parcel layer. No countywide search has been performed.',
  });
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
