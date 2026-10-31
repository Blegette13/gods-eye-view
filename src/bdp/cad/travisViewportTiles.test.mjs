import test from 'node:test';
import assert from 'node:assert/strict';
import {
  subdivideViewport, centerViewportBounds, collectTravisViewportTiles,
  MAX_TRAVIS_VIEWPORT_TILE_QUERIES, MAX_TRAVIS_VIEWPORT_PARCELS,
} from './travisViewportTiles.js';

const bounds = { west: -97.8, south: 30.2, east: -97.7, north: 30.3 };
const parcel = (id, variant = 1) => ({
  id: '48453:' + id, parcelId: String(id), county: 'Travis',
  property: { geometry: { type: 'Polygon',
    coordinates: [[[-97.8, 30.2],[-97.7,30.2],[-97.7,30.2+variant/100],[-97.8,30.2]]] } },
});
const tileResult = (records, overLimit = false) => {
  const value = overLimit ? [] : records;
  Object.defineProperty(value, 'viewportCoverage', {
    value: { receivedCount: overLimit ? 501 : records.length,
      omittedUnidentified: 0, ...(overLimit ? { overLimit: true } : {}) },
  });
  return value;
};

test('splits a bounded rectangle into exactly four non-overlapping query envelopes', () => {
  const areas = subdivideViewport(bounds);
  assert.equal(areas.length, 4);
  assert.deepEqual(areas[0], { west:-97.8, south:30.2, east:-97.75, north:30.25 });
  assert.deepEqual(areas[3], { west:-97.75, south:30.25, east:-97.7, north:30.3 });
  assert.throws(() => subdivideViewport({ west:1, south:1, east:0, north:2 }));
});

test('gathers all uniquely identifiable parcels across four complete ArcGIS tiles', async () => {
  const seen = [];
  const result = await collectTravisViewportTiles({
    bounds, limit:500,
    fetchTile: async (tile, {limit}) => {
      assert.equal(limit, 500);
      const index = subdivideViewport(bounds).findIndex((t) => t.west === tile.west
        && t.south === tile.south && t.east === tile.east && t.north === tile.north);
      seen.push(index);
      return tileResult([parcel('001'), parcel(String(index+10))]);
    },
  });
  assert.deepEqual(seen, [0,1,2,3]);
  assert.equal(result.complete, true);
  assert.equal(result.queryCount, 4);
  assert.equal(result.parcels.length, 5, 'shared border polygon deduplicated by exact county ID');
  assert.equal(result.parcels[0].parcelId, '001');
  assert.equal(result.receivedCount, 8, 'raw tile observations not misreported as unique parcels');
});

test('only truncated quarters are subdivided to 4x4 and budget stays finite', async () => {
  const first = subdivideViewport(bounds)[0];
  let calls = 0;
  const result = await collectTravisViewportTiles({
    bounds, limit:500, fetchTile: async (tile) => {
      calls++;
      if (tile.west === first.west && tile.east === first.east
          && tile.south === first.south && tile.north === first.north) {
        return tileResult([], true);
      }
      return tileResult([parcel('P'+calls)]);
    },
  });
  assert.equal(result.complete, true);
  assert.equal(result.queryCount, 8, 'one truncated quarter replaced with 4 child queries');
  assert.equal(result.parcels.length, 7);

  let capped = 0;
  const unresolved = await collectTravisViewportTiles({
    bounds, limit:500,
    fetchTile: async () => { capped++; return tileResult([], true); },
  });
  assert.equal(unresolved.complete, false);
  assert.equal(unresolved.parcels.length, 0);
  assert.match(unresolved.reason, /truncated/);
  assert.ok(capped <= MAX_TRAVIS_VIEWPORT_TILE_QUERIES);
});

test('provider geometry conflicts and bounded total size must not produce misleading completeness', async () => {
  let calls = 0;
  const conflict = await collectTravisViewportTiles({
    bounds, limit:5, fetchTile: async () => tileResult([parcel('1', ++calls)]),
  });
  assert.equal(conflict.complete, false);
  assert.match(conflict.reason, /conflicting/);
  const exceeds = await collectTravisViewportTiles({
    bounds, limit:5, maxParcels:2,
    fetchTile: async (_tile) => tileResult([parcel(String(++calls))]),
  });
  assert.equal(exceeds.complete, false);
  assert.match(exceeds.reason, /capacity/);
  await assert.rejects(collectTravisViewportTiles({
    bounds, limit:0, fetchTile: async () => [] }),
  /Invalid bounded/);
  assert.equal(MAX_TRAVIS_VIEWPORT_PARCELS,1000);
});

test('cancellation halts subsequent GIS tile requests without returning a partial result', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    collectTravisViewportTiles({
      bounds, limit:500, signal:controller.signal,
      fetchTile:async()=>{calls++;controller.abort();return tileResult([parcel('1')]);},
    }),
    (error)=>error.name === 'AbortError',
  );
  assert.equal(calls,1);
});

test('malformed tile errors propagate as UNKNOWN, rather than a complete empty viewport', async () => {
  await assert.rejects(collectTravisViewportTiles({
    bounds,limit:500,fetchTile:async()=>{throw new Error('ArcGIS malformed');},
  }),/ArcGIS malformed/);
});

test('central discovery footprint occupies 25 percent of viewport area and never escapes real query bounds', () => {
  const focused = centerViewportBounds(bounds, 0.5);
  assert.equal(focused.west, bounds.west + (bounds.east - bounds.west) / 4);
  assert.equal(focused.east, bounds.east - (bounds.east - bounds.west) / 4);
  assert.equal(focused.south, bounds.south + (bounds.north - bounds.south) / 4);
  assert.equal(focused.north, bounds.north - (bounds.north - bounds.south) / 4);
  assert.throws(() => centerViewportBounds(bounds, 0));
  assert.throws(() => centerViewportBounds(bounds, 1));
  assert.throws(() => centerViewportBounds(null));
});
