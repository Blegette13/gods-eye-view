# Step 40 — Scalable parcel delivery (incremental engineering plan)

**Status:** Phase 40A in-memory **measurement baseline** implemented; Phase 40B **rights-gated PostGIS index migration staged in source control but NOT applied**; Phase 40C-1 **pure request/coverage contract staged**; Phase 40C-2 **parameterized PostGIS metadata probe staged**; Phase 40C-3 **strict in-memory geometry and GeoJSON delivery budgets staged**; Phase 40C-4 **unrouted metadata-only server boundary staged**; Phase 40C-5 **pinned read-only PostGIS transaction adapter staged**; Phase 40C-6 **county-scoped authorization/source resolver staged**; Phase 40C-7 **fixed-query approved-source PostGIS reader staged**; Phase 40C-8 **HMAC-bound county-session verifier staged**; Phase 40C-9 **isolated restricted PostGIS RPC verified against synthetic data**; Phase 40C-10 **restricted reader bridge staged and regression-tested**; Phase 40C-11 **unrouted HMAC→restricted RPC metadata runtime composition validated by operator tests**; Phase 40C-12 **unrouted pg Pool connector locally regression-tested**; Phase 40C-13 **isolated real pg-driver smoke PASSED (operator confirmed)**; Phase 40C-14 **unmounted origin/quota-gated metadata HTTP transport staged (not deployed)**. Phase 40C-15 **unpublished geometry candidate with separate redistribution-rights gate staged (not delivered)**. Phase 40C-16 **unrouted fixed single-snapshot PostGIS geometry plan + deny-default publication registry validated by local land suite but not executed in PostGIS**; Phase 40C-17 **disposable REAL PostGIS geometry rights/snapshot probe PASSED (operator confirmed)**; Phase 40C-18 **fixed no-grant SECURITY DEFINER geometry RPC passed local source-contract validation (not deployed)**; Phase 40C-19 **disposable real-PostGIS geometry RPC privilege tests PASSED (operator confirmed)**; Phase 40C-20 **unrouted geometry-only RPC reader passed focused operator regression**; Phase 40C-21 **private unrouted geometry composition locally validated**; Phase 40C-22 **exact source-window coverage evidence locally validated**; Phase 40C-23/24 **signed private keyset cursor + DBA-only RPC staged**; Phase 40C-25 **real disposable PostGIS keyset paging smoke PASSED (operator confirmed November 2)**; Phase 40C-26/27 **immutable run seal and real disposable SQL smoke PASSED**; Phase 40C-28 **concurrent writer/sealer lock-order PostGIS smoke PASSED**; Phase 40C-29 **sealed-run keyset RPC real PostGIS smoke PASSED (operator confirmed November 2)**; Phase 40C-30 **seal-enforced initial-page RPC + rights-revocation disposable PostGIS smoke PASSED (operator confirmed November 2)**; Phase 40C-31 **strict private sealed-page validator 13/13 operator Node tests PASSED**; Phase 40C-32 **private sealed geometry read composition 13/13 focused tests PASSED**. Phase 40C-33 **trusted private sealed-geometry runtime 15/15 focused tests PASSED**. Phase 40C-34 **no-grant sealed-source RPC and private adapter: 22/22 focused, 774/774 land tests, production build and disposable REAL PostGIS smoke PASSED (operator-confirmed)**. Phase 40C-35 **unrouted, pinned source-authority-only LOGIN attestation plus 20 synthetic and disposable-guard tests STAGED (operator validation pending)**. Countywide ingestion, PostGIS streaming and public tile API **have NOT been built or enabled**. This document distinguishes completed work from planned work.

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


### Step 40C-9 SQL syntax failure after startup gate passed — correction committed, runtime retest pending

The operator's follow-up November 1 Docker run confirms **8/8 Node unit tests passed** and that the disposable PostGIS image finished initialization without the previous extension-install race. The schema base migration then completed, but restricted RPC creation failed on **line 19 of `approved_sources_rpc`**, reporting `syntax error at or near "FROM"` in `pg_catalog.extract(epoch FROM sr.approved_caching_until)`. The problem is real SQL syntax: PostgreSQL's `EXTRACT(EPOCH FROM ...)` is special grammar and must not be called as a schema-qualified regular function. The SQL has now been updated to `FLOOR(EXTRACT(EPOCH FROM sr.approved_caching_until) * 1000)::double precision`, retaining the same millisecond-conversion behavior, with an explicit targeted static regression test preventing `pg_catalog.extract(...)` from returning.

**The restricted RPC is not yet validated.** Only the base schema and PostGIS startup succeeded in the failing run. The new correction has not yet passed the operator's Docker runtime check, and no changes were made to the existing BDP database, live parcel map, or public endpoints. Before advancing, rerun in PowerShell, one line at a time:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelRestrictedRpc.test.mjs src/bdp/ingestion/parcelRestrictedRpcRunner.test.mjs
node scripts/bdp/parcel-rpc-disposable-smoke.mjs --disposable-only
```

If any further SQL error occurs, preserve the first `ERROR` and do not declare the checkpoint complete until **both fixed RPCs and the restricted-role fixture execute**.

### November 1 — PostGIS init-race root cause identified; retest pending

The diagnostic-enabled disposable Docker run returned **7/7 passing local unit tests** followed by a failed container with `status=exited exit=3 oom=false`. Crucially, its PostgreSQL startup log shows the image's `/docker-entrypoint-initdb.d/10_postgis.sh` was **still installing PostGIS into the default `postgres` database** when a concurrent `CREATE EXTENSION IF NOT EXISTS postgis` appeared; PostgreSQL reported a duplicate `pg_extension_name_index` key. The likely root cause is our smoke runner's readiness race: `pg_isready` can succeed against PostgreSQL's temporary **initialization** server, before the image has finished its extension installation. The runner attempted SQL too early. This is an initialization collision in a disposable test harness, **not evidence of a GIS schema failure or corrupted BDP project database**.

Both `scripts/bdp/parcel-rpc-disposable-smoke.mjs` and `scripts/bdp/parcel-index-disposable-smoke.mjs` now require the official PostgreSQL entrypoint completion marker `PostgreSQL init process complete; ready for start up.` **before** checking `pg_isready` or executing any SQL. The redundant `CREATE EXTENSION IF NOT EXISTS postgis` call was replaced by an extension-version verification query after startup. The restricted role runner still preserves startup diagnostics and removes the isolated test container/anonymous volumes. No production service or PostgreSQL role was changed.

**Validation remains open:** The new startup synchronization is committed, but not yet run on the operator's Docker host. Repeat only the isolated runner from the project root:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelRestrictedRpc.test.mjs src/bdp/ingestion/parcelRestrictedRpcRunner.test.mjs
node scripts/bdp/parcel-rpc-disposable-smoke.mjs --disposable-only
```

If the next run reports a SQL error, diagnose that **separately**; do not assume the role design is validated merely because container startup succeeds. The `POSTGRES_HOST_AUTH_METHOD=trust` warning is emitted by the temporary, network-isolated test image; never use that setting for a network-accessible or production database.

### Step 40C-9 runtime checkpoint — early Docker exit (BLOCKED, diagnostic fix committed)

The operator's Step 40C-9 PowerShell output confirms that the new **static contract and runner tests passed 6/6**, but `node scripts/bdp/parcel-rpc-disposable-smoke.mjs --disposable-only` failed **before any SQL migration executed**. Docker created a disposable container, then the container stopped; the first reported error was `container ... is not running`. Cleanup also reported `No such container` because the initial runner used `docker run --rm`, which automatically deleted an early-exiting container. This is a **real unclosed runtime checkpoint**, not a proven PostgreSQL migration defect or an indication that production BDP data is broken.

