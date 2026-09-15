const LAND_SEARCH_PATTERN = /^(parcel|account|acct)\s*:?[\s]+(.+)$/i;

function clean(value) {
  return String(value ?? '').trim();
}

/**
 * Parse BDP-specific commands entered into the existing God's Eye LOCATION box.
 * Ordinary place/address/coordinate searches return null and remain owned by
 * God's Eye View's native location search.
 */
export function parseBdpLandSearch(value) {
  const query = clean(value);
  if (!query) return null;

  const match = query.match(LAND_SEARCH_PATTERN);
  if (!match) return null;

  const parcelOrAccountId = clean(match[2]);
  if (!parcelOrAccountId || parcelOrAccountId.length > 64) return null;

  return Object.freeze({
    kind: 'parcel',
    value: parcelOrAccountId,
    command: match[1].toLowerCase(),
  });
}

export default parseBdpLandSearch;
