# Step 40 — Scalable parcel delivery (incremental engineering plan)

**Status:** Phase 40A in-memory **measurement baseline** implemented; Phase 40B **rights-gated PostGIS index migration staged in source control but NOT applied**; Phase 40C-1 **pure request/coverage contract staged**; Phase 40C-2 **parameterized PostGIS metadata probe staged**; Phase 40C-3 **strict in-memory geometry and GeoJSON delivery budgets staged**; Phase 40C-4 **unrouted metadata-only server boundary staged**; Phase 40C-5 **pinned read-only PostGIS transaction adapter staged**; Phase 40C-6 **county-scoped authorization/source resolver staged**; Phase 40C-7 **fixed-query approved-source PostGIS reader staged**; Phase 40C-8 **HMAC-bound county-session verifier staged (all unexposed)**. Countywide ingestion, PostGIS streaming and public tile API **have NOT been built or enabled**. This document distinguishes completed work from planned work.

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

### 40B runtime defect correction — November 1, 2026 (RETEST PENDING)

The operator ran `node scripts/bdp/parcel-index-disposable-smoke.mjs --disposable-only` against an **isolated disposable PostGIS 17 / PostGIS 3.5 container**. The schema migration **applied successfully**, but the initial SQL smoke failed with `record "new" has no field "coverage_state"` while inserting a `parcel_versions` row. This was a **real runtime defect** that static contract tests did not detect. It was **not a failure of the Vite build or the user's commands**.

Cause: the shared `guard_source_write()` trigger referenced table-specific `NEW.coverage_state` and `NEW.source_version` in boolean `AND` conditions involving `TG_TABLE_NAME`. A PL/pgSQL trigger `NEW` record has only columns from its actual target table; the boolean expression did not safely guard against referencing a missing column. The function now branches on `TG_TABLE_NAME` first, and only then accesses the target table's fields. The SQL smoke now positively inserts into both `parcel_versions` and `coverage_windows` and explicitly rejects mismatched source versions and false completeness claims from partial runs. A static regression test protects against reintroducing this cross-table field access.

The updated SQL and tests are committed, but **the fixed SQL has not yet been rerun against the operator's Docker PostGIS instance**. The disposable test stops and removes its own temporary container. No source GIS data is imported, and the existing BDP/PostGIS volume is not touched. For retest:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelIndexFoundation.test.mjs
node scripts/bdp/parcel-index-disposable-smoke.mjs --disposable-only
```

Do **not** enable production data ingestion, geographic APIs, or claims of countywide coverage until the runtime smoke and other previously documented security/rights gates pass.

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

### 40C-3 Unrouted parcel geometry/payload guard (STAGED / UNIT-TESTED)

`src/bdp/ingestion/parcelGeometryDeliveryBudget.js` adds fail-closed, pure preflight checks for **hypothetical** PostGIS-backed map pages. It first validates the 40C-2 metadata probe, allowing at most the requested 1–200 features; the final `limit + 1` probe row is counted only as an explicit overflow signal, **never silently delivered**. A page that exceeds its feature or aggregate geometry limits is rejected whole, not clipped or mislabeled as complete.

Hard limits currently staged:
- 8,000 PostGIS geometry vertices **per displayed feature**;
- 60,000 geometry vertices **per page**;
- 512 KiB PostGIS geometry memory **per feature**;
- 4 MiB PostGIS geometry memory **per page**;
- 2 MiB actual serialized UTF-8 GeoJSON **per page**, checked separately (PostGIS in-memory geometry size is not network payload size).

The optional in-process GeoJSON inspection accepts only 2D WGS84 Polygon/MultiPolygon FeatureCollections with valid closed coordinate rings, strict feature IDs and one display-safe `sourceParcelId` property matching the tested metadata. Unexpected owner, address, financial and other attributes are rejected instead of copied. The number of geometry points must match trusted PostGIS-returned counts; this is structural validation, **not** a replacement for `ST_IsValid`, source integrity checks or a legal survey. It is also **not** a guarantee that a database geometry matches a source's recorded SHA-256; the future authenticated service must verify provenance when querying/encoding.

Every accepted result keeps `viewportCoverage: 'unknown'`, and the GeoJSON preflight explicitly returns `publishAuthorized: false`. Passing a budget does **not** grant a data right, access token, read permission or permission to expose a tile. A page over any budget requires an explicitly partial/unavailable result or a smaller permitted spatial request; truncation must not be hidden.

Ten geometry-budget targeted Node unit tests were run in an isolated Node 22 fixture using local copies of the 40C-1/40C-2 modules (**10/10 passing**); the previous 40C-2 tests also ran together (**17/17 total passing**). The user's latest screenshot also confirmed the prior production Vite build, but the complete suite/build **after 40C-3** has not yet been run or confirmed in the user's checkout. No Docker/PostGIS instance was reachable in the assistant's environment, so schema application, SQL execution and real GIS performance remain **untested**.

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelGeometryDeliveryBudget.test.mjs src/bdp/ingestion/parcelViewportReadPlan.test.mjs src/bdp/ingestion/parcelPageContract.test.mjs
npm.cmd test
npm.cmd run build
```