A targeted test-harness repair now removes `--rm` during startup, captures Docker `inspect` state/exit code/OOM flag and a bounded tail of PostgreSQL startup logs when a disposable container fails, checks for a premature exit during readiness probing, and unconditionally uses `docker rm --force --volumes` to remove the **randomly named test container and its anonymous volumes**, including after a failed start. The runner still uses no published ports, external Docker network, real GIS data, or persistent BDP DB mounts. A new test checks the diagnostic and cleanup contract. This repair has **not** been verified by rerunning Docker yet; the root cause remains unknown until logs are captured.

PowerShell checkpoint (one command at a time):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelRestrictedRpc.test.mjs src/bdp/ingestion/parcelRestrictedRpcRunner.test.mjs
node scripts/bdp/parcel-rpc-disposable-smoke.mjs --disposable-only
```

If the disposable run fails again, copy the `Disposable PostGIS diagnostics:` lines including the status, exit code and startup log tail. Do not apply the role migration to an existing PostGIS database or mark Step 40C-9 complete without the isolated SQL and restricted-role test passing.

### Step 40C-9 — Restricted role disposable runtime verification now staged (NOT YET RUN)

The latest operator screenshot shows **13/13 in the visible final test group** and a Vite build completed **before** synchronizing the Step 40C-9 SQL changes. The subsequent `git pull --ff-only origin bdp-development` succeeded and installed the SQL foundation and fixture; that pull **did not execute or validate** either SQL file.

To close this checkpoint safely, `scripts/bdp/parcel-rpc-disposable-smoke.mjs` now starts an ephemeral `postgis/postgis:17-3.5` Docker container with no published ports, no network access and no bind mounts to the BDP project database. The script refuses to run without `--disposable-only`. Within **only that disposable container**, it applies the already staged PostGIS parcel schema, installs the proposed restricted RPC role/functions and executes the synthetic fixture in a transaction that rolls back. It also adds a positive and negative test **while `current_user` is the restricted `NOLOGIN` role**, asserting that the role can invoke the fixed functions but cannot query raw parcel geometry tables. It cleans up the container in a finally block.

This new Docker runner and its three tests (`src/bdp/ingestion/parcelRestrictedRpcRunner.test.mjs`) and three static SQL contract tests (`src/bdp/ingestion/parcelRestrictedRpc.test.mjs`) are committed but **have not been executed on the operator's machine**. The RPC migration remains a DBA-review-only design; its SQL is not currently used by Step 40C-5 or Step 40C-7 adapters and should **not** be applied to the existing BDP/PostGIS container. The previous successful PostGIS smoke belongs to the earlier source/viewport queries, not this new restricted RPC.

Local validation from the existing PowerShell project folder, one command per line:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelRestrictedRpc.test.mjs src/bdp/ingestion/parcelRestrictedRpcRunner.test.mjs
node scripts/bdp/parcel-rpc-disposable-smoke.mjs --disposable-only
```

The target final line of a successful isolated run is `PASS: isolated PostGIS restricted RPC, synthetic data, and role isolation.` A SQL syntax, privilege or test failure is a genuine failed checkpoint: capture the first `ERROR` and revise the staged SQL safely rather than proceeding to public access. After this, a DBA must still review function ownership, role memberships, SECURITY DEFINER and source rights, and the adapters need a deliberately reviewed RPC query contract before any service uses a login. No public endpoint, license approval or Cesium geometry delivery is implied.

### Step 40C-9 — Restricted metadata RPC design (STAGED; UNVALIDATED)

The November 1 operator screenshot confirms that the previously committed work still builds (250 Vite modules, 9.82 seconds) and the visible final test group passed 13/13 with no failures. Earlier parts of the screenshot include separate memory/performance test groups with some skips; the image does not establish an independent live restricted-role validation.

A DBA-review-only SQL design is staged in `src/bdp/ingestion/sql/parcelRestrictedRpcFoundation.sql` with a rollback-only synthetic fixture at `src/bdp/ingestion/sql/parcelRestrictedRpcSmoke.sql`. The design proposes a non-login metadata executor role with no raw parcel table grants and two fixed, bounded SQL functions for approved-source/run lookup and PostGIS metadata probing. It DOES NOT install a role in the existing BDP database, issue a database login, grant a browser account, enable a public API or acquire county GIS data. The code has not been applied or runtime-tested. **Do not apply either SQL file to a production or existing database before DBA review.**

Before continuing, validate the fixed SQL syntax, the installed PostGIS extension schema, source/geometry function grants and the rights/revocation safeguards in a disposable PostGIS container. The existing adapters still issue direct source-controlled SQL against underlying tables and are **not** wired to these new RPC functions; without a reviewed migration to the restricted RPC query contract, connecting an application login would fail or grant too much access. Actual per-user authorization, license review, bounded pool acquisition, revocation checks and authenticated transport remain prerequisites. The 2.4 km Cesium Free Explorer is unchanged.

### November 1 — Step 40C-9 disposable restricted-role runtime PASSED

The operator's screenshot of `node scripts/bdp/parcel-rpc-disposable-smoke.mjs --disposable-only` shows **9/9 targeted Node checks passed**, successful PostgreSQL 17/PostGIS 3.5 startup, both restricted RPC functions created, and a synthetic fixture executed under the NOLOGIN role with `SET ROLE`. The fixture ended with `ROLLBACK` and the exact success message: `PASS: isolated PostGIS restricted RPC, synthetic data, and role isolation.` The disposable role can call the approved source/viewport functions but cannot read the raw parcel tables directly. **This clears the Step 40C-9 isolated testing gate, not the production DBA/security review.** No production schema or authenticated service login was created by this test.

### Step 40C-10 — Fixed restricted RPC reader bridge (STAGED, UNROUTED)

`server/providers/bdp-parcel-restricted-rpc-readers.js` now stages a server-only bridge that accepts ONLY the exact earlier source-controlled query statements from the 40C-6 approved source/run resolver and 40C-4 metadata service. It rechecks the exact county FIPS, trusted source ID, numeric run ID, WGS84 viewport bounds and 1–200 feature cap before acquiring a driver connection. Instead of direct raw-table SQL (which the restricted role **cannot** execute), it substitutes two fixed **parameterized function calls**: `bdp_parcel_index.approved_sources_rpc($1::text)` and `bdp_parcel_index.parcel_viewport_probe_rpc($1...$8)`. The returned row field names align with existing server-side metadata summarizers. It does not return any data directly to the browser.

The bridge requires a trusted pinned database connection, executes `BEGIN TRANSACTION READ ONLY`, applies bounded PostgreSQL `SET LOCAL` statement, lock and idle timeouts, and rolls back/evicts a failed connection. It rejects unknown SQL, browser roles, malformed counties/runs/bounds, client-supplied query fields, invalid timeouts and excess result counts before any success. Viewport rows are capped at that request's exact probe size (`limit + 1`). AbortSignal is checked before/after driver work; it is **not active query cancellation**. The existing server metadata service still performs the final authorization recheck and never promotes source coverage beyond `unknown`.

`src/bdp/ingestion/parcelRestrictedRpcReaders.test.mjs` adds **8 targeted tests**, including a mock composition of the entire resolver → restricted source reader → restricted viewport reader → aggregate-only metadata flow. This staged code is **committed but has not yet been executed in the operator's checkout**, nor tested against a live PostgreSQL client driver. No HTTP endpoint, account/login, auth issuer, DB membership, credentials, county GIS ingestion, parcel polygon payload or public route is activated. Production blockers remain: DBA review of SECURITY DEFINER ownership and role memberships, a truly current authenticated session/entitlement authority, approved caching/redistribution rights per source, a separate restricted DB login/pool, driver cancellation and rate limits, provenance and exact source-window coverage, and stable paged geometry delivery.

