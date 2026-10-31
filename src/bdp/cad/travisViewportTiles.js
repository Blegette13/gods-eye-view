/**
 * Bounded, adaptive viewport partitions for GIS ArcGIS FeatureServer services.
 * Only use for a VIEWPORT that first reports a truncated provider response.
 * This is not a countywide inventory: it never bypasses a provider's cap,
 * fabricates parcels, or presents incomplete tiles as complete coverage.
 */
export const MAX_TRAVIS_VIEWPORT_TILE_QUERIES = 20; // 4 + 16, after original query
export const MAX_TRAVIS_VIEWPORT_PARCELS = 1000;

/**
 * Create a bounded central discovery footprint WITHIN the camera's full
 * viewport. This is a PARTIAL viewport, not a smaller legal parcel polygon.
 * The UI must draw the source window and label its results incomplete for
 * the visible map outside that footprint.
 */
export function centerViewportBounds(bounds, scale = 0.5) {
  const { west, south, east, north } = bounds || {};
  if (![west, south, east, north].every(Number.isFinite) || west >= east
      || south >= north || !Number.isFinite(scale) || scale <= 0 || scale >= 1) {
    throw new Error('Invalid center viewport bounds');
  }
  const lonPad = (east - west) * (1 - scale) / 2;
  const latPad = (north - south) * (1 - scale) / 2;
  return { west: west + lonPad, south: south + latPad,
    east: east - lonPad, north: north - latPad };
}

export function subdivideViewport(bounds) {
  const { west, south, east, north } = bounds || {};
  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) {
    throw new Error('Invalid tile bounds');
  }
  const midLon = (west + east) / 2;
  const midLat = (south + north) / 2;
  return [
    { west, south, east: midLon, north: midLat },
    { west: midLon, south, east, north: midLat },
    { west, south: midLat, east: midLon, north },
    { west: midLon, south: midLat, east, north },
  ];
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException('Viewport tile request cancelled', 'AbortError');
}

/**
 * The initial large query was already capped. Query 4 child envelopes, and
 * subdivide a truncated child once more (up to 4x4 worst-case). Sequential
 * requests preserve a small load on the county service and allow cancellation.
 *
 * Tile intersections repeat full parcel polygons at borders; deduplicate by
 * exact source parcel ID, but fail closed if a provider returns conflicting
 * geometries under the same ID.
 */
export async function collectTravisViewportTiles({
  bounds, limit, fetchTile, signal,
  maxParcels = MAX_TRAVIS_VIEWPORT_PARCELS,
} = {}) {
  if (typeof fetchTile !== 'function' || !Number.isInteger(limit) || limit < 1
      || !Number.isInteger(maxParcels) || maxParcels < 1 || maxParcels > MAX_TRAVIS_VIEWPORT_PARCELS) {
    throw new Error('Invalid bounded tiled viewport parameters');
  }
  const found = new Map();
  let queryCount = 0;
  let receivedCount = 0;
  let omittedUnidentified = 0;
  let failureReason = '';
  async function visit(rectangle, depth) {
    abortIfNeeded(signal);
    if (queryCount >= MAX_TRAVIS_VIEWPORT_TILE_QUERIES) {
      failureReason = 'tile budget exhausted';
      return false;
    }
    queryCount++;
    const records = await fetchTile(rectangle, { signal, limit });
    abortIfNeeded(signal);
    const coverage = records?.viewportCoverage;
    if (!Array.isArray(records) || !coverage) {
      throw new Error('GIS tile response missing viewport coverage metadata');
    }
    if (coverage.overLimit) {
      if (depth === 0) {
        failureReason = 'at least one GIS tile remains truncated';
        return false;
      }
      for (const child of subdivideViewport(rectangle)) {
        if (!await visit(child, depth - 1)) return false;
      }
      return true;
    }
    receivedCount += coverage.receivedCount;
    omittedUnidentified += coverage.omittedUnidentified || 0;
    for (const parcel of records) {
      if (!parcel?.id || !parcel?.property?.geometry) {
        throw new Error('GIS tile returned unidentifiable normalized parcel');
      }
      const prior = found.get(parcel.id);
      if (prior) {
        if (JSON.stringify(prior.property.geometry) !== JSON.stringify(parcel.property.geometry)) {
          failureReason = 'conflicting parcel geometries across tiles';
          return false;
        }
        continue;
      }
      found.set(parcel.id, parcel);
      if (found.size > maxParcels) {
        failureReason = 'bounded viewport display capacity exceeded';
        return false;
      }
    }
    return true;
  }
  // depth 1 for each quarter: only overloaded quarters are divided again.
  let complete = true;
  for (const tile of subdivideViewport(bounds)) {
    if (!await visit(tile, 1)) {
      complete = false;
      break;
    }
  }
  if (!complete) {
    return Object.freeze({ complete: false, parcels: [], queryCount,
      reason: failureReason || 'county source tile unavailable' });
  }
  return Object.freeze({
    complete: true, parcels: [...found.values()], queryCount,
    receivedCount, omittedUnidentified,
  });
}
