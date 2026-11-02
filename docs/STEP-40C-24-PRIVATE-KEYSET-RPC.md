# Step 40C-24 — Unrouted, deny-by-default PostGIS keyset geometry RPC draft

## Latest operator checkpoint — November 2, 2026

The screenshot confirms `npm.cmd run build` succeeded in **4.40 seconds**, Vite 6.4.5, with **250 modules transformed**. The yellow warning about bundles exceeding 1,500 kB after minification remains nonfatal. The screenshot does **not** show outcomes for the Step 40C-23 targeted 12-test run or the focused `test:land` suite, so those results should not be claimed as passed based only on this screenshot.

## What changed

- `src/bdp/ingestion/sql/parcelGeometryKeysetRpcFoundation.sql` proposes a **fixed SECURITY DEFINER PostGIS function** named `bdp_parcel_index.parcel_geometry_keyset_rpc` with ten bound arguments, matching the previously staged Step 40C-23 signed-cursor planner. It retains the **complete Step 40C-18 source/run/geographic restrictions and independent caching + geometry redistribution-rights checks**, then adds an ordered, strictly-after cursor predicate on `source_parcel_id COLLATE "C"` and **numeric BIGINT** parcel-version ID. It uses the same capped `limit+1` probe and NULL geometry sentinel with per-feature budget guards. The SQL is **DBA-review-only**: it is not migrated, routed, imported into any live database, or connected to Cesium.
- In the same DDL transaction, all function EXECUTE privileges are explicitly **REVOKED FROM PUBLIC** and the existing `ldos_parcel_rpc_client` metadata-only role. **No grant** to any application account or geometry reader is created. A separate dedicated, least-privileged geometry-only database principal and ownership review are required. The SQL's security-definer owner cannot be the ordinary application login.
- `src/bdp/ingestion/parcelGeometryKeysetRpc.test.mjs` adds **nine** static contract tests. One asserts the **entire** SQL body exactly matches the Step 40C-18 snapshot SQL after removing only the new keyset condition, guarding against missing or regressed rights checks. Other tests cover the function name, ten args, key ordering, source and publication-rights guards, bounded WGS84/PostGIS geometry, overflow/null semantics, field allowlist, pinned search path, no dynamic SQL and no grants.

## Important limits

**A signed continuation token is NOT a database snapshot or authorization.** Even if this draft function passes disposable PostgreSQL testing, an actual service must still independently verify the current HMAC-backed session/county grants, source/run identity and immutability, the distinct legal geometry-publication review, usage quotas and active cancellation on **every** page and after every query. Any change in source geometry for a previously traversed run could cause omissions, repeats or stale pages unless ingestion versions are frozen and a consistent snapshot strategy is designed. Only private unpublished candidate geometry is contemplated: `viewportCoverage:'unknown'` remains the safe default. No county's bulk-copying or commercial GIS redistribution rights have been established by writing this function.

The existing API rejects arbitrary client cursor parameters. There is **no public geometry-delivery endpoint**, no automatic SQL migration, and no new feature toggles. The existing Cesium/God's Eye UI, 2.4 km discovery threshold, Travis parcel overlays and Property Intelligence panel are unchanged.

## Local checks

In the existing PowerShell window, each command separately:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelKeysetPagination.test.mjs
node --test src/bdp/ingestion/parcelGeometryKeysetRpc.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected: 12 Step 40C-23 tests and 9 new Step 40C-24 tests, each with **0 failures**, then a green focused land suite and build. The new SQL has **NOT been executed against PostgreSQL**; the next checkpoint must be an opt-in **disposable**, synthetic, private PostGIS privilege/ordering/overlap test. Never execute this migration on the persistent development or production database without formal review. The full inherited world-overlay performance suite remains a separate pre-release gate.