PowerShell verification (one command per line):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelRestrictedRpcReaders.test.mjs
npm.cmd test
npm.cmd run build
```

The existing God’s Eye View/Cesium Free Explorer, 2.4 km threshold, parcel overlays and Property Intelligence interface are **unchanged**. Do not wire this into public HTTP or invoke the restricted role SQL against the existing BDP database until the remaining security and rights prerequisites are met.

### Step 40C-10 operator validation — November 1, 2026

The screenshot after pulling Step 40C-10 shows the **full unit test group had 3,470 tests, 3,464 passed, six skipped, zero failures**. Additional memory/performance test groups completed **1/1** and **13/13**, all passed. The Vite production build succeeded with **250 transformed modules** in **16.15 seconds**. Bundle-size warnings remain nonfatal; they should be measured and addressed as part of the later client performance phase, rather than dismissed as a measured map improvement. The screenshot confirms local regression/build validation, **not** a live pooled Postgres driver integration.

### Step 40C-11 — Unrouted HMAC/session → restricted RPC metadata runtime (STAGED)

`server/providers/bdp-parcel-metadata-runtime.js` is a single, inert server-side composition of the already staged HMAC-backed county-session verifier, current-session and source/right resolver, Step 40C-10 restricted PostgreSQL source+viewport RPC readers and fail-closed aggregate-only metadata service. The only returned capability is `readViewportMetadata`. The runtime does **not** expose the HMAC key, raw SQL clients, source resolver, browser endpoint, parcel IDs or geometry. Construction performs no network/database access and rejects unknown configuration properties; it requires a trusted 32+ byte server-side key, an authoritative noncached session reader and an injected pinned PostgreSQL `connect()` factory.

`src/bdp/ingestion/parcelMetadataRuntime.test.mjs` introduces **eight targeted contract tests** for configuration failure, inert construction, HMAC validation, county-only access, rights expiry, session revocation after a viewport read, overflow/UNKNOWN coverage, bounded restricted RPC usage and generic database errors. **Committed only: these new tests and the entire regression/build after the change have not yet been run in the operator's checkout**, and the test's PostgreSQL clients are mocks rather than a real driver.

This is **not** a login issuer, session store, credentials file, secure cookie transport, actual database pool, per-user quota, licensed GIS import, polygon delivery API or public service. Before exposing a route, require commercial county GIS rights, an independent DBA/security review of SECURITY DEFINER function ownership and role memberships, a proper session+entitlement store, TLS/security headers/Cookie isolation, bounded connections with cancellation/rate enforcement, data provenance and complete/partial source-window evidence. Keep the 2.4 km Free Explorer and original Cesium/UI untouched until the full integration is secure.

Operator verification (one command per line in PowerShell):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelMetadataRuntime.test.mjs
npm.cmd test
npm.cmd run build
```


### Step 40C-11 regression checkpoint — November 1, 2026 (PASSED)

The operator's fresh screenshot after rerunning `npm.cmd test` reports the **3,478-test main group with 3,472 passes, six skipped, zero failures**, followed by a **1/1 focus-allocation test** and **13/13 moving-source memory/performance tests**, all green. The prior `ETIMEDOUT` memory benchmark passed independently and on this subsequent full run without relaxing either allocation budget or timeout. This closes the Step 40C-11 local regression checkpoint. It does **not** prove deployed PostGIS access, commercial county GIS reuse rights or live map performance. The current screenshot does not include a new Vite build; an earlier preexisting build had passed.

### Step 40C-12 — Staged node-postgres Pool connector with least-privilege checkout checks (NOT DEPLOYED)

`server/providers/bdp-parcel-pg-pool.js` adds an **unrouted server-only** adapter matching the real `pg.Pool` API. A trusted server initializer would inject the `Pool` constructor and explicit, server-only connection settings, and then pass `connector.connect` to `createParcelMetadataRuntime` from Step 40C-11. The connector is inert until its first `connect()`; pool construction does **not** run migrations, provision a login, create an account, fetch GIS data or attach HTTP routes.

The adapter **refuses default/owner/superuser or browser-influenced connection settings**: configuration must supply exact host, port, database, a separately provisioned restricted `ldos_parcel_...` LOGIN username (never the 40C-9 `NOLOGIN` role itself), and server-secret password. Loopback-only PostGIS may use local unencrypted transport; remote endpoints require `ssl.rejectUnauthorized=true` with normal CA validation. It never accepts a connection URI, caller SQL, browser roles or unbounded pool sizes. The pool uses `max=2`, `min=0`, 2-second acquisition timeout, 10-second idle eviction, 2-second PostgreSQL statement timeout, 4-second idle transaction cutoff, and an explicit shutdown `close()` method.

**Every pool checkout**, including reuse of an idle client, first runs a fixed `pg_catalog` privilege attestation. The check rejects superuser, BYPASSRLS, CREATEDB/CREATEROLE, `SET ROLE` principal mismatch, direct/inherited raw parcel table rights, schema CREATE grants, or missing EXECUTE rights to either fixed restricted RPC. Failed checks evict the pinned client; driver errors are replaced with generic errors to avoid exposing credentials or SQL detail. This **does not establish that the operator has a correctly provisioned LOGIN** or prove all schema/role/function ownership privileges are safe. A security/DBA review must also inspect memberships, PUBLIC grants and the SECURITY DEFINER function owners. The connector can only be used after such a principal is provisioned; do not connect to the `bdp` Docker database as its owner.

`src/bdp/ingestion/parcelPgPool.test.mjs` adds **eight targeted tests** using a fake `pg.Pool`: config validation, TLS downgrade prevention, lazy acquisition, per-checkout attestation, denial/eviction, safe error messages, shutdown, and complete mocked HMAC→source RPC→viewport RPC composition. **These tests have been committed, not yet run in the operator's checkout.** There is no `pg` package dependency or actual driver in the project yet, and no real driver was executed in this stage; the injected pool is a contract to be satisfied by a separately installed and reviewed Node PostgreSQL driver in an isolated test harness. Do not describe mocked results as real database validation.

To validate the staged code locally, from the project PowerShell folder, run these separately:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPgPool.test.mjs
npm.cmd test
npm.cmd run build
```

**Next security gate:** create and review a genuinely least-privileged service LOGIN in a disposable PostGIS database; test the authentic `pg` driver's checkout, TLS behavior, permissions, timeouts, rollback and connection reuse under that account. Only then evaluate a protected internal metadata endpoint. Do not touch the existing BDP database or enable public GIS delivery until source rights, genuine session/entitlement issuing, transport, per-user quotas, provenance and coverage evidence are in place. The original Cesium Free Explorer, 2.4 km threshold, parcels and Property Intelligence UI are **unchanged**.


### Step 40C-12 operator regression — November 1, 2026 (PASSED)

The operator's latest screenshot reports the **3,486-test main suite with 3,480 passed, six skipped and zero failures**. Both separate performance suites passed **1/1** and **13/13** without relaxing memory budgets or timeouts. This closes the local regression checkpoint for the staged Step 40C-12 pg Pool contract. **No new Vite build or actual PostgreSQL driver invocation appears in this screenshot.** The working Cesium 2.4 km experience remains unchanged.

### Step 40C-13 first targeted test — test-assertion false positive (FIXED; RETEST PENDING)

The operator's first screenshot of the Step 40C-13 targeted Node tests shows one failure in the static Docker command safety check, which was running `assert.doesNotMatch(code, /...--volume.../)` on the **entire runner source file**. This incorrectly flagged the required **cleanup** command `docker rm --force --volumes` as if it were a disallowed Docker **startup mount**. The screenshot does not show an actual Docker container being started; it is a static assertion failure, not a PostgreSQL driver/runtime failure.

The committed test now extracts the actual `docker(['run', ...])` argument block and checks only those startup arguments for privilege escalation, unapproved volume mounts, host networking, wildcard ports, or trust auth. It **separately requires** that the cleanup still removes anonymous volumes. An independent source-contract check against the checked-in runner found expected bridge network / loopback-only port and no unsafe run options. This is **not yet an operator-confirmed Node test pass**.

Operator commands (run separately in PowerShell):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPgDriverSmoke.test.mjs
```

Proceed to the **opt-in** real-driver Docker test only if that targeted test passes and the local `pg` package is installed. The remaining commercial data-rights, DBA review, security and authentication gates are unchanged.

### Step 40C-13 — Disposable **real node-postgres** validation (STAGED / NOT YET RUN)