**Opt-in disposable PostGIS verification now staged (NOT RUN IN THIS ENVIRONMENT):** `scripts/bdp/parcel-index-disposable-smoke.mjs` creates a uniquely named `postgis/postgis:17-3.5` Docker container **without published ports, user-mounted/named volumes or network access** (the image may create an ephemeral anonymous volume removed with the container), loads only the staged index foundation into that container, runs the existing rollback-only schema smoke, then executes the **actual source-controlled 40C-2 SQL** with invented WGS84 test polygons. It checks the spatial match and verifies that revoked and expired source permissions immediately yield zero rows. The synthetic rows rollback, then the Docker container is stopped/removed. No real GIS records are retrieved or redistributed; the ordinary `bdp-postgis` container/database and persistent volume are not referenced or modified. The script requires `--disposable-only` and will refuse accidental execution. Only run this on a machine with Docker installed and enough disk to pull the test image. **The code and three opt-in-guard/generator tests were checked with Node 22 (3/3 passed); full Docker/PostGIS execution still needs an operator machine.**

```powershell
# Optional isolated database smoke (no existing BDP database or PostGIS volume is touched):
node scripts/bdp/parcel-index-disposable-smoke.mjs --disposable-only
```

**Integration gates remain:** execute the above disposable PostGIS smoke on an available Docker host and examine its results; secure county-specific provider data rights; implement verified server identity and least-privilege database reader; trusted server-side source/run selection, request concurrency/rate/time budgets, full geometry provenance, coverage evidence and overflow pagination. A synthetic SQL smoke result validates only this staged test schema/query, **not** a production deployment or legal data reuse. Nothing in 40C-3 is routed into the live Cesium Free Explorer, and its existing 2.4 km behavior is unchanged.


### 40C-4 Trusted metadata read boundary (STAGED / UNROUTED)

`server/providers/bdp-parcel-viewport-metadata.js` composes the strictly bounded 40C-1 request, 40C-2 PostGIS query statement and 40C-3 geometry-budget assessment as a **server-only, metadata-only** operation. This is a dependency-injected in-process contract, **not an HTTP endpoint or a live database adapter**. No source data is imported, no user roles are granted and no raw parcel feature or geometry is returned. Its only successful result contains a bounded parcel count, a boolean overflow indicator and explicitly **UNKNOWN** viewport coverage. An overflowing page is labelled `partial-page`, never evaluated or complete.

The new service requires a 32-byte canonical opaque session handle **separately from** the geographic request, and a trusted `resolveAuthorizedSource` callback. The callback is responsible for validating the actual server-side session and fresh per-county/source/run authorization. The service rejects unapproved, expired, mismatched, invalid-run and malformed decisions **before issuing a query**, builds parameterized SQL only after approval, and checks the trusted authorization **a second time after the query** before returning even aggregated counts. Rejected/aborted/invalid outcomes are generic, without leaking SQL, source IDs or session details. A local 1–16 active-request limit defaults to four; requests are rejected as busy rather than queued. A 100–5000 ms driver `statementTimeoutMs` requirement defaults to 2000 ms, but **the integration must implement the actual database timeout/cancellation itself**. Local concurrency limiting is **not** a distributed user rate limit.

`src/bdp/ingestion/parcelViewportMetadataService.test.mjs` has 10 tests, locally executed in a detached Node 22 fixture (10/10 passing) covering malformed requests, source/run authorization, revocation and run rotation, overflow, geometry budgets, cancellation, concurrency, and generic errors. This does **not** certify the full repository suite or real PostGIS runtime. Existing 2.4 km Free Explorer, Cesium visuals, existing parcel source calls and Property Intelligence panels are unchanged. The service is intentionally not exported to the browser or wired into the Node HTTP provider.

Remaining required before any real delivery: run the **optional isolated Docker/PostGIS synthetic smoke test** on a Docker-equipped machine, review commercial county caching/redistribution rights, create a separate least-privilege DB read role and trusted session/identity source, bind the service to that secure transport, ensure the DB client actually enforces query timeout and cancellation, add per-user distributed quotas, verify geometry/provenance against the source, supply non-sensitive bounded tiles, and implement explicit verified source-window coverage and pagination. **Do not treat these staged helpers as a deployed land-data pipeline.**

