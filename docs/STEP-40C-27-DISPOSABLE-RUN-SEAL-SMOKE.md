# Step 40C-27 — Disposable PostGIS run-seal validation (STAGED)

## Operator evidence — November 2, 2026

The operator's screenshots confirm a **successful Vite 6.4.5 build (250 modules) before the latest pull** and **12/12 successful `parcelRunSealFoundation.test.mjs` contract tests**, with zero failures or skipped tests. The second screenshot ends immediately after `npm.cmd run test:land` was entered; **there is no result yet** for that run, nor a post-pull build in these screenshots. The Step 40C-25 opt-in actual keyset PostGIS smoke has not been separately confirmed.

## Newly committed (not executed on the operator's database)

- `scripts/bdp/parcel-run-seal-disposable-smoke.mjs`: opt-in-only `--disposable-only` PostGIS test using a fresh randomly named `postgis/postgis:17-3.5` container. Uses `--network none`, **no host ports or mounted persistent volumes**, a generated password, an isolated PostgreSQL Unix socket through `docker exec`, and cleanup with `docker rm --force --volumes`. No external GIS, production roles, original application database, website, browser API or real Travis county records.
- `src/bdp/ingestion/parcelRunSealDisposableSmoke.test.mjs`: **8 guard tests**, source-checked but not yet run in the operator's Node environment. Verify exact opt-in, Docker isolation/teardown, synthetic-only fixture, no browser transport, incomplete/source/version/count rejection, completed-run sealing, and post-seal write denial.

The disposable smoke imports the Step 40C-13 synthetic source and 3 invented parcels, creates synthetic coverage evidence, applies the **uninstalled Step 40C-26 SQL run-seal proposal in that temporary database only**, then verifies incomplete runs, mismatched source/version, and incorrect indexed counts all fail. It seals the completed run (3 indexed records), checks `sealed_at`, denies subsequent insert/update/delete of sealed parcel versions, updates/deletes of coverage evidence, edits/deletes of completed ingest metadata, updates/deletes/duplicate inserts of seals, and checks the three parcels, coverage window and source run survive unchanged.

### Still open

**Actual runtime behavior is NOT confirmed** until the user executes this against disposable PostGIS and sees the exact success line. The SQL and triggers may need repairs if runtime reveals PostgreSQL errors. This smoke does **not yet** model two concurrent writers/sealers racing, serializable transaction snapshots, owner/superuser bypass of triggers, transactional rollback across an operator migration, a cryptographic record digest, or keyset RPCs requiring an existing seal. Concurrency will require a separate deterministic multi-client test. In particular, the existing Step 40C-24 keyset RPC still does not enforce a seal; never wire this to the browser or treat the cursor as proof of stable data.

A database superuser within a **disposable test container** is used only for synthetic schema creation and probes. A production reader must not use that identity. No commercial GIS redistribution rights are granted or inferred.

## Operator checkpoint — PowerShell, individually

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelRunSealDisposableSmoke.test.mjs
node scripts/bdp/parcel-run-seal-disposable-smoke.mjs --disposable-only
npm.cmd run test:land
npm.cmd run build
```

Expected disposable success (only after real execution):
`PASS: disposable PostGIS immutable run seals, denied mutations and incomplete-run rejection.`

If the prior `npm.cmd run test:land` is still running, record **its** final summary before proceeding to the next Git pull. Docker Desktop is required for the disposable smoke only. The Step 40C-25 opt-in PostGIS keyset test remains a separate checkpoint if not already completed:
`node scripts/bdp/parcel-keyset-disposable-smoke.mjs --disposable-only`

**Do not apply either run-seal or keyset migrations to the existing database.** The full inherited `npm.cmd test` release suite remains an outstanding gate. Cesium/God's Eye View, 2.4 km Free Explorer, Travis CAD overlays and the Property Intelligence panel are unchanged.