A new manual-only command `scripts/bdp/parcel-pg-driver-disposable-smoke.mjs --disposable-only` exercises an actual `pg.Pool` through the restricted runtime. It requires the independently installed Node `pg` package and Docker Desktop. The script refuses any invocation except the exact `--disposable-only` opt-in; it does **not accept** database URLs, user-supplied hostnames, existing container IDs, external data sources or arbitrary SQL. It creates a randomly named fresh `postgis/postgis:17-3.5` container with a fresh randomized password and temporary host port **bound only to 127.0.0.1**, not to an externally reachable interface. It waits for complete PostGIS image initialization before applying the already tested parcel schema, restricted RPC foundation and invented synthetic parcel fixture. No existing `bdp-postgis` service or persistent project volume is referenced.

Within **only the disposable container**, it creates `ldos_parcel_service`, a separate `LOGIN NOINHERIT` role with permission to execute the two fixed approved-source and viewport RPC functions but **no** direct GIS table grants. The staged pool connector runs its privilege attestation on each checkout. The test passes the actual restricted connections to Step 40C-11's HMAC-backed county authorization and aggregate-only metadata runtime, verifies a valid synthetic in-viewport parcel count while keeping `viewportCoverage = unknown`, checks that direct `SELECT` of raw parcel tables is denied by PostgreSQL, rejects a forged session and a revoked county session, then revokes the fixture's source registry rights and verifies the metadata read is denied. It cleans up the random container and its anonymous volumes in `finally`. A temporary loopback port is used for the real host-side driver test, and is unbound after cleanup. The runner removes synthetic test data along with its container; it is not a database migration.

`src/bdp/ingestion/parcelPgDriverSmoke.test.mjs` adds **six fast unit/contract tests** checking strict opt-in, missing-driver behavior before Docker startup, loopback-only ephemeral port parsing, synthetic role SQL without raw table privileges, invented fixture data and cleanup safeguards. **These checks and the real-driver Docker smoke are committed but have not been executed by the operator.** The full repository test/build after this commit are also not verified. Avoid calling the live-driver test passed until the printed Docker result confirms success.

Local PowerShell procedure (run one command at a time from the repo root, with Docker Desktop running):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPgDriverSmoke.test.mjs
# Explicitly install the driver for this temporary local test only, without modifying the repo lockfile:
npm.cmd install --no-save --package-lock=false pg@8.23.1
node scripts/bdp/parcel-pg-driver-disposable-smoke.mjs --disposable-only
```

Expected success line: `PASS: disposable real pg Pool, restricted LOGIN, HMAC metadata and revocation.` If a test fails, capture the first relevant database/Node error and do not advance to public endpoints. The optional install fetches `pg` from the package registry into the existing local `node_modules` without recording it as a project dependency; a later production integration must separately review the actual runtime dependency, CI lockfile, and supported version.

**Remaining deployment gates:** independent DBA approval of SECURITY DEFINER owners, memberships and PUBLIC grants; a durable current session/entitlement store and actual login/cookie issuer; production TLS and secrets management; per-user/distributed rate limits and active driver cancellation; real rights to cache and redistribute any county GIS sources; polygon provenance, byte budgets, progressive paging and verified coverage windows. This probe returns only metadata; it does **not** activate map tiles, GIS replication, property owner details, or user-facing login.


### Step 40C-13 operator confirmation — November 1, 2026 (PASSED)

The operator first ran the six Step 40C-13 static/guard tests (**6/6 passed**), installed `pg` locally using `npm.cmd install --no-save --package-lock=false pg` (npm reported zero vulnerabilities in that install), then ran the manual opt-in real-driver test. The operator's latest PowerShell screenshot shows the exact final line:

```text
PASS: disposable real pg Pool, restricted LOGIN, HMAC metadata and revocation.
```

**Interpretation:** In an isolated disposable PostgreSQL/PostGIS environment with synthetic data, the **actual node-postgres pool** authenticated as a restricted LOGIN, the HMAC-backed county session and approved-source/viewport functions returned bounded metadata, direct raw parcel table access was denied, and revocation prevented further metadata disclosure. The test returned to PowerShell without an error. This closes the Step 40C-13 **disposable real-driver validation** checkpoint. No real Travis CAD records, published geometry tiles, production user sessions or existing persistent database changes are evidenced by this run.

**Not yet validated/deployed:** independently reviewed production database role/SECURITY DEFINER ownership and memberships; production identity/session issuing with strongly current revocation and browser cookie security; rate limiting and cancellation across multiple users; rights to cache/redistribute county GIS data; provenance/coverage and signed geometry-payload handling; live end-to-end Cesium integration, performance and accessibility. `pg` was installed *locally only* with `--no-save`; any production service requires a pinned, audited runtime dependency and lockfile. Do not interpret this result as permission to enable a public route.

**Next engineering decision:** Move beyond staged metadata scaffolding. Design a gated internal server transport and a safe, source-provenance-aware, geometry-delivery pathway backed by verified rights and explicit coverage status. Preserve the current 2.4 km Free Explorer and Property Intelligence behavior, and maintain the original God’s Eye View/Cesium interface as the map foundation.


### Step 40C-14 — Internal-only parcel metadata HTTP boundary (STAGED / UNMOUNTED)

Following the operator-confirmed real `pg.Pool`/PostGIS smoke success in Step 40C-13, `server/providers/bdp-parcel-internal-metadata-http.js` introduces an **unmounted** Node HTTP request handler for the existing **aggregate-only** metadata runtime. It does **not** create or bind an HTTP listener, mount a route on the current application, deliver polygon geometry, change the Cesium UI, create a session issuer, or prove that commercial county GIS rights allow replication. Although the handler has a fixed internal path, it cannot be reached from the web unless a future trusted Node application explicitly mounts it.

The handler accepts only a `POST` to `/internal/parcel/viewport-metadata`, with an exact reviewed `expectedOrigin` and a same-origin Fetch Metadata gate where available. It accepts JSON geographic parameters only (`countyFips`, `bounds`, bounded `limit`), imposes a **1,024-byte request-body cap**, denies unsupported content encoding and all client-supplied source IDs, roles, session handles, SQL, cursor and source-coverage claims. It does not use `Authorization`, `x-role` or an untrusted browser body to establish permissions.

The integration **must independently inject** three trusted operations: `readOpaqueSession(req, signal)`, extracting only a cryptographically random 32-byte token from a Secure, HttpOnly, SameSite cookie with a separately reviewed cookie parser; `consumeQuota({sessionHandle,countyFips,signal})`, a genuinely **distributed, atomic, fail-closed** per-user budget (not a local boolean mock); and `readViewportMetadata` from the HMAC/least-privilege/rights/revocation-checked server runtime. Missing/invalid session fails with generic denial; exhausted quotas return 429 without making parcel SQL requests. Each response is no-store/private, has no `Access-Control-Allow-Origin`, and serializes **only** a whitelisted status, count and overflow; all source/viewport coverage stays `unknown`, and `geometryDelivered=false`. A transport-side exception cannot leak a database error, cookie, SQL, parcel ID, owner or geometry. Closing the response aborts outstanding application work; the actual SQL driver's in-flight cancellation remains an additional integration gate.

`src/bdp/ingestion/parcelInternalMetadataHttp.test.mjs` contains **ten** tests using a temporary `127.0.0.1` Node HTTP server to exercise input-size/type/cross-origin and method rejection, cookie/quota gates, field sanitization, overflow/UNKNOWN coverage and generic errors. These tests have been committed but **have not yet been run on the operator's computer**. They use trusted callback mocks, **not** an actual session store or distributed quota, and the disposable test listener is not part of the application.

**Do not mount the handler in production yet.** Remaining blockers: independently approved per-county GIS caching/redistribution rights, a real Secure/HttpOnly cookie issuer + rotation/logout/session store, a distributed quota implementation and timeout/abuse protection at the reverse proxy, trusted origin/Host/proxy enforcement and TLS, DBA review of restricted PostgreSQL function ownership and grants, proven request cancellation, and an accurate verified-coverage/paged geometry pipeline. A new public API would require its own authorization/security review. The inherited 2.4 km Cesium Free Explorer, Travis parcel discovery and Property Intelligence panel remain unchanged.

Local validation from the project root, one command per line:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelInternalMetadataHttp.test.mjs
npm.cmd test
npm.cmd run build
```

