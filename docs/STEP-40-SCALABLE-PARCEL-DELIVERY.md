# Step 40 — Scalable parcel delivery (incremental engineering plan)

**Status:** Phase 40A in-memory **measurement baseline** implemented; Phase 40B **rights-gated PostGIS index migration staged in source control but NOT applied**; Phase 40C-1 **pure request/coverage contract staged**; Phase 40C-2 **parameterized PostGIS metadata probe staged (both unexposed)**. Countywide ingestion, PostGIS streaming and public tile API **have NOT been built or enabled**. This document distinguishes completed work from planned work.

## Product baseline accepted October 31, 2026

The Texas Free Explorer uses the inherited Cesium/God's Eye map; users have verified 2.4 km discovery, progressively accumulated Travis County source windows, exact CAD parcel lookup, source-only filters, clean orange perimeter union, and a separate Property Intelligence card. A county source window may be complete while the visible viewport remains **PARTIAL**. Raw county GIS geometries are neither legal surveys nor for-sale inventory. City use, access, financing, acreage currency, zoning and ownership/title cannot be inferred from an unverified county map.

Current implementation: `src/bdp/parcels/bexarParcelLayer.js` recreates the entire GeoJSON datasource when its viewport snapshot changes; `src/bdp/parcels/progressiveParcelCache.js` retains six source window snapshots for two minutes, never more than 1,000 identified parcels in a viewport; `src/bdp/cad/travisAdapter.js` makes bounded ArcGIS source calls and limited child requests. Do not call this full incremental vector tile streaming.

## 40A — Observe before optimizing (IMPLEMENTED, local QA required)

`src/bdp/map/parcelDiscoveryMetrics.js` exposes **in-memory, aggregate-only** duration/source-request/cached-window/parcel/geometry-entity metrics with a 32-sample history. **No address, parcel ID, owner name, coordinates, user preferences, or request URL is recorded in this diagnostic**; no event beacon or database write occurs. A successful direct Travis GIS query reports exactly one actual source call; capped retries count actual focal and tile requests. Direct cache hits report zero calls. Other county adapters and thrown/aborted provider requests without verified counts are **UNKNOWN**, not assigned imaginary network call totals. Repeated zoom and pan operations accumulate aggregate request outcomes; stale, capped and error states are tracked separately.

The shared parcel layer exposes `getStats().discoveryMetrics` for code-level QA: `runs`, `successes`, `capped`, `failures`, `cancellations`, `cacheHits`, `knownSourceRequests`, `unknownRequestRuns`, `p50DurationMs`, `p95DurationMs`, and the last bounded diagnostic. Duration measures the **entire source-fetch + Cesium GeoJSON transform + replacement** path, not a clean provider-only latency. `entityCount` reflects actual current datasource entities when available; it is NOT identical to the number of parcel records. `sourceFootprints` counts actual source-queried windows only. Percentiles are rolling diagnostic values, not a production benchmark until measured under realistic interactions.

**Acceptance:** Run the 2.4 km same-neighborhood route, then pan five neighboring screens and return to earlier screens; compare query counts, cache hits and latency under a consistent device/provider condition. Keep the user-visible map and acquisition state unchanged. The metrics must not certify coverage, suitability, real-time provider currency or user identity. No automatic upload or tracking is enabled.

## 40B — Source rights and durable PostGIS index (SCHEMA STAGED, NOT DEPLOYED)

Before copying or redistributing any parcel dataset, review the relevant official county GIS/provider license, access limitations, source attribution, caching policy, rate limits, republishing rights and currency/refresh obligations. Do not assume a publicly accessible ArcGIS REST endpoint grants commercial bulk replication permission. Ingest only permitted data.

A **manual, unexecuted migration** is now staged at `src/bdp/ingestion/sql/parcelIndexFoundation.sql`. It creates the restricted `bdp_parcel_index` schema with four source-governed spatial tables and GiST indexes, but **does not run automatically**, collect county records, create an authentication role, expose an API, or alter the existing Cesium map. `src/bdp/ingestion/sql/parcelIndexFoundationSmoke.sql` is a rollback-only manual database smoke test, and `src/bdp/ingestion/parcelIndexFoundation.test.mjs` runs static design/permission contract checks. The SQL has **not** been run against live Postgres/PostGIS or a disposable database in this assistant environment, so its runtime correctness is **not yet verified**.