Local checkpoint in PowerShell (run each command separately):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelViewportMetadataService.test.mjs
npm.cmd test
npm.cmd run build
```

Optional runtime SQL check, only when Docker is installed/running, not on a production database:

```powershell
node scripts/bdp/parcel-index-disposable-smoke.mjs --disposable-only
```

### November 1, 2026 — Docker PostGIS retest PASSED (confirmed by operator)

Following the 40B PL/pgSQL trigger repair, the operator reran the five static schema checks (**5/5 passed**) and the disposable PostgreSQL 17 / PostGIS 3.5 test command. Its output ended exactly with:

```text
PASS: disposable PostGIS migration, rollback smoke, and runtime viewport probe.
```

The successful test confirms that **the migration applied in a temporary container**, the rollback-only schema smoke passed, and the source-controlled bounded PostGIS metadata probe returned the expected synthetic spatial match and enforced revoked/expired rights. It does **not** mean the schema was applied to the existing BDP database or that any commercial county data has been ingested, permissioned, or deployed. The previous "retest pending" section above is retained as the defect history; this is the resolution.

### 40C-5 Pinned read-only PostGIS transaction adapter (STAGED / UNROUTED)

`server/providers/bdp-parcel-postgis-read-adapter.js` is a driver-injected **server-only** adapter for the 40C-2 metadata SQL, intended for use *behind* the 40C-4 trusted metadata service. It is not installed as an HTTP route, and it does not acquire credentials or grant raw database table access.

This adapter accepts **only the exact source-controlled eight-parameter parcel metadata query** and revalidates the county, geographic viewport, source, run, and record cap before acquiring a connection. It requires an injected `connect()` returning an exclusive/pinned PostgreSQL client with `query()` and `release()`. Each accepted request runs inside `BEGIN TRANSACTION READ ONLY` with database-side `SET LOCAL statement_timeout`, `lock_timeout`, and idle-in-transaction timeout limits (configured SQL timeout 100–5000 ms); success commits and releases the client, while failed or cancelled requests attempt rollback and evict the client. Timeout SQL values are constrained integer literals, not unsanitized client input. It returns only raw *server-side* metadata rows to its trusted caller; the 40C-4 service is responsible for final result filtering and rechecking authorized source/run rights before returning bounded aggregate metadata.

Important limitations: **the adapter does not implement an authentic session resolver, database read role, deployed Node connection pool, distributed per-user rate limiting, cryptographic source attestation, HTTP routing or active in-flight cancellation**. `AbortSignal` is checked before/after database work, while actual SQL execution is bounded by PostgreSQL's statement timeout; do not assume instantaneous driver-side cancellation. Read-only transaction mode protects against writes through this adapter but cannot replace independently provisioned least-privilege DB permissions. No browser is allowed to pass SQL, credentials, roles, run/source IDs, or query plan. No new parcel data rights are inferred from the disposable smoke.

`src/bdp/ingestion/parcelPostgisReadAdapter.test.mjs` adds **nine** in-process adapter tests. They passed in an isolated Node 22 fixture (**9/9**); real `pg` driver integration and full repository regression/build remain unverified on the operator's computer. The existing 2.4 km Free Explorer and Cesium parcel overlays are unchanged.

To verify this staged change in PowerShell (one command per line):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPostgisReadAdapter.test.mjs
npm.cmd test
npm.cmd run build
```

Before deploying any server endpoint: security-review the trusted identity+county authorization path, create a least-privilege database access mechanism that cannot read unapproved/revoked records, test the actual driver under statement timeouts and connection aborts, add per-user/server cost caps, and review applicable county GIS caching/redistribution permissions. Preserve the God's Eye view and honest unknown coverage status.


### 40C-6 County-scoped session and source/run resolution (STAGED; NOT CONNECTED)

**Operator checkpoint, November 1:** The latest supplied Windows PowerShell screenshot shows **13/13 tests passed, 0 failures** and a **successful Vite production build in 4.36 seconds** (250 modules transformed). It still reports upstream bundles over 1.5 MB; those are nonfatal chunk-size warnings, not errors. This confirms the commands displayed, not a production deployment or any unshown live database test.

`server/providers/bdp-parcel-source-resolver.js` introduces a **server-only, un-routed** source/run resolver that can be injected into the existing 40C-4 metadata service. The resolver needs two independently trusted dependencies:

- `verifyCountySession({ sessionHandle, countyFips, signal })`: a future authoritative server-side session + per-county entitlement check, **not** a browser-provided role/boolean. An acceptable result must declare an active, MFA-verified, non-revoked subject with an explicit grant to the *exact requested Texas county*.
- `readApprovedSources({ text, values }, { signal, statementTimeoutMs })`: a future least-privilege PostGIS reader for the single, fixed `APPROVED_PARCEL_SOURCE_SQL` statement. It must support parameter binding and the requested database-side timeout; the resolver does not yet supply this driver.

The fixed SQL restricts the query to one exact Texas county, time-limited explicitly **approved** source rights, and a most-recent finished source ingest run with outcome `complete` or `partial`. The query returns a **maximum of two qualifying source rows** (not two parcel records): if more than one source qualifies, the resolver fails closed rather than silently choosing a provider. If there are none, if any source metadata is malformed, or if source approval expires, no index run is selected. Query results normalize native PostgreSQL `BIGINT` run IDs safely, reject malformed or unsafe values and never expose raw parcel geometries, owners or addresses.