The targeted HTTP test is a new addition; do not describe it as passed until the operator shows results. The whole-suite/build checks are regression gates, not proof of live authenticated deployment.

### November 1 — Step 40C-14 operator validation and focused BDP testing

The operator's screenshot confirms the **10/10** standalone `parcelInternalMetadataHttp.test.mjs` tests passed with no failures, and the Vite 6.4.5 production build completed in **12.34 seconds**, transforming 250 modules. The yellow >1500 kB chunk warnings are nonfatal but remain a performance follow-up.

The previous full `npm.cmd test` invocation had **3,496/3,502 main-suite checks passing, six skipped, zero main-suite failures**, then the GC-bracketed, serialized inherited world-overlay test group timed out in **3 of 13** heavyweight child-process benchmarks. The three failures were `spawnSync node.exe ETIMEDOUT`, not measured B/frame budget violations; the other 10 passed. The exact reason for these intermittent slow workers is not verified, and the **full release test gate is therefore NOT green for this run**. A separate operator-triggered parcel test group (30/30) also passed; that does not substitute for all regression tests.

To reduce repeated unnecessary multi-minute legacy-performance runs while iterating on land development, `scripts/bdp/run-land-tests.mjs` now **discovers all `src/bdp/**/*.test.mjs` files recursively** and executes them with Node's test runner at file concurrency 2. `package.json` adds `npm.cmd run test:land`. Four contract tests verify recursive file discovery, stable ordering, argument safety, and that the parcel metadata and driver tests are included; no tests are manually cherry-picked. This command is a **developer feedback loop**, not a release-quality substitute. The existing `npm.cmd test` full runner, GC thresholds, 180-second worker deadline, original God’s Eye overlay code and build configuration have **not been changed**.

Local verification, one command per line:

```powershell
git pull --ff-only origin bdp-development
npm.cmd run test:land
npm.cmd run build
```

The focused runner and its tests have been committed but **not yet executed in the operator's checkout**. Before a release candidate, rerun `npm.cmd test` under stable CPU/memory conditions and separately diagnose remaining overlay timeouts if they persist. The 2.4 km discovery behavior, Travis County source-coverage discipline, Property Intelligence card and inherited Cesium UI remain untouched. Step 40C-14 is validated as an **unmounted** metadata-only handler; it is not deployed or publicly accessible. A geometry endpoint still requires source-level redistribution rights, accurate bounded coverage, and live authenticated service prerequisites.

### November 1 — Focused test gate and Step 40C-15 unpublished geometry preflight

The operator's latest terminal screenshot shows one `npm.cmd run test:land` invocation finished with **566/566 tests passing, zero failures and zero skipped** (about 43 seconds). A second screenshot shows a new `test:land` command launched but does **not** show its final outcome. The focused suite is now useful for day-to-day land-engineering feedback, but it is **not** a replacement for the full inherited God's Eye release regression gate, which still has intermittent memory-benchmark ETIMEDOUT failures requiring separate investigation.

Step 40C-15 stages `src/bdp/ingestion/parcelGeometryCandidate.js` and `parcelGeometryCandidate.test.mjs`. This is **private, pure, unpublished candidate assembly**, not an API, PostGIS geometry query, paid GIS dataset license or modification to Cesium. The builder takes an already validated bounded plan, ordered metadata rows (including an optional +1 overflow probe), ordered decoded geometry rows, a trusted source/run, a server clock and an **independent, explicitly approved geometry redistribution-rights review**. Source registry rights for caching alone are **insufficient** to qualify a candidate. The separate review requires a matching county/source, explicit `allowGeometryRedistribution`, nonempty review reference, valid review dates and an unexpired rights deadline no later than the reviewed source's caching deadline. No real county is approved by this code; such records need a separate authoritative policy review and store.

Every geometry row must bind to the metadata row's exact parcel ID, original source-version and 64-hex source-geometry digest, ingestion run, county and source. Real PostgreSQL BIGINT run IDs may arrive as precision-safe decimal strings and are normalized safely. Candidate assembly delegates structural, per-feature vertex/memory, total page vertex/memory and **2 MB GeoJSON wire cap** checks to the existing 40C-3 strict budget module. It constructs a minimal GeoJSON FeatureCollection containing only map-safe source IDs and 2D polygon geometry; it never spreads raw PostGIS rows or owner/address/value fields. The extra overflow row is omitted from geometry, never hidden as completion. All success paths return `viewportCoverage: 'unknown'` and **`publishAuthorized: false`**; an empty candidate is not proof of a parcel-free area. Malformed data returns generic unavailable.

**Caveat:** Comparing source-geometry SHA identifiers between query results does NOT independently verify that serialized GeoJSON is bit-for-bit consistent with original PostGIS WKB. Actual geometry transport still requires a fixed SQL function or trusted adapter that retrieves rows in a **single snapshot-consistent read**, checks publication rights at read time and post-query, binds a cryptographic digest to the original geometry representation, checks cancellation/rate limits and authenticates each request. None is implemented in this step. Do not wire candidates to the public UI or treat the synthetic `review` test fixture as actual redistribution permission. The existing 2.4 km Free Explorer and property card remain unchanged.