The registry defaults to `unreviewed`; GIS data writes are guarded by a time-limited approved rights record and checked for source, county and ingestion-run consistency. Coverage states remain `unknown` unless actual provider evidence supports completeness, including no omitted IDs and no truncated response. No ordinary end-user or existing evidence-reader roles are given table access. **The database owner remains privileged, and rights approval is a human/legal governance decision; the guard is not a substitute for contracts, a least-privilege service account or production auth.** Existing snapshots must be denied at read time if approval is later revoked or expires; the future read API is responsible for this. Follow the provider terms before authorizing copying, retention, serving or resale.

Logical tables now staged (not deployed):
- `source_registry`: exact Texas FIPS, source URL, attribution, explicit time-limited rights review and state;
- `ingest_runs`: source/version, result state, provider request count, observed geometry envelope and truncation/missing-ID indicators;
- `parcel_versions`: county + exact source parcel ID + source version, WGS84 multipolygon, SHA-256 geometry evidence and source timestamps;
- `coverage_windows`: exactly known source query footprint, source/ingest-run linkage and explicit `unknown/partial/complete/unavailable` source-coverage state.

Require explicit `ST_IsValid`/SRID checks, source-ID deduplication and controlled geometry comparison. Never silently infer legal parcel validity, sale status, source currency or countywide completeness. Keep existing session-scoped PostgreSQL role, pinned connection and RLS safeguards; do not introduce browser-supplied DB roles or row-level permissions by cosmetic UI attributes.

## 40C — Bounded server map pages / tiles (40C-1 REQUEST CONTRACT STAGED / NO API)

A future server endpoint should accept **bounded WGS84 viewport / stable tile coordinates**, enforce supported county and per-user permissions, serve at most a fixed number of source features per page, cancel stale requests, and carry an explicit coverage state per tile: `complete`, `partial`, `unavailable`, `unknown`. Unknown-source IDs, truncated provider pages, out-of-date snapshots, retracted geometries, ambiguous duplicate source IDs or missing polygons cannot be labeled `complete`. For overflow, return a continuation cursor or per-tile `partial` result, not a quietly chopped list.

Prefer server-side `ST_Intersects` with GiST index, prepared static vector tiles and payload/geometry simplification controls **only for map display**, never for official parcel descriptions or legal acreage. When accessible, use versioned source evidence for the property card instead of deriving legal conclusions from tiles.

### 40C-1 pure request contract (IMPLEMENTED AS UNROUTED CODE; NOT IN PRODUCTION)

`src/bdp/ingestion/parcelPageContract.js` introduces strict, in-process planning helpers, **not** a live endpoint or database service. Only exact Texas county FIPS, WGS84 bounding boxes narrower than 0.12 degrees in each axis, and 1–200 requested features are accepted. A one-feature overflow probe avoids silently presenting truncated results as complete. Caller-supplied source IDs, auth/roles, coverage claims, SQL and unfinished pagination cursors are rejected. A **server-only preflight** checks a matching source with rights explicitly approved through a trusted database record and not yet expired. Coverage classification remains `unknown` unless count, source ID completeness, non-truncation and overflow evidence are explicit. A page overflow is `partial` and MUST NOT imply that the rest of the viewport was surveyed.

Tests: `node --test src/bdp/ingestion/parcelPageContract.test.mjs` (six targeted checks, also auto-discovered by `npm.cmd test`). These pure helpers were run against Node 22 in a detached check (6/6 passed); full repository test/build and deployment have NOT been verified by this change.

**Critical integration gate:** Do not wire this into `server/providers/local.js`, the public HTTP listener or the Cesium viewer until a real trusted session/auth policy, least-privilege DB read role, SQL-level rights filtering at **read time** (including revoked/expired source rights), county-supported source resolution, per-user rate limits, geometry/payload budgets, stable signed cursor or explicit partial tiles, and a tested PostGIS instance are present. This module contains no secure session proof and cannot grant access. The current browser makes **zero requests** to the planned endpoint.

### 40C-2 PostGIS viewport metadata probe (STAGED; NOT CONNECTED OR DB-TESTED)

`src/bdp/ingestion/parcelViewportReadPlan.js` implements a read-only, static, **eight-parameter** PostgreSQL/PostGIS *query description*, not an executable public service. It revalidates the 40C-1 request and takes a trusted source ID and a trusted finished ingestion-run ID from a future server-side policy/registry resolver. It restricts county/source/run/version to one matching indexed snapshot, filters *at read time* for `rights_state = 'approved'` and `approved_caching_until > clock_timestamp()`, and uses `ST_Intersects` / `&&` on the source geometry to select only nearby parcel **metadata**. The one-row overflow probe is capped at 201. Stable ordering is by source parcel ID and version-row ID. Unfinished and failed runs cannot be used for this probe.