The 40C-4 metadata service re-invokes this resolver after querying parcel metadata, denying even aggregate counts when a trusted session is revoked or source/run approval changes. This implements **contract-level trust separation**, NOT actual login/authentication, an entitlement database, an installed PostGIS reader role, credential provisioning or a browser route. No county dataset has been acquired or persisted as a consequence. A separate session authority and authorization database/transport design are still required, alongside per-user quotas and commercial provider-rights review. The current Cesium map, source providers, 2.4 km discovery, Property Intelligence and map UI remain unchanged.

`src/bdp/ingestion/parcelSourceResolver.test.mjs` adds **9 targeted unit tests** covering valid server-authorized lookup, malformed/noncanonical handles, denied/expired/wrong-county permissions, source ambiguity, PostgreSQL `BIGINT` handling, SQL safety and post-query revocation. These tests are staged in GitHub; **the full suite/build after this commit has not yet been confirmed by the operator**.

Local verification (PowerShell, one command per line):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSourceResolver.test.mjs
npm.cmd test
npm.cmd run build
```

**Next gate:** connect the resolver's fixed SQL to a pinned, least-privilege database reader in an isolated environment, verify genuine session/entitlement revocation, apply a source-rights review and make zero changes to Free Explorer rendering until authorization and real map payload/coverage are properly implemented.


### Step 40C-7 — Fixed SQL-approved source registry adapter (STAGED / UNROUTED)

**Operator's November 1, 2026 local checkpoint:** The operator supplied a PowerShell screenshot showing **13/13 tests passed, zero failures** and a **successful Vite build** transforming 250 modules in **4.24 seconds**. Bundles over 1.5 MB still generate nonfatal chunk warnings. This screenshot confirms the completed test/build command output, not production PostGIS deployment or full legal GIS source rights.

`server/providers/bdp-parcel-postgis-source-reader.js` supplies the missing, **server-only driver boundary** to execute the exact `APPROVED_PARCEL_SOURCE_SQL` from Step 40C-6. It takes only a strict `{text,values:[countyFips]}` fixed-query contract; caller SQL, source IDs, roles, credentials and unbounded county/window queries are rejected before connecting. The county must match `^48[0-9]{3}# Step 40 — Scalable parcel delivery (incremental engineering plan)

**Status:** Phase 40A in-memory **measurement baseline** implemented; Phase 40B **rights-gated PostGIS index migration staged in source control but NOT applied**; Phase 40C-1 **pure request/coverage contract staged**; Phase 40C-2 **parameterized PostGIS metadata probe staged**; Phase 40C-3 **strict in-memory geometry and GeoJSON delivery budgets staged**; Phase 40C-4 **unrouted metadata-only server boundary staged**; Phase 40C-5 **pinned read-only PostGIS transaction adapter staged**; Phase 40C-6 **county-scoped authorization/source resolver staged**; Phase 40C-7 **fixed-query approved-source PostGIS reader staged (all unexposed)**. Countywide ingestion, PostGIS streaming and public tile API **have NOT been built or enabled**. This document distinguishes completed work from planned work.

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

### 40B runtime defect correction — November 1, 2026 (RETEST PENDING)

The operator ran `node scripts/bdp/parcel-index-disposable-smoke.mjs --disposable-only` against an **isolated disposable PostGIS 17 / PostGIS 3.5 container**. The schema migration **applied successfully**, but the initial SQL smoke failed with `record "new" has no field "coverage_state"` while inserting a `parcel_versions` row. This was a **real runtime defect** that static contract tests did not detect. It was **not a failure of the Vite build or the user's commands**.

Cause: the shared `guard_source_write()` trigger referenced table-specific `NEW.coverage_state` and `NEW.source_version` in boolean `AND` conditions involving `TG_TABLE_NAME`. A PL/pgSQL trigger `NEW` record has only columns from its actual target table; the boolean expression did not safely guard against referencing a missing column. The function now branches on `TG_TABLE_NAME` first, and only then accesses the target table's fields. The SQL smoke now positively inserts into both `parcel_versions` and `coverage_windows` and explicitly rejects mismatched source versions and false completeness claims from partial runs. A static regression test protects against reintroducing this cross-table field access.