Nine new targeted unit tests are committed, **not yet executed on the operator's computer**. Verify, one PowerShell command at a time:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelGeometryCandidate.test.mjs
npm.cmd run test:land
npm.cmd run build
```

The full npm test suite remains required before any release; budget/timeout requirements are unchanged.


### Step 40C-15 local validation and Step 40C-16 snapshot read plan

The operator's screenshot confirms that Step 40C-15's **9 targeted tests passed (0 failed, 0 skipped)**, and the Vite 6.4.5 production build passed (**250 modules; 16.06 seconds**). The build's large-chunk warnings remain nonfatal but have not been optimized. The screenshot does **not** include the newer 40C-16 tests or a full `test:land` result for this revision; these gates remain open.

Step 40C-16 introduces two staged artifacts, neither applied to the current PostGIS database:

- `src/bdp/ingestion/sql/parcelGeometryPublicationRightsFoundation.sql`: **manual DBA/legal review only**. Proposes `geometry_publication_reviews`, a **separate** source/county-specific rights registry with `review_state='unreviewed'` and `allow_geometry_redistribution=FALSE` defaults. Approved rows must have a recorded review reference and validity dates. Explicitly revokes all table privileges from PUBLIC and the existing `ldos_parcel_rpc_client`. It imports no GIS data, creates no login, grants no polygon access, changes no Cesium UI and approves **no actual county**. The migration must be reviewed before any execution, and its apparent SQL validity remains **untested in Docker**.

- `src/bdp/ingestion/parcelGeometrySnapshotPlan.js`: **unrouted server-only fixed SQL candidate** using the existing validated eight bind parameters (`countyFips`, trusted source/run, constrained WGS84 bounds, `limit + 1`). The SQL reads from the same indexed parcel_version in one statement, joins the separate independent approved redistribution-rights record, and rechecks current source caching permission and run validity. It uses a bounded `MATERIALIZED` PostGIS candidate set; the overflow probe geometry is returned as `NULL`, and oversized individual geometries similarly return `NULL` so the validator rejects rather than silently omitting parcels. The pure staging function returns only minimal map-safe FeatureCollection fields, uses the previous 40C-3 per-feature/page/2 MB wire budgets, and **always** returns `publishAuthorized: false`, `viewportCoverage: 'unknown'`. A zero-row query is never proof that a viewport is empty.

**Security:** Because the Step 40C-9 restricted `ldos_parcel_service` login must NOT have raw table privileges, this SQL is **NOT runnable by that service**. That is deliberate. Before any live execution, a DBA must review a bounded, fixed privileged RPC/function that enforces both independent redistributable geometry rights and source rights inside the database and grants only tightly scoped EXECUTE. The service must still check session/entitlement and legal rights again after queries; no browser-facing endpoint, tile encoder, paging cursor, durable source window coverage or active cancellation is added by this stage. Source geometry SHA in rows is *not* cryptographic proof the returned GeoJSON equals original WKB, nor a legal boundary/title guarantee. Do not run with the database-owner account as an application workaround.

Nine Step 40C-16 unit/contract tests in `src/bdp/ingestion/parcelGeometrySnapshotPlan.test.mjs` cover fixed query bindings, independent rights checks, SQL registry deny defaults, private minimal output, overflow/null sentinel, invalid/oversized geometry, missing rights, forged plans, and unknown empty pages. They are **committed but not yet executed in the operator's checkout**. Do not claim the SQL is migration-tested until a separate synthetic disposable PostGIS DBA test has passed.

Local PowerShell validation, each separately:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelGeometrySnapshotPlan.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Any failure pauses Step 40C-16 for repair. Full `npm.cmd test` remains the release requirement, with the existing intermittent inherited overlay timeouts handled separately. The original God’s Eye View 2.4 km Free Explorer and Property Intelligence panel remain unchanged.


### Step 40C-16 operator validation — November 1, 2026

The operator's latest PowerShell screenshot confirms `npm.cmd run test:land` passed **584/584**, with **0 failures, 0 skips**, in approximately **48.6 seconds**. The Vite 6.4.5 build passed with 250 transformed modules in **10.38 seconds**. Large post-minification JS chunks still produce nonfatal warnings. This confirms committed source-level/contract testing of the staged Step 40C-16 plan, **not** SQL execution against PostGIS; public geometry delivery remains disabled.

### Step 40C-17 — Synthetic, disposable real PostGIS geometry validation (STAGED)

`scripts/bdp/parcel-geometry-disposable-smoke.mjs` is a manually opt-in script to validate Step 40C-16's *actual* parameterized geometry SELECT against fresh `postgis/postgis:17-3.5` and the real installed `pg` driver. Its companion `src/bdp/ingestion/parcelGeometryDisposableSmoke.test.mjs` adds six fast static/guard tests (not yet executed by the operator). The script accepts **only** `--disposable-only`. It creates a randomly named temporary container, with an ephemeral localhost-only port and no mounts, uses generated credentials, waits for full PostGIS initialization, applies the existing schema/restricted-metadata functions and the separately staged default-deny geometry rights registry to **that disposable container only**, and seeds three invented parcels and a fake source whose URL ends in `example.invalid`.

The runtime check exercises **real SQL and real PostGIS spatial predicates**: default-unreviewed redistribution rights must yield zero polygons, the existing NOLOGIN metadata-only role must not read raw geometry or the publication registry, a **synthetic reviewer approval inside the disposable DB** permits a bounded two-polygon query with a third NULL geometry overflow sentinel, and the already staged pure candidate preflight must still return `publishAuthorized: false` and `viewportCoverage: 'unknown'`. The test then verifies wrong county/run denial, geometry-publication-rights revocation, and independent source-caching-rights revocation. It removes the random container and anonymous volumes at the end.

**Security/operational boundaries:** A PostgreSQL superuser connection is used only inside the *synthetic test container* to evaluate the draft raw-table SQL and exercise revocation; it is intentionally **NOT** an approved production application connection. The existing restricted `ldos_parcel_service` does not have and must not receive raw table grants. This test does not provision an approved publication SQL function, verify real CAD redistribution licenses, enable geometry HTTP routes, or change the Cesium parcel visualization. The fact that the synthetic fixture is marked "approved" does not grant real Travis or other Texas county redistribution rights. Actual production service delivery still requires separate verified legal rights, a DBA-reviewed fixed-function RPC, session/entitlement and post-query rights rechecks, secure transport, authentic snapshot digest verification, paging/byte budgets, and observed source coverage.

**Step 40C-17 remains OPEN** until both new guards and the disposable PostGIS runtime check succeed locally. Run these commands **one per line** in the existing PowerShell project directory, with Docker Desktop running and the locally installed `pg` driver available:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelGeometryDisposableSmoke.test.mjs
node scripts/bdp/parcel-geometry-disposable-smoke.mjs --disposable-only
```

Expected final line: `PASS: disposable PostGIS geometry rights, bounded snapshot, overflow, and revocation.` If the disposable test fails, capture the first PostgreSQL or assertion error and do **not** execute the new publication-rights SQL on your existing database. After a successful isolated run, use `npm.cmd run test:land` and `npm.cmd run build` as the usual non-release regression gate. The full inherited performance suite remains a separate release requirement.

### Step 40C-17 operator confirmation — November 1, 2026 (PASSED)

The operator's screenshot shows two separate executions of `node --test src/bdp/ingestion/parcelGeometryDisposableSmoke.test.mjs`, each reporting **6/6 passes, zero failures**, followed by `node scripts/bdp/parcel-geometry-disposable-smoke.mjs --disposable-only` printing the exact line: `PASS: disposable PostGIS geometry rights, bounded snapshot, overflow, and revocation.` This confirms execution against a disposable real PostgreSQL/PostGIS instance, with synthetic geometry rights, overflow behavior and revocation checks. It does not demonstrate legal rights to redistribute actual Texas county GIS data, a deployed restricted geometry RPC or production parcel rendering.

### Step 40C-18 — Unrouted, default-deny geometry SECURITY DEFINER RPC draft (STAGED)

`src/bdp/ingestion/sql/parcelGeometryRestrictedRpcFoundation.sql` is a **manual DBA-review-only** proposed SQL function `bdp_parcel_index.parcel_geometry_snapshot_rpc`, based **verbatim** on the validated 40C-16 bounded single-snapshot SELECT. It accepts eight parameters (county, approved source and run, WGS84 bounds and 2–201 probe cap), requires both caching rights and independently reviewed unexpired redistribution rights, and returns only identified geometry/source metadata with a `NULL` overflow sentinel. This is a fixed query: **no dynamic SQL** or caller-selected relation name. The output is still subject to the strict existing application GeoJSON/vertex/byte limits and final session, source and rights rechecks.

PostgreSQL `SECURITY DEFINER` requires an explicit reviewed function owner with only necessary table privileges. This new function is declared with a pinned `pg_catalog, pg_temp` search path and fully schema-qualified PostGIS calls. It is created with `CREATE FUNCTION` rather than `CREATE OR REPLACE` to avoid silently overwriting a prior function/privilege configuration. **EXECUTE is revoked from PUBLIC and the preexisting metadata-only NOLOGIN role within the migration transaction. There is intentionally NO `GRANT` to an application login or any geometry reader.** No source or Texas county is autoapproved, no new roles are created, and no web endpoint is introduced. This SQL is only a proposal; do not apply it to the existing database without ownership/role/membership/source-rights review. The separate publication rights registry from 40C-16 is still uninstalled in the working database.

`src/bdp/ingestion/parcelGeometryRestrictedRpc.test.mjs` adds **seven** source-contract tests: SQL equivalence, mandatory independent rights, exact schema/parameters, bounded spatial results, overflow policy, field allowlist, and default-deny grants. They are committed **but not yet executed locally**, and they are NOT a substitute for executing real SQL in an isolated PostGIS container. Step 40C-18 will remain open pending the checks below, then a distinct disposable runtime validation of the function's syntax, rights and privileges. Even an isolated pass will not prove that the production login is authorized for geometry delivery.

Local PowerShell commands, one per line:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelGeometryRestrictedRpc.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Continue preserving the God’s Eye Cesium UI, 2.4 km threshold, free exploration and existing parcel panel. The full inherited regression suite and its intermittent memory-benchmark timeouts remain separate pre-release gates, unchanged.

### Step 40C-18 operator regression and Step 40C-19 isolated security function validation — November 1, 2026