The new query deliberately **does not serialize parcel polygons or expose a browser endpoint**. It measures geometry vertex count and in-memory size for a later geometry-byte budget. `summarizeParcelViewportProbe` validates bounded, unique results and can report overflow, but returns `viewportCoverage: 'unknown'` even for empty/nonoverflow results: a valid data subset is **not** proof that an entire viewport, county or development site has been fully researched.

Targeted tests at `src/bdp/ingestion/parcelViewportReadPlan.test.mjs` exercise parameterization, trusted run/source requirements, spatial constraints, fail-closed row checks and non-inference of coverage. A detached Node 22 unit check ran this module together with 40C-1 checks (13/13 passed). These are **mock/pure unit checks**, not a live PostGIS query, grant review, full repository test suite, production build or a runtime benchmark. No geographic data or source rights were modified.

**Next before server activation:** obtain explicit county/provider caching and redistribution rights; run the staged migration plus transaction-rollback smoke against a disposable PostGIS database after DBA review; test this query against synthetic permitted geometry; implement authentic server session resolution, least-privilege DB reader and SQL-level rights checks for *all* geometry/coverage queries; server-side run selection, per-user rate limits and execution timeout; cap emitted geometry bytes/vertices; provenance and source-window coverage; add a safe pagination strategy. Until these gates pass, **do not route this code or change the existing 2.4 km Cesium Free Explorer**.

Local read-only regression commands (PowerShell from the repo root):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPageContract.test.mjs src/bdp/ingestion/parcelViewportReadPlan.test.mjs
node --test src/bdp/ingestion/parcelIndexFoundation.test.mjs
npm.cmd test
npm.cmd run build
```

## 40D — Incremental Cesium rendering (DESIGN / NOT STARTED)

Replace entire `GeoJsonDataSource` swaps with keyed incremental additions/removals using `county_fips:source_parcel_id:version`. Retain selected parcel and card even when a viewport tile is evicted; selected source geometry must remain explainable. Bound geometry/entity count and tile/decoded memory. Prioritize visible tiles and coalesce camera movement; abort obsolete network requests before changing current geometry; preserve exact source polygon geometry for selected parcels. Clear all external tiles in free-view when zoomed above 2.4 km except explicitly focused parcel. Never infer that a tile is empty because a provider call failed.

## 40E — Operator acceptance criteria

1. No regressions to existing 2.4 km discovery, selected parcel highlight, property intelligence, provenance/UNKNOWN warning, free-browse county detection, acquisition board, and original upstream Cesium/God's Eye credits.
2. Pan/return demo with visible clean perimeter boundaries and truthful partial coverage.
3. Compare `p50DurationMs`, `p95DurationMs`, `knownSourceRequests`, `cacheHits` and `entityCount` from the same bounded route before and after streaming; state measurement conditions and do not assert unmeasured speed-ups.
4. Provider HTTP errors, transfer limits, expiry, data-ID collision, cross-county source features and user cancellation fail closed.
5. Server index and API may launch only after provenance, provider rights, authorization and hard-load/cost caps have been reviewed.

## Local test instructions for 40A

Use the established `bdp-development` branch. In PowerShell Window 1 (repo directory):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/map/parcelDiscoveryMetrics.test.mjs src/bdp/cad/travisAdapter.test.mjs src/bdp/parcels/focusedLookup.test.mjs
npm.cmd test
npm.cmd run build
```

Stop/restart `npm.cmd run dev` in PowerShell Window 2, then refresh Chrome. Confirm the parcel map, card and source list work exactly as before; the first milestone changes only local diagnostics and source-call count provenance, **not** the customer-facing UI. Future user-visible performance dashboards should be optional and not overlaid on the map by default.


### 40B safety/testing checkpoint

The user reported **13/13 passing tests** for a local run after the Step 40A test fix; this is encouraging, but it does not by itself establish a full `npm.cmd test` plus production build pass. Before any DB application, review the staged SQL with a database administrator and verify county-specific commercial GIS caching/redistribution rights. The SQL contract test is safe to run without PostgreSQL:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelIndexFoundation.test.mjs
npm.cmd test
npm.cmd run build
```

Only when a qualified operator has a **disposable test PostGIS database** and has approved the schema should they separately apply the migration and rollback smoke; no instruction here authorizes running this against production or storing official GIS data. Front-end behavior is unchanged, as are the 2.4 km Free Explorer threshold, data-source limits, clean search perimeters and current security/parcel RLS.