The updated SQL and tests are committed, but **the fixed SQL has not yet been rerun against the operator's Docker PostGIS instance**. The disposable test stops and removes its own temporary container. No source GIS data is imported, and the existing BDP/PostGIS volume is not touched. For retest:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelIndexFoundation.test.mjs
node scripts/bdp/parcel-index-disposable-smoke.mjs --disposable-only
```

Do **not** enable production data ingestion, geographic APIs, or claims of countywide coverage until the runtime smoke and other previously documented security/rights gates pass.

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

### 40C-3 Unrouted parcel geometry/payload guard (STAGED / UNIT-TESTED)

`src/bdp/ingestion/parcelGeometryDeliveryBudget.js` adds fail-closed, pure preflight checks for **hypothetical** PostGIS-backed map pages. It first validates the 40C-2 metadata probe, allowing at most the requested 1–200 features; the final `limit + 1` probe row is counted only as an explicit overflow signal, **never silently delivered**. A page that exceeds its feature or aggregate geometry limits is rejected whole, not clipped or mislabeled as complete.

Hard limits currently staged:
- 8,000 PostGIS geometry vertices **per displayed feature**;
- 60,000 geometry vertices **per page**;
- 512 KiB PostGIS geometry memory **per feature**;
- 4 MiB PostGIS geometry memory **per page**;
- 2 MiB actual serialized UTF-8 GeoJSON **per page**, checked separately (PostGIS in-memory geometry size is not network payload size).

The optional in-process GeoJSON inspection accepts only 2D WGS84 Polygon/MultiPolygon FeatureCollections with valid closed coordinate rings, strict feature IDs and one display-safe `sourceParcelId` property matching the tested metadata. Unexpected owner, address, financial and other attributes are rejected instead of copied. The number of geometry points must match trusted PostGIS-returned counts; this is structural validation, **not** a replacement for `ST_IsValid`, source integrity checks or a legal survey. It is also **not** a guarantee that a database geometry matches a source's recorded SHA-256; the future authenticated service must verify provenance when querying/encoding.

Every accepted result keeps `viewportCoverage: 'unknown'`, and the GeoJSON preflight explicitly returns `publishAuthorized: false`. Passing a budget does **not** grant a data right, access token, read permission or permission to expose a tile. A page over any budget requires an explicitly partial/unavailable result or a smaller permitted spatial request; truncation must not be hidden.

Ten geometry-budget targeted Node unit tests were run in an isolated Node 22 fixture using local copies of the 40C-1/40C-2 modules (**10/10 passing**); the previous 40C-2 tests also ran together (**17/17 total passing**). The user's latest screenshot also confirmed the prior production Vite build, but the complete suite/build **after 40C-3** has not yet been run or confirmed in the user's checkout. No Docker/PostGIS instance was reachable in the assistant's environment, so schema application, SQL execution and real GIS performance remain **untested**.

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelGeometryDeliveryBudget.test.mjs src/bdp/ingestion/parcelViewportReadPlan.test.mjs src/bdp/ingestion/parcelPageContract.test.mjs
npm.cmd test
npm.cmd run build
```

**Opt-in disposable PostGIS verification now staged (NOT RUN IN THIS ENVIRONMENT):** `scripts/bdp/parcel-index-disposable-smoke.mjs` creates a uniquely named `postgis/postgis:17-3.5` Docker container **without published ports, user-mounted/named volumes or network access** (the image may create an ephemeral anonymous volume removed with the container), loads only the staged index foundation into that container, runs the existing rollback-only schema smoke, then executes the **actual source-controlled 40C-2 SQL** with invented WGS84 test polygons. It checks the spatial match and verifies that revoked and expired source permissions immediately yield zero rows. The synthetic rows rollback, then the Docker container is stopped/removed. No real GIS records are retrieved or redistributed; the ordinary `bdp-postgis` container/database and persistent volume are not referenced or modified. The script requires `--disposable-only` and will refuse accidental execution. Only run this on a machine with Docker installed and enough disk to pull the test image. **The code and three opt-in-guard/generator tests were checked with Node 22 (3/3 passed); full Docker/PostGIS execution still needs an operator machine.**

```powershell
# Optional isolated database smoke (no existing BDP database or PostGIS volume is touched):
node scripts/bdp/parcel-index-disposable-smoke.mjs --disposable-only
```

**Integration gates remain:** execute the above disposable PostGIS smoke on an available Docker host and examine its results; secure county-specific provider data rights; implement verified server identity and least-privilege database reader; trusted server-side source/run selection, request concurrency/rate/time budgets, full geometry provenance, coverage evidence and overflow pagination. A synthetic SQL smoke result validates only this staged test schema/query, **not** a production deployment or legal data reuse. Nothing in 40C-3 is routed into the live Cesium Free Explorer, and its existing 2.4 km behavior is unchanged.


### 40C-4 Trusted metadata read boundary (STAGED / UNROUTED)

`server/providers/bdp-parcel-viewport-metadata.js` composes the strictly bounded 40C-1 request, 40C-2 PostGIS query statement and 40C-3 geometry-budget assessment as a **server-only, metadata-only** operation. This is a dependency-injected in-process contract, **not an HTTP endpoint or a live database adapter**. No source data is imported, no user roles are granted and no raw parcel feature or geometry is returned. Its only successful result contains a bounded parcel count, a boolean overflow indicator and explicitly **UNKNOWN** viewport coverage. An overflowing page is labelled `partial-page`, never evaluated or complete.

