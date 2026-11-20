# Step 40C-29 — Keyset RPC requires a verified immutable source-run seal (STAGED)

## November 2, 2026 operator checkpoint

The supplied PowerShell screenshots show Step 40C-28 **11/11 local concurrency contract tests passing**, the actual opt-in disposable PostgreSQL concurrency smoke printing:

```
PASS: disposable PostGIS run-seal concurrency, writer-first and sealer-first ordering.
```

The land-development regression completed with **696/696 tests passing, zero failed/skipped** (~23.97 s), and the Vite 6.4.5 production build passed (250 modules, ~4.33 s). An accidentally entered standalone `k` command returned a harmless PowerShell command-not-found error; the subsequent build still succeeded.

## What was changed (all drafts / never auto-migrated)

- `src/bdp/ingestion/sql/parcelGeometryKeysetRpcFoundation.sql` now **inner-joins the Step 40C-26 `parcel_run_seals` table** to the existing county/source/run, geometry-redistribution, caching and bounded-spatial rights predicates. The seal must identify the **same ingest run, source, county and source version**, its `indexed_records` must match `ingest_runs.received_records`, and `sealed_at` must not precede `finished_at`. The run must be `complete` with no reported unidentified/truncated source records. Unsealed and partial runs cannot qualify. The original rights checks, keyset ordering, limit+one overflow, maximum bounds and no-PUBLIC/no-metadata-role EXECUTE grants remain unchanged.
- `src/bdp/ingestion/parcelGeometryKeysetRpc.test.mjs` adds two new checks and adjusts the snapshot-SQL parity assertion to remove **only** the extra seal and keyset restrictions. Expected **11 targeted tests**.
- `scripts/bdp/parcel-keyset-disposable-smoke.mjs` now applies `parcelRunSealFoundation.sql` **before** creating the keyset function in its isolated, synthetic PostGIS container. It must prove that, even with synthetic explicitly approved geometry rights, an **unsealed** run returns zero keyset geometry. It then checks the synthetic run has exactly three records, seals it, and continues with the prior restricted-role 3-page pagination, null overflow, wrong-source/run/county and rights-revocation checks. It neither executes against a persistent DB nor grants real GIS rights. The old snapshot RPC remains unsealed and is used for a **synthetic test-only first page AFTER sealing**; it is **NOT an authorized production first-page implementation**.
- `src/bdp/ingestion/parcelKeysetDisposableSmoke.test.mjs` verifies seal-first migration order and unsealed default denial. Expected **8 targeted guard tests**.

The new test scripts were examined for JavaScript syntax, and the SQL parity/source-gate contract checks passed isolated evaluation. **The new schema+run tests have NOT been executed against the operator's real disposable PostGIS yet**, nor has any persistent database been migrated.

## Critical limitations

The Step 40C-29 **keyset** draft now requires an immutable seal, but the original Step 40C-18 **snapshot** function does **not** require it. A future first-page query must also enforce the seal, so do not connect this code to the existing metadata service or Cesium. A signed cursor cannot by itself prove an unchanged MVCC snapshot, legal GIS redistribution, current user authorization, or fully evaluated viewport. The future runtime still needs per-page live HMAC-backed session/county entitlements, independent reviewed redistribution rights, source/run rechecks before and after SQL, quotas, bounded response validation, PostgreSQL cancellation, and security-reviewed function ownership/EXECUTE privileges.

The SQL foundation intentionally uses `CREATE FUNCTION` (not `CREATE OR REPLACE`). The disposable test starts a fresh DB; **DO NOT apply the changed migration to any persistent or production database** without DBA review and a separate upgrade/rollback strategy. The Step 40C-25 keyset smoke must be rerun against this new dependency.

## Operator checkpoint — PowerShell, one command per line

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelGeometryKeysetRpc.test.mjs
node --test src/bdp/ingestion/parcelKeysetDisposableSmoke.test.mjs
node scripts/bdp/parcel-keyset-disposable-smoke.mjs --disposable-only
npm.cmd run test:land
npm.cmd run build
```

Expected: **11/11** new fixed-function SQL contract checks, **8/8** opt-in guard tests, successful real disposable keyset smoke, green land suite and green Vite build. Docker Desktop required for the disposable smoke only. Stop on any first failure for diagnosis.

The original God's Eye View/Cesium interface, 2.4 km Free Explorer, Travis County overlays and Property Intelligence panel remain unchanged. The full inherited `npm.cmd test` overlay/memory performance run is still a separate pre-release gate.
