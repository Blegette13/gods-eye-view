/**
 * Phase 2: expose the ONE existing location input as the persistent land search.
 *
 * Moving the DOM node (not cloning it) retains native Google geocoding and the
 * BDP capture-phase parcel command handler, including their existing listeners,
 * navigation authority, abort behavior and search generation semantics.
 * Does not fetch or infer property data.
 */
export function mountPersistentLandSearch(root = document) {
  if (root.getElementById('land-search-bar')) return true;
  const search = root.getElementById('location-search');
  const wrap = search?.parentElement;
  if (!wrap?.classList.contains('location-search-wrap') || !root.body) return false;

  const bar = root.createElement('section');
  bar.id = 'land-search-bar';
  bar.setAttribute('role', 'search');
  bar.setAttribute('aria-label', 'Property and location search');

  const heading = root.createElement('label');
  heading.className = 'land-search-heading';
  heading.htmlFor = 'location-search';
  heading.textContent = 'PROPERTY & LOCATION SEARCH';

  const hint = root.createElement('div');
  hint.id = 'land-search-hint';
  hint.className = 'land-search-hint';
  hint.textContent = 'Address / coordinates / county parcel: ID / county account: ID / county owner: NAME';

  const status = root.createElement('div');
  status.id = 'land-search-status';
  status.className = 'land-search-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  search.placeholder = 'Search address, parcel, account, owner or coordinates';
  search.setAttribute('aria-label', 'Search for an address or coordinates, or enter a county parcel, account or owner command');
  search.setAttribute('aria-describedby', 'land-search-hint land-search-status');

  bar.append(heading, wrap, hint, status);
  root.body.append(bar);
  return true;
}

export default mountPersistentLandSearch;