The new service requires a 32-byte canonical opaque session handle **separately from** the geographic request, and a trusted `resolveAuthorizedSource` callback. The callback is responsible for validating the actual server-side session and fresh per-county/source/run authorization. The service rejects unapproved, expired, mismatched, invalid-run and malformed decisions **before issuing a query**, builds parameterized SQL only after approval, and checks the trusted authorization **a second time after the query** before returning even aggregated counts. Rejected/aborted/invalid outcomes are generic, without leaking SQL, source IDs or session details. A local 1–16 active-request limit defaults to four; requests are rejected as busy rather than queued. A 100–5000 ms driver `statementTimeoutMs` requirement defaults to 2000 ms, but **the integration must implement the actual database timeout/cancellation itself**. Local concurrency limiting is **not** a distributed user rate limit.

`src/bdp/ingestion/parcelViewportMetadataService.test.mjs` has 10 tests, locally executed in a detached Node 22 fixture (10/10 passing) covering malformed requests, source/run authorization, revocation and run rotation, overflow, geometry budgets, cancellation, concurrency, and generic errors. This does **not** certify the full repository suite or real PostGIS runtime. Existing 2.4 km Free Explorer, Cesium visuals, existing parcel source calls and Property Intelligence panels are unchanged. The service is intentionally not exported to the browser or wired into the Node HTTP provider.

Remaining required before any real delivery: run the **optional isolated Docker/PostGIS synthetic smoke test** on a Docker-equipped machine, review commercial county caching/redistribution rights, create a separate least-privilege DB read role and trusted session/identity source, bind the service to that secure transport, ensure the DB client actually enforces query timeout and cancellation, add per-user distributed quotas, verify geometry/provenance against the source, supply non-sensitive bounded tiles, and implement explicit verified source-window coverage and pagination. **Do not treat these staged helpers as a deployed land-data pipeline.**

Local checkpoint in PowerShell (run each command separately):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelViewportMetadataService.test.mjs
npm.cmd test
npm.cmd run build
```

Optional runtime SQL check, only when Docker is installed/running, not on a production database:

```powershell
node scripts/bdp/parcel-index-disposable-smoke.mjs --disposable-only
```

### November 1, 2026 — Docker PostGIS retest PASSED (confirmed by operator)

Following the 40B PL/pgSQL trigger repair, the operator reran the five static schema checks (**5/5 passed**) and the disposable PostgreSQL 17 / PostGIS 3.5 test command. Its output ended exactly with:

```text
PASS: disposable PostGIS migration, rollback smoke, and runtime viewport probe.
```

The successful test confirms that **the migration applied in a temporary container**, the rollback-only schema smoke passed, and the source-controlled bounded PostGIS metadata probe returned the expected synthetic spatial match and enforced revoked/expired rights. It does **not** mean the schema was applied to the existing BDP database or that any commercial county data has been ingested, permissioned, or deployed. The previous "retest pending" section above is retained as the defect history; this is the resolution.

### 40C-5 Pinned read-only PostGIS transaction adapter (STAGED / UNROUTED)

`server/providers/bdp-parcel-postgis-read-adapter.js` is a driver-injected **server-only** adapter for the 40C-2 metadata SQL, intended for use *behind* the 40C-4 trusted metadata service. It is not installed as an HTTP route, and it does not acquire credentials or grant raw database table access.

This adapter accepts **only the exact source-controlled eight-parameter parcel metadata query** and revalidates the county, geographic viewport, source, run, and record cap before acquiring a connection. It requires an injected `connect()` returning an exclusive/pinned PostgreSQL client with `query()` and `release()`. Each accepted request runs inside `BEGIN TRANSACTION READ ONLY` with database-side `SET LOCAL statement_timeout`, `lock_timeout`, and idle-in-transaction timeout limits (configured SQL timeout 100–5000 ms); success commits and releases the client, while failed or cancelled requests attempt rollback and evict the client. Timeout SQL values are constrained integer literals, not unsanitized client input. It returns only raw *server-side* metadata rows to its trusted caller; the 40C-4 service is responsible for final result filtering and rechecking authorized source/run rights before returning bounded aggregate metadata.

Important limitations: **the adapter does not implement an authentic session resolver, database read role, deployed Node connection pool, distributed per-user rate limiting, cryptographic source attestation, HTTP routing or active in-flight cancellation**. `AbortSignal` is checked before/after database work, while actual SQL execution is bounded by PostgreSQL's statement timeout; do not assume instantaneous driver-side cancellation. Read-only transaction mode protects against writes through this adapter but cannot replace independently provisioned least-privilege DB permissions. No browser is allowed to pass SQL, credentials, roles, run/source IDs, or query plan. No new parcel data rights are inferred from the disposable smoke.

`src/bdp/ingestion/parcelPostgisReadAdapter.test.mjs` adds **nine** in-process adapter tests. They passed in an isolated Node 22 fixture (**9/9**); real `pg` driver integration and full repository regression/build remain unverified on the operator's computer. The existing 2.4 km Free Explorer and Cesium parcel overlays are unchanged.

To verify this staged change in PowerShell (one command per line):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPostgisReadAdapter.test.mjs
npm.cmd test
npm.cmd run build
```

