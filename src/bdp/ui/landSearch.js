const LAND_SEARCH_PATTERN = /^(parcel|account|acct|owner)\s*:?[\s]+(.+)$/i;

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

  const command = match[1].toLowerCase();
  const term = clean(match[2]);
  if (!term) return null;

  if (command === 'owner') {
    if (term.length < 2 || term.length > 70) return null;
    return Object.freeze({
      kind: 'owner',
      value: term,
      command,
    });
  }

  if (term.length > 64) return null;
  return Object.freeze({
    kind: 'parcel',
    value: term,
    command,
  });
}

export default parseBdpLandSearch;