The operator's latest screenshot confirms `npm.cmd run test:land` succeeded with **597/597 passes, no failures or skips**, and `npm.cmd run build` succeeded with Vite 6.4.5, **250 modules, 16.35 seconds**. Warnings about >1500 KB JS chunks remain nonfatal. This is **source-level validation of the proposed Step 40C-18 fixed geometry RPC**, not evidence that its actual `CREATE FUNCTION` executes in PostgreSQL, or that any data-rights/security review is complete.

Step 40C-19 introduces `scripts/bdp/parcel-geometry-rpc-disposable-smoke.mjs` and `src/bdp/ingestion/parcelGeometryRpcDisposableSmoke.test.mjs`. The runner is **opt-in only** and uses a new, random `postgis/postgis:17-3.5` Docker container on `--network none` with **no port publishing, named volumes, real CAD sources, application services, production credentials, or reused DB**. SQL is passed solely through Docker's local Postgres socket. It waits for the image's complete initialization and applies the staged index, metadata-only RPC, independent geometry-redistribution review, invented synthetic parcel fixtures, and Step 40C-18 fixed **SECURITY DEFINER** function **only inside the disposable DB**. The container is force-removed with its anonymous volumes afterward.

The runtime checks initial function privilege revocation for the existing metadata-only NOLOGIN role, confirms that role cannot run the new function or read the independent rights table, then creates a **synthetic NOLOGIN geometry test role** which has only schema USAGE + EXECUTE on the single fixed snapshot function, **no raw parcel SELECT**. This synthetic-only grant is NOT present in the actual Step 40C-18 proposed migration. Tests require redistribution permission to default-deny, allow only invented test-source geometry after synthetic review, retain a `NULL` +1 overflow polygon, reject wrong county and run ID, and deny subsequent reads after publication or source-caching revocation. No application LOGIN is granted geometry access. The tests and runtime probe have been **committed but have NOT yet been executed in the operator's checkout**; no real-county rights have been established.

Local PowerShell verification, one command at a time (Docker Desktop required for the second):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelGeometryRpcDisposableSmoke.test.mjs
node scripts/bdp/parcel-geometry-rpc-disposable-smoke.mjs --disposable-only
```

Expected isolated success: `PASS: disposable fixed geometry RPC, default-deny, restricted EXECUTE, and revocation.` If the function fails to create, privilege checks fail, or geometry rows don't match, preserve the actual first PostgreSQL error and keep the checkpoint open. Do not apply the schema or GRANT to any existing database. After an isolated pass, `npm.cmd run test:land` and `npm.cmd run build` are the usual broader gates. The remaining deployment blockers include DBA approval of function ownership, actual separate restricted LOGIN, county source reuse/publication rights, session+entitlement issuance and revocation, server-side quota/cancellation, provenance+coverage and paged geometry delivery, and the original Cesium integration. The original 2.4 km discovery, parcel overlay and Property Intelligence experience remain unchanged.


### Step 40C-19 confirmed; Step 40C-20 private function-only reader — November 1, 2026

The operator ran the six focused `parcelGeometryRpcDisposableSmoke.test.mjs` checks (**6/6 pass, zero failures**) and the opt-in disposable PostGIS runtime probe returned `PASS: disposable fixed geometry RPC, default-deny, restricted EXECUTE, and revocation.`. The test demonstrated function syntax/privileges, synthetic independent geometry rights, bounded geometry with a NULL overflow sentinel, and revocation using a *synthetic* NOLOGIN role in a temporary database. This is NOT approval for the production database owner, the metadata-only account, or any real county's redistribution license.

Step 40C-20 stages `server/providers/bdp-parcel-private-geometry-reader.js` with a **fixed parameterized** call to the 40C-18 `parcel_geometry_snapshot_rpc`; no dynamic SQL, HTTP routes, browser input authority, GIS grants, login, persistent schema migration, or map changes are included. This reader is **not wired into the metadata client**. A separately audited geometry-only database login and pinned client are required before any actual integration. It accepts only the trusted bounded county/source/run/extent/probe request, begins a read-only PostgreSQL transaction, sets bounded server-side statement/lock/idle timeouts, and allows at most `limit+1` rows plus a **2.2 MB private serialized result cap**. Unexpected fields (such as owner names), malformed rows, extra sentinel polygons, or oversized responses fail closed, roll back and discard the client. No raw GIS table query is issued by the client.

Even a successful operation yields PRIVATE candidate data with `publishAuthorized: false` and `viewportCoverage: 'unknown'`. `src/bdp/ingestion/parcelPrivateGeometryReader.test.mjs` adds **ten contract tests**, including a pure composition with the existing Step 40C-16 snapshot candidate preflight, cancellation, rollback, bounds, and byte/row controls. **The tests are committed but not yet executed in the operator's checkout.** This stage is not an authorized output transport: after any real query, an independent current HMAC session/county entitlement, fresh caching/publication-rights evidence, provenance and wire-byte/vertex check, and a genuinely secure per-user rate gate remain required. AbortSignal pre/post checks are NOT active PostgreSQL query cancellation.

PowerShell checkpoint (one command per line):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPrivateGeometryReader.test.mjs
npm.cmd run test:land
npm.cmd run build
```

**Do not activate this reader against the current database or grant geometry RPC execution to the existing metadata-only role.** The God’s Eye Cesium UI, 2.4 km Free Explorer, existing Travis boundaries and Property Intelligence card are unchanged. The full inherited overlay performance suite remains a separate required pre-release gate.


### Step 40C-20 operator regression — November 1, 2026 (PASSED)

The operator's screenshot confirms **613/613** `npm.cmd run test:land` tests passed, zero failures or skipped tests, in about **44.38 seconds**. The Vite 6.4.5 production build passed (250 transformed modules, **9.48 seconds**). Large chunk warnings remain nonfatal and need later performance work. This confirms the **local focused regression** for the staged 40C-20 geometry-only reader and existing land modules. The separate inherited full overlay/memory test remains a required pre-release gate; a production geometry service has not been enabled.

### Step 40C-21 — Unrouted, private pre/post authorization and rights geometry composition (STAGED)

`server/providers/bdp-parcel-private-geometry-service.js` stages an **internal-only** orchestration that accepts a strictly bounded viewport and a 32-byte opaque session handle from a **trusted server**. The injected operations are separately required: `resolveAuthorizedSource` (genuine HMAC-backed/current authoritative session, county entitlements and approved source/run, reused from Step 40C-6), `readPublicationReview` (an independent, current reviewed geometry redistribution-rights authority; **not caching approval**), `readSnapshot` (the Step 40C-20 geometry-only restricted RPC reader, NOT the metadata DB account) and `consumeQuota` (a real distributed, atomic per-session/county limiter). All are required at construction. **None of these production providers is created by this stage; the unit test uses injected mocks.** Neither a public endpoint nor a Cesium source is mounted.

Flow: validate county/bounds and opaque handle → consume trusted quota → check current session/source/run + cache expiry → check independent geometry redistribution review → read private bounded PostGIS result → **reverify session/source/run and cache rights** → **reverify unexpired publication rights**, requiring unchanged review reference, review dates and expiry → validate rows, geometry, vertex/page/byte budget via Step 40C-16, with `viewportCoverage:'unknown'` regardless of rows. Any missing right, revocation, run rotation, policy change, quota error, SQL error, invalid result or cancellation fails closed. In-process concurrency is capped (default two), **in addition to** any future distributed quota. Cancellation currently means AbortSignal checks only and is **not** active Postgres driver cancellation.

A successful internal result includes a PRIVATE GeoJSON candidate under a **non-enumerable, frozen** `privateCandidateGeoJson` field; ordinary `JSON.stringify` on the returned status **cannot accidentally include geometry**. This is only a defensive guard; it is **NOT authority to serve the private candidate**, and future code must explicitly opt into any transfer after additional rights/security review. Every result is `publishAuthorized: false` and coverage remains `unknown`; even an empty valid result is not evidence of an evaluated parcel-free viewport.