Before deploying any server endpoint: security-review the trusted identity+county authorization path, create a least-privilege database access mechanism that cannot read unapproved/revoked records, test the actual driver under statement timeouts and connection aborts, add per-user/server cost caps, and review applicable county GIS caching/redistribution permissions. Preserve the God's Eye view and honest unknown coverage status.


### 40C-6 County-scoped session and source/run resolution (STAGED; NOT CONNECTED)

**Operator checkpoint, November 1:** The latest supplied Windows PowerShell screenshot shows **13/13 tests passed, 0 failures** and a **successful Vite production build in 4.36 seconds** (250 modules transformed). It still reports upstream bundles over 1.5 MB; those are nonfatal chunk-size warnings, not errors. This confirms the commands displayed, not a production deployment or any unshown live database test.

`server/providers/bdp-parcel-source-resolver.js` introduces a **server-only, un-routed** source/run resolver that can be injected into the existing 40C-4 metadata service. The resolver needs two independently trusted dependencies:

- `verifyCountySession({ sessionHandle, countyFips, signal })`: a future authoritative server-side session + per-county entitlement check, **not** a browser-provided role/boolean. An acceptable result must declare an active, MFA-verified, non-revoked subject with an explicit grant to the *exact requested Texas county*.
- `readApprovedSources({ text, values }, { signal, statementTimeoutMs })`: a future least-privilege PostGIS reader for the single, fixed `APPROVED_PARCEL_SOURCE_SQL` statement. It must support parameter binding and the requested database-side timeout; the resolver does not yet supply this driver.

The fixed SQL restricts the query to one exact Texas county, time-limited explicitly **approved** source rights, and a most-recent finished source ingest run with outcome `complete` or `partial`. The query returns a **maximum of two qualifying source rows** (not two parcel records): if more than one source qualifies, the resolver fails closed rather than silently choosing a provider. If there are none, if any source metadata is malformed, or if source approval expires, no index run is selected. Query results normalize native PostgreSQL `BIGINT` run IDs safely, reject malformed or unsafe values and never expose raw parcel geometries, owners or addresses.

The 40C-4 metadata service re-invokes this resolver after querying parcel metadata, denying even aggregate counts when a trusted session is revoked or source/run approval changes. This implements **contract-level trust separation**, NOT actual login/authentication, an entitlement database, an installed PostGIS reader role, credential provisioning or a browser route. No county dataset has been acquired or persisted as a consequence. A separate session authority and authorization database/transport design are still required, alongside per-user quotas and commercial provider-rights review. The current Cesium map, source providers, 2.4 km discovery, Property Intelligence and map UI remain unchanged.

`src/bdp/ingestion/parcelSourceResolver.test.mjs` adds **9 targeted unit tests** covering valid server-authorized lookup, malformed/noncanonical handles, denied/expired/wrong-county permissions, source ambiguity, PostgreSQL `BIGINT` handling, SQL safety and post-query revocation. These tests are staged in GitHub; **the full suite/build after this commit has not yet been confirmed by the operator**.

Local verification (PowerShell, one command per line):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSourceResolver.test.mjs
npm.cmd test
npm.cmd run build
```

**Next gate:** connect the resolver's fixed SQL to a pinned, least-privilege database reader in an isolated environment, verify genuine session/entitlement revocation, apply a source-rights review and make zero changes to Free Explorer rendering until authorization and real map payload/coverage are properly implemented.

. A trusted, injected pinned PostgreSQL client executes a `READ ONLY` transaction with `SET LOCAL` PostgreSQL statement (100–5000 ms), lock and idle-in-transaction timeouts. On error or detected abort, it attempts `ROLLBACK` and evicts the connection; the driver must separately enforce bounded **pool acquisition** and active cancellation if needed. This is not authentication, grants, a connection pool or an HTTP service.

The existing `createAuthorizedParcelSourceResolver` can now be combined with this reader and the Step 40C-5 viewport adapter behind the Step 40C-4 metadata-only service, **provided** a genuinely verified active user/session and per-county authorization check is injected. No parcel geometry, owner/address or source parcel IDs are returned to a browser by this staged composition; the aggregate viewport response remains `unknown` for evaluated coverage. Distinct count and overflow information is **not** proof that a user's full viewport or site was assessed.

`src/bdp/ingestion/parcelPostgisSourceReader.test.mjs` adds **10 targeted tests** for exact SQL/parameter checks, read-only transactions, generic rejection, timeout and abort cases, fail-closed rollback, and full mocked composition with post-query revocation. The existing disposable Docker smoke runner is also extended with a separate transaction-rollback **source-registry SQL** smoke that tests source ambiguity, revocation, expiry and county isolation with invented records. The extra smoke uses the exact source-controlled SQL and never copies external GIS data or touches the persistent BDP database.

**Verification status:** Files are committed; the new Step 40C-7 tests, full regression/build and newly extended disposable smoke **have not yet been reported by the operator**. Earlier disposable PostGIS viewport smoke and prior validation passed before this extension; do not attribute that success to the new source SQL test.

Run in PowerShell from the existing project folder, one command at a time:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPostgisSourceReader.test.mjs src/bdp/ingestion/parcelDisposableSmoke.test.mjs
npm.cmd test
npm.cmd run build
node scripts/bdp/parcel-index-disposable-smoke.mjs --disposable-only
```

