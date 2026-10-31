import { centerViewportBounds } from '../cad/travisViewportTiles.js';

export const PROGRESSIVE_CACHE_WINDOW_LIMIT = 6;
export const PROGRESSIVE_CACHE_RECORD_LIMIT = 1000;
export const PROGRESSIVE_CACHE_TTL_MS = 120_000;

function isBounds(b) {
  return b && ['west','south','east','north'].every((k) => Number.isFinite(b[k]))
    && b.west < b.east && b.south < b.north;
}
function intersects(a, b) {
  return a.west <= b.east && a.east >= b.west
    && a.south <= b.north && a.north >= b.south;
}
function contains(a, b) {
  return a.west <= b.west && a.east >= b.east
    && a.south <= b.south && a.north >= b.north;
}
function sourceGeometryBounds(feature) {
  const geometry = feature?.property?.geometry;
  if (!['Polygon','MultiPolygon'].includes(geometry?.type)) return null;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  function walk(coordinates) {
    if (!Array.isArray(coordinates)) return;
    if (coordinates.length >= 2 && typeof coordinates[0] === 'number'
        && typeof coordinates[1] === 'number') {
      const [lon, lat] = coordinates;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      west = Math.min(west,lon); east = Math.max(east,lon);
      south = Math.min(south,lat); north = Math.max(north,lat);
    } else {
      for (const inner of coordinates) walk(inner);
    }
  }
  walk(geometry.coordinates);
  return [west,south,east,north].every(Number.isFinite)
    ? {west,south,east,north} : null;
}
function sourceKey(row) {
  const id = row?.id;
  return typeof id === 'string' && id.length > 0
    && ['Polygon','MultiPolygon'].includes(row?.property?.geometry?.type) ? id : null;
}
function normalizedKey(b) {
  return [b.west,b.south,b.east,b.north].map((n)=>n.toFixed(7)).join(':');
}

/**
 * Pure, in-memory client cache of complete, identifiable source-query windows.
 * A window is never labeled as the entire map view. Source data is not stored
 * outside the running client session, and is never interpreted as for-sale.
 */
export function createProgressiveParcelCache({
  maxWindows = PROGRESSIVE_CACHE_WINDOW_LIMIT,
  maxRecords = PROGRESSIVE_CACHE_RECORD_LIMIT,
  ttlMs = PROGRESSIVE_CACHE_TTL_MS,
  now = Date.now,
} = {}) {
  if (!Number.isInteger(maxWindows) || maxWindows < 1 || maxWindows > 12
      || !Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 1000
      || !Number.isFinite(ttlMs) || ttlMs < 1000 || typeof now !== 'function') {
    throw new Error('Invalid progressive parcel cache budget');
  }
  const windows = new Map();
  // Date.now() has millisecond resolution: adjacent camera snapshots often
  // share a timestamp. A monotonic index guarantees the newly fetched window
  // is prioritized when the 1,000-parcel display budget cannot include both.
  let nextSequence = 0;
  function sweep() {
    const time = now();
    for (const [key,item] of windows) {
      if (time - item.loadedAt > ttlMs) windows.delete(key);
    }
  }
  function boundedCandidates(county,viewBounds) {
    sweep();
    return [...windows.values()]
      .filter((item)=>item.county === county && intersects(item.bounds,viewBounds))
      .sort((a,b)=>b.loadedAt-a.loadedAt || b.sequence-a.sequence);
  }
  function collect(county, viewBounds, items) {
    const selectedWindows = [];
    const rows = new Map();
    for (const item of items) {
      // Do not truncate one complete source window. Either admit all of
      // its parcel polygons or skip that older window entirely.
      const visible = item.records.filter((row)=> {
        const bbox = sourceGeometryBounds(row);
        return bbox && intersects(bbox,viewBounds);
      });
      let conflict = false;
      let additions = 0;
      for (const row of visible) {
        const old = rows.get(row.id);
        if (!old) {additions++;continue;}
        if (JSON.stringify(old.property.geometry) !== JSON.stringify(row.property.geometry)) {
          conflict = true;break;
        }
      }
      if (conflict || additions + rows.size > maxRecords) continue;
      for (const row of visible) if (!rows.has(row.id)) rows.set(row.id,row);
      selectedWindows.push(item.bounds);
    }
    if (!selectedWindows.length) return null;
    const out = [...rows.values()];
    Object.defineProperty(out,'viewportCoverage',{value:Object.freeze({
      focalOnly: true, progressive: selectedWindows.length > 1,
      focalBoundsList: Object.freeze(selectedWindows.map((b)=>Object.freeze({...b}))),
      focalBounds: Object.freeze({...selectedWindows[0]}),
      cached: items[0]?.fromCache === true,
      omittedUnidentified: 0, receivedCount: out.length,
      coverageNote: 'Only the outlined, source-queried GIS windows were evaluated.',
    })});
    return out;
  }
  function add({county,viewBounds,records}={}) {
    if (!county || !isBounds(viewBounds) || !Array.isArray(records)) return null;
    const coverage = records.viewportCoverage;
    // Cached windows must be a COMPLETE identification of that *source*
    // footprint. Partial/truncated/unknown and geometry conflicts excluded.
    const footprint = coverage?.focalBounds;
    if (coverage?.focalOnly !== true || !isBounds(footprint)
        || coverage.omittedUnidentified !== 0 || coverage.overLimit === true) return null;
    const ids = new Set();
    for (const row of records) {
      const id = sourceKey(row);
      if (!id || ids.has(id) || !sourceGeometryBounds(row)) return null;
      ids.add(id);
    }
    if (records.length > maxRecords) return null;
    sweep();
    const key = county + ':' + normalizedKey(footprint);
    windows.delete(key);
    windows.set(key,{ county, bounds:Object.freeze({...footprint}),
      records:[...records], loadedAt:now(), sequence:++nextSequence, fromCache:false });
    while (windows.size > maxWindows) windows.delete(windows.keys().next().value);
    return collect(county,viewBounds,boundedCandidates(county,viewBounds));
  }
  function reuse({county,viewBounds}={}) {
    if (!county || !isBounds(viewBounds)) return null;
    // Reuse only when *one* known source window fully covers the new center
    // footprint. Never fill a hole from adjacent cached snapshots.
    const focus = centerViewportBounds(viewBounds,0.5);
    const candidates = boundedCandidates(county,viewBounds);
    if (!candidates.some((item)=>contains(item.bounds,focus))) return null;
    return collect(county,viewBounds,candidates.map((item)=>({...item,fromCache:true})));
  }
  return Object.freeze({
    add,reuse,clear:()=>windows.clear(),
    size:()=>{sweep();return windows.size;},
  });
}