`src/bdp/ingestion/parcelPrivateGeometryService.test.mjs` adds **12 targeted tests** including pre- and post-query revocation, real HMAC county verifier + approved-source resolver composition, expired and rotated legal review evidence, quota before data access, malformed inputs, overflow, response field privacy and concurrency. These changes are committed and source syntax-checked, but **have not been run by the operator**. Tests do not prove an actual production user/session store, truly distributed rate limiter, live privileged geometry DB login or commercial county data redistribution license.

PowerShell validation, one command per line:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPrivateGeometryService.test.mjs
npm.cmd run test:land
npm.cmd run build
```

**Remaining deployment blockers:** real live session/entitlement authority with secure cookie issuing and revocation; an independently reviewed legal GIS publication-rights record for each county/source; DBA-owned fixed-function privileges and a dedicated geometry-only login/pool; active cancellation plus bounded queueing and distributed atomic quotas; page cursors, provenance/WKB hash verification, trustworthy coverage windows and browser-specific delivery rules. Do not expose private geometry via the existing metadata HTTP transport or give the metadata database role new geometry grants. The original God’s Eye View/Cesium Free Explorer (2.4 km threshold), Travis parcel behavior and Property Intelligence panel remain untouched.

### Operator checkpoint: November 2, 2026 — Steps 40C-29 and 40C-30

The operator proved the Step 40C-29 signed continuation backend in disposable PostGIS: **11/11** SQL contract tests, **8/8** Docker guard tests, and the real `PASS: disposable PostGIS keyset paging, restricted EXECUTE, overflow, and rights revocation.` output. The immediately preceding **699/699** local land tests and Vite **4.36s successful build** were also shown. A second land suite was started after that Git pull; its final summary is not visible in the checkpoint screenshot.

Step **40C-30** stages an eight-parameter **sealed** initial-page RPC that matches the sealed continuation SQL except for the latter's cursor filter, reuses all existing GIS redistribution rights and source-caching gates, and retains strict zero-default EXECUTE permissions. It is accompanied by an unrouted plan function, **10 focused tests**, and an opt-in disposable harness extended to prove first-page denial before sealing and after rights revocation. Isolated source-based checks passed, but **operator Node and disposable PostGIS checks are pending**. The older unsealed snapshot RPC remains untrusted for production.

**Nothing has been mounted in Cesium or migrated into an existing database**. Every client-facing geometry path still needs a separately approved authenticated session/county policy, a legal source redistribution-rights review, per-page revalidation after SQL, quotas, response validation, and cancellation before release. A complete individual source window is not complete viewport/county coverage. The full inherited world-overlay release tests remain an open gate.

### Operator checkpoint: November 2, 2026 — 40C-30 verified; 40C-31 staged

Operator screenshot proves **10/10** Step 40C-30 initial-page checks, **10/10** updated keyset runtime guard checks and real disposable PostGIS first/next-page smoke with rights revocation. A previous land-suite **711/711** and Vite production build (250 transformed modules, 4.39 s) were also shown; the subsequently started `test:land` has no visible final result at this checkpoint.

Step 40C-31 stages a **no-route, private-only** result validator for both sealed RPCs. It validates fixed ten-column SQL row shape, source/county/run/version consistency, BIGINT key ordering and optional strictly-after cursor, all-page geometry budget/coordinate/overflow checks, independent caching and redistribution rights, and returns only an **unpublished** candidate with **UNKNOWN** viewport coverage. The 13 source-based checks passed in an isolated JavaScript evaluation; local Node validation is pending. It does not independently verify a seal from arbitrary rows, provide user authentication, access a DB, permit geometry publication, or alter the Cesium application. See `docs/STEP-40C-31-PRIVATE-SEALED-PAGE-VALIDATION.md`.

### Operator checkpoint: November 2, 2026 — Step 40C-31 validated; 40C-32 staged

The operator provided a successful preceding **724/724** land-test suite and **Vite production build** (250 modules, 4.80 s), followed by a successful Git pull and **13/13** Step 40C-31 focused Node tests. A newer post-pull land suite was started; no final result was shown.

Step **40C-32** adds `parcelPrivateGeometryReadBoundary.js`, a private, **unmounted** composition of strict opaque session handle check, fresh trusted source/rights and county authority checks **before and after** a fixed sealed first/next PostGIS function call, distributed quota callback and abort-aware response sanitization. It reuses existing HMAC token planning and 40C-31 SQL-row validation but returns **only private page counts and an optional signed position**, never geometry, SQL, source identities or viewport-completeness claims. Thirteen new focused tests are staged and need local Node verification. No HTTP route, real session provider, DB client, SQL migration or Cesium viewer code was changed. Details: `docs/STEP-40C-32-PRIVATE-GEOMETRY-READ-BOUNDARY.md`.

### Operator checkpoint: November 2, 2026 — Step 40C-33 dependencies staged (NOT DEPLOYED)

Step 40C-33 builds a strictly **unrouted** server-only composition of the HMAC session/county verifier, a sealed-run source authority callback, separate current geometry redistribution review, atomic quota callback, the 40C-32 boundary and a narrowly bounded fixed initial/keyset PostGIS RPC reader. It re-checks the active server session, rights and immutable run both before and after SQL, with publication revision derived from ALL policy/seal facts; the query reader checks the effective geometry-only login's restricted catalog permissions inside a pinned read-only transaction. **Fifteen synthetic Node tests are staged; no operator run is yet confirmed**. No real session database, cookie transport, geometry LOGIN, approved county GIS license, legal review, DB migration or frontend/public service was added. See `docs/STEP-40C-33-TRUSTED-SEALED-GEOMETRY-DEPENDENCIES.md`. The Step 40C-32 focused test and full land/build check also remain operator-pending.

### Operator checkpoint: November 2, 2026 — Step 40C-33 passed; Step 40C-34 staged

Operator screenshots confirm **15/15 focused Step 40C-33 tests**, **752/752 land-development tests** and a **successful Vite build** (250 modules, 10.73 seconds). A count-discovery check is recommended because the land-suite total remained 752 after adding a new focused suite. These results are for local synthetic and source-contract testing; they are NOT authentication, GIS publication or production DB access approvals.

Step 40C-34 adds a **DBA-review-only, NO-GRANT** SQL lookup of the county source's latest finished run, with complete/untruncated + immutable run-seal evidence and current caching rights; a strict private normalized result adapter; **22 new contract tests**; and a separately opt-in **Docker network-isolated disposable PostGIS** security smoke. None of this has been tested by the operator or installed on an existing database yet. The independent current legal geometry-redistribution review is NOT combined with caching rights. No endpoint, credentials, role or Cesium UI was changed. See `docs/STEP-40C-34-SEALED-SOURCE-AUTHORITY.md`.

### Operator checkpoint: November 2, 2026 — Step 40C-34 VERIFIED; Step 40C-35 STAGED

The operator screenshots verify **22/22 Step 40C-34 focused tests**, the full **774/774 land regression suite**, a Vite production build (**250 modules, 16.82 seconds**), correct discovery of the 40C-33/34 test files, and the isolated **real disposable PostGIS sealed-source RPC smoke PASS**. No live BDP SQL migration or licensed county GIS redistribution claim was made. The nonfatal large-bundle warning remains for later performance optimization.

Step 40C-35 is now STAGED, NOT deployed: a fixed authority-only PostGIS SQL reader with independent expected LOGIN, pinned read-only transaction, comprehensive catalog privilege attestation and bounded private rows; **12 new executor tests**, **8 new disposable-smoke contract tests**, and a strictly opt-in real disposable PostGIS test of a password-authenticated, one-use authority LOGIN (not SET ROLE impersonation). No schema migration, role, GIS permission, HTTP endpoint or frontend geometry delivery was created outside the disposable test runner. Operator test results remain PENDING. See `docs/STEP-40C-35-AUTHORITY-DB-LOGIN-ATTESTATION.md`.

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