The last command requires Docker Desktop and runs a **fresh, isolated, automatically removed** disposable PostGIS container. A successful run must end with `PASS: disposable PostGIS migration, rollback smoke, viewport probe and source resolver SQL.`. If it fails, do not proceed to integration or production: capture the first SQL error and correct it. Do not run migrations against the existing or production PostgreSQL database.

**Deployment gates remain:** evidence of rights to cache/redistribute each county GIS source; an actual trusted identity/session issuer and per-county entitlement store; a separate minimally privileged database login, pool limits and database-side permissions; real Node PostgreSQL driver integration with cancellation tests; distributed quotas and query budgets; properly attributed polygon geometry delivery and explicit source-window coverage. The inherited God’s Eye/Cesium map, 2.4 km Free Explorer discovery threshold, parcel borders and Property Intelligence UI remain unchanged.


### Step 40C-8 — Opaque county-session verification (STAGED / UNROUTED)

**Operator checkpoint:** The November 1, 2026 screenshot confirms the Step 40C-7 **production Vite build succeeded** (250 modules, 4.30 seconds) and an isolated Docker/PostGIS test ended with:
`PASS: disposable PostGIS migration, rollback smoke, viewport probe and source resolver SQL.` This demonstrates live PostGIS execution of the synthetic source registry permissions, ambiguity and geography test; it does not show any real licensed county GIS replication, production data, or deployed API. The yellow large-chunk warning is nonfatal.

`server/providers/bdp-parcel-county-session.js` now stages a server-only `createTrustedParcelCountySessionVerifier` that can be provided as `verifyCountySession` to Step 40C-6. It requires a **separate 32+ byte secret key** and a trusted `findSessionByDigest` authority. It computes HMAC-SHA-256 of a canonical 32-byte URL-safe opaque session handle; the store must use the digest (never the raw cookie) as its lookup key and return a current authoritative record. It then verifies matching stored digest using constant-time comparison, active account status, verified MFA, no revocation, issued/last-seen/expiration timestamps (8-hour maximum total lifetime and 30-minute maximum idle time), an exact Texas county grant (`48xxx`), no duplicate county grants or wildcards, and positive `allowParcelDiscovery: true` for the requested county. It never trusts browser-provided role/status/grant claims; caller may only pass the opaque handle and county FIPS through a trusted server integration. The result contains only the minimal server-authorized proof expected by the resolver.

`src/bdp/ingestion/parcelCountySession.test.mjs` includes **11 targeted tests** for canonical handles, HMAC key mismatch, expired/revoked/idle accounts, MFA, county-scoped grants, malformed grants, query-side cancellation, session rechecking, and an unexposed end-to-end metadata service scenario where mid-request revocation denies even aggregate counts. These tests are committed; **they have not yet been run in the operator's checkout**. No login, token issuance, cookie transport, session database, data redistribution permission, database login role, HTTP route or production service is introduced by this stage. The existing 2.4 km Cesium Free Explorer and Property Intelligence UI remain unchanged.

**Critical integration requirements:** Design the actual identity/session issuer and secure HttpOnly, Secure, SameSite cookie transport; keep the independent HMAC key server-only and outside Git; ensure the session lookup checks revocation and county entitlements against a *strongly current authoritative store* (not an eventually consistent cache); add explicit lifecycle/rotation/logout and per-account rate limits; create/test a restricted PostGIS service login whose privileges cannot expose unapproved raw geometry; and audit commercial use and caching rights county-by-county. These are prerequisites before enabling public server parcel discovery. Do not forward browser headers as session proof or treat the presence of this verifier as a deployed authentication system.

Local verification from the existing PowerShell project folder, each on a separate line:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelCountySession.test.mjs
npm.cmd test
npm.cmd run build
```

**Next planned stage:** Verify the restricted database role and fixed-query reader against synthetic records under a non-owner credential; keep public HTTP and polygon delivery disabled until rights, identity and payload/coverage checks pass.

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
