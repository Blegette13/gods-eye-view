# Step 40C-43 — Synthetic session/county & sealed-run revocation epochs

**Status: STAGED / NOT DEPLOYED — operator verification pending. November 7, 2026.**

## Last validated milestone — Step 40C-42

Operator screenshots show **928/928 complete land-development tests PASSED**, and **Vite production build PASSED** (250 modules in 4.46 seconds). The focused 48-case command is visibly green in its displayed portion, but its final summary was not shown, so a separate 48/48 focused result is **not independently confirmed**. The nonfatal Vite chunk-size advisory remains a performance item, not a test failure.

The existing Cesium God’s Eye View UI, 2.4 km free-explorer parcel handoff, Travis County browse polygons and Property Intelligence panel remain unchanged.

## What this phase actually stages

**Two independent unmounted PostgreSQL draft authorities. No live roles, credentials, HTTP routes, schema migration or GIS redistribution approval.**

1. `src/bdp/ingestion/sql/parcelSessionCountyEpochFoundation.sql`: establishes a **separate, deny-default synthetic account/session namespace** (`ldos_private_auth`). It contains a **stand-in only** `session_county_decisions` table keyed by an opaque HMAC session digest and Texas county FIPS; account-active, MFA, session-active, and county discovery flags default FALSE. This is NOT the real account, session, MFA or grant store and must never be independently treated as one. A separate durable positive BIGINT `session_county_epochs` table keeps history even after an individual decision row is deleted. A protected, search-path-pinned transactional trigger increments the matching epoch on every INSERT/UPDATE/DELETE, including no-op updates. Revoke/reapprove with identical current flags yields a different epoch. Identity-key reassignment and TRUNCATE are denied. PUBLIC has no schema/table/function privileges.
2. `src/bdp/ingestion/sql/parcelRunSelectionEpochFoundation.sql`: establishes a deny-default **future source/run-selection revision** table keyed to canonical source ID and Texas county. Source/ingest-run/run-seal tables are locked for a consistent baseline: **epoch 1 records only the installation state, not past policy history**. Transactional row-lock-serialized triggers advance the source-scoped epoch on ingest-run INSERT/UPDATE/DELETE and new immutable run-seal INSERT. Ingest run ID/source reassignment and TRUNCATE/CASCADE of ingest runs or seals are denied. A failed immutable seal mutation does not advance an epoch. This is a *change detector only*: its epoch alone cannot identify the presently newest finished run or authorize its redistribution. The existing fixed sealed-source RPC still must verify the authoritative current run separately.
3. `scripts/bdp/parcel-session-run-epoch-disposable-smoke.mjs`: **explicit opt-in** synthetic PostGIS validation in a brand-new Docker container using `--network none`, no host ports/mounts and only self-contained fake GIS records. Tests default deny, A→B→A session/county grant version changes, delete/recreate retaining the epoch, rollback preserving old facts and versions, run-selection updates and seals, rejected sealed-run mutations, TRUNCATE rejection and denied direct access to ordinary SQL roles. Test container and volumes are removed in `finally`.
4. `src/bdp/ingestion/parcelSessionRunEpoch.test.mjs`: **19 new Node source/safety tests**, including strict smoke opt-in, SQL confinement, separate schemas, revocation, durability/ABA, rollback, seal version changes, privilege denial and cleanup.

**Local staging checks:** new JavaScript script parsed and **19/19 lightweight contract simulations** matched. These are not a real Node test run, actual PostgreSQL execution, DBA review, or CI result. Operator verification is required.

## Important unresolved production blockers

The session/county table is a synthetic **placeholder** and is not tied to existing user sign-in, logout, 2FA/MFA changes, account suspension, session expiry or county-grant administrative workflows. Transactionally bumping this isolated table cannot protect changes made in a separate live identity provider. The run-selection epoch is not yet available through a fixed separately attested read-only SQL RPC, and the strict private Step 40C-42 `readSessionCountyEpoch` / `readSealedRunEpoch` callbacks remain **unimplemented with real strongly-current production stores**.

There are **no concurrent multi-transaction PostGIS race tests in this step**. Consistent MVCC snapshot, cross-store atomicity, crash/recovery, trigger ownership and tampering, read replica staleness, role restrictions, pool limits, source/rights update paths and on-wire release-time authorization are still open. Future code must use an independently audited current session-account store; stable per-session and per-county revocation versions; a DB-approved exact current sealed run identity; and a final controlled output-release gate. Never interpret an epoch as a GIS license, survey, zoning clearance, parcel coverage, or authorization to send polygons.

## Operator validation — existing PowerShell window, one command at a time

```powershell
cd "$HOME\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSessionRunEpoch.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **19/19 new tests**, **947/947 land suite cases** (928 previously + 19 new), and a successful Vite production build. These are predicted, not verified.

With Docker Desktop available, and only if those tests/build are green:

```powershell
node scripts/bdp/parcel-session-run-epoch-disposable-smoke.mjs --disposable-only
```

Expected success message:

`PASS: disposable PostGIS session/county and sealed-run epochs reject ABA, rollback and TRUNCATE.`

Stop at the first failure and share the output. **Never apply these SQL draft files against the existing development or production database.**

## Step 40C-44 — proposed next

Add isolated real PostgreSQL **concurrent** writer/revoke/read race probes for the independently scoped session and run epochs, design a fixed attested private run-selection epoch reader with current-seal identity, define the actual authenticated session/county epoch store interface, and specify a concrete security-reviewed release-time linearization boundary. No browser geometry or published API until those safeguards and GIS legal rights are separately verified.
