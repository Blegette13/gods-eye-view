# Step 40C-26 — Proposed immutable source-run seals (STAGED; NOT DEPLOYED)

## Operator checkpoint — November 2, 2026

The latest PowerShell screenshot confirms the **land-development suite: 665/665 passed, 0 failed, 0 skipped**, and a **successful Vite 6.4.5 production build (250 modules, 4.43 seconds)**. The large-chunk warning remains nonfatal. The screenshot does not show the opt-in Step 40C-25 Docker/PostGIS keyset smoke, so its **runtime result remains unconfirmed**; a local JavaScript test pass is not evidence that the keyset SQL ran in PostGIS.

## Why this stage matters

A signed Step 40C-23 continuation token binds page position to a source/run, county, bounds and a reviewed rights revision. **It does not freeze the underlying parcel rows.** An insertion, deletion or edit mid-pagination could silently omit or duplicate parcel boundaries despite a valid token. This stage proposes a separate **explicit immutable completed-run seal** rather than claiming a cursor or PostgreSQL transaction magically spans requests.

## Committed scope

- `src/bdp/ingestion/sql/parcelRunSealFoundation.sql`: **manual DBA-review-only** proposal for `bdp_parcel_index.parcel_run_seals`. Each run can have only one seal. Seal insertion requires a finished `complete` ingestion run, verified source/county/version identity, known record counts, no unidentified records, no source-reported truncation, and an exact match between reported and indexed parcel counts. The server assigns `sealed_at`.
- The staged SQL adds **SECURITY INVOKER**, pinned-path triggers to prevent ordinary `INSERT/UPDATE/DELETE` of parcel versions or coverage windows for a sealed run, and to prevent edits/deletions of the sealed run's metadata or seal record. The seal insertion locks its parent ingestion run `FOR UPDATE`, and parcel/coverage writers lock that same parent `FOR SHARE`, to serialize sealing with in-flight writes.
- `src/bdp/ingestion/parcelRunSealFoundation.test.mjs`: **12 targeted contract checks** for the schema/guard logic, concurrency locks, immutability and absence of new app/public grants. Those test bodies passed a narrow source-level evaluation, **not** a real PostGIS migration or an operator Node run.

## Correct ingest order

Ingest `parcel_versions` while the `ingest_runs` record is running; finalize the run as `complete` with evidence; write any final `coverage_windows` evidence; then seal. Once sealed, ordinary writers cannot alter that run's parcels, window evidence or run metadata. A failed record-count comparison must **block** sealing; never fabricate missing geometry to force equality. It may be necessary to revise this conservative rule if a licensed source reports unique vs. duplicate feature counts differently. Historical run migration and permission review require a separate DBA plan.

**Important limits:** These triggers do not stop a superuser, table owner with trigger-disabling authority, DDL changes, or physical database corruption. A seal is an internal logical immutability barrier, not a cross-request MVCC snapshot, cryptographic geometry digest, complete-viewport claim, legal survey, or a commercial data redistribution license. The existing Step 40C-18 and 40C-24 geometry RPC drafts **do not check for a seal yet**. No service can safely treat their paged results as a sealed run until an independently reviewed rights-gated RPC is updated and tested in isolated PostGIS.

**This migration is not installed in the operator's existing PostgreSQL database.** It adds no production roles, grants, HTTP endpoints, GUI changes or real CAD records. The original God's Eye Cesium UI, 2.4 km discovery threshold, Travis County overlays and Property Intelligence panel remain unchanged.

## Operator checks (PowerShell; one at a time)

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelRunSealFoundation.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected for the new test file: **12/12 passed, 0 failed**. The next Step 40C-27 should add **opt-in synthetic disposable PostGIS smoke testing** for actual insert/update/delete behavior, sealing races and rejected incomplete runs **before** any consideration of deploying these triggers. If the Step 40C-25 opt-in Docker test has not yet been run, also execute `node scripts/bdp/parcel-keyset-disposable-smoke.mjs --disposable-only` with Docker Desktop running; record its result independently. Do not apply these new SQL files to any persistent database. The complete inherited world-overlay performance/release suite remains a separate open gate.
