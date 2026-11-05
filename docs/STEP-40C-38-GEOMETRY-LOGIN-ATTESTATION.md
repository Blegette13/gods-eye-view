# Step 40C-38 — Geometry-only PostgreSQL LOGIN isolation (STAGED / UNROUTED)

## Confirmed previous checkpoint — November 4, 2026

Operator screenshots validate Step 40C-37: **31/31 focused tests**, **835/835 full land regression tests**, **Vite production build succeeded (250 modules, 10.32 seconds)**. The yellow Vite large-bundle advisory is nonfatal. There was no disposable multi-connection PostgreSQL test in Step 40C-37.

## This step: harden geometry-role identity and grants

The **existing** server-only, UNROUTED geometry-only fixed RPC reader now requires an **exact expectedLogin** in the dedicated `ldos_parcel_geometry_...` namespace. The expected login is supplied only by trusted server startup configuration, not by a browser/request. It checks `current_user = session_user = $1::text` on the **same pinned, read-only PostgreSQL transaction** used by each sealed initial/keyset RPC. The attestation additionally requires:

- A real LOGIN with NOINHERIT, no superuser/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS and no role memberships.
- Parcel-index schema USAGE but no CREATE; **no raw base table, partitioned table, view, materialized view, foreign table or sequence privileges** in the index schema.
- EXECUTE on exactly the **two** sealed geometry RPCs (initial page and keyset) and **no other callable parcel-index functions**, including metadata RPCs, unsealed geometry, source-run authority or independent redistribution review.
- Exact boolean attestation result shape with no missing, malformed, extra or nonboolean fields; failure forces rollback and client discard.
- Strict server-provided fixed SQL, canonical parameter bounds, a maximum private result byte envelope and no result released after cancellation.

`server/providers/bdp-parcel-sealed-geometry-runtime.js` and `server/providers/bdp-parcel-verified-geometry-dependencies.js` now require and forward `geometryLogin` to the pinned reader. Both previous synthetic test fixtures were upgraded to check the parameterized exact login and broad privilege denial. **This is a behavior-changing server-only collaborator contract**, not a new deployed service. Production connection factories, reviewed geometry-only LOGINs, secrets and DB grants do not yet exist in the app.

**New files:** `src/bdp/ingestion/parcelGeometryLoginAttestation.test.mjs` contains **12 focused synthetic tests** for the exact login, read-only transaction, entire parcel-index privilege boundary, SQL allowlisting, malformed rows, cancellation and rollback. `scripts/bdp/parcel-geometry-login-disposable-smoke.mjs` is an explicit opt-in **REAL disposable PostGIS** security smoke that installs only synthetic parcel/rights/seal fixtures and DBA-review SQL inside a fresh network-disabled Docker container, creates a one-use SCRAM password-authenticated `ldos_parcel_geometry_test` LOGIN, grants it ONLY both sealed RPCs, runs the new catalog attestation under the actual LOGIN (not SET ROLE), tests wrong expected login, denied base tables, additional grant/membership drift, default unsealed/unreviewed denial, and publication revocation. The script removes its test container and volume afterward. `src/bdp/ingestion/parcelGeometryLoginDisposableSmoke.test.mjs` has **8** additional static/disposable-only safety checks.

**Status:** All Step 40C-38 files are COMMITTED / STAGED ONLY. The 12+8 new tests and real disposable SQL smoke are **NOT YET OPERATOR-VERIFIED**. Source inspection and simulated JS contract checks are not substitutes for operator Node and PostgreSQL execution. No SQL was applied to an existing BDP database, no production role created and no legal redistribution approval added. Never enable browser geometry from these tests.

## Operator validation — existing PowerShell (one command at a time)

```powershell
cd "$HOME\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelGeometryLoginAttestation.test.mjs src/bdp/ingestion/parcelGeometryLoginDisposableSmoke.test.mjs src/bdp/ingestion/parcelVerifiedGeometryDependencies.test.mjs src/bdp/ingestion/parcelSealedGeometryRuntime.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **51 focused cases**: 12 new role tests + 8 new smoke guard tests + 16 existing cross-principal integration + 15 existing geometry runtime tests. Prior full land suite was 835/835; it may become **855/855**, but the result must be observed before marking passed. STOP on first failure and do not run any production SQL.

**If Docker Desktop is available and the earlier checks pass**, run only the disposable synthetic real-PostGIS smoke:

```powershell
node scripts/bdp/parcel-geometry-login-disposable-smoke.mjs --disposable-only
```

Expected: `PASS: disposable PostGIS geometry-only LOGIN, exact principal, two sealed RPCs and grant revocation.`

The script uses a fresh Docker container with `--network none`, no mapped ports/mounts, synthetic test fixtures only and explicit cleanup. It does not connect to or grant anything on the existing land-development database.

## Remaining blockers and next step

This is **not** final production authorization. Independent current GIS license/source review, authoritative session cookie/MFA issuance and revocation, secure separate password/secret management, bounded client pools, active in-flight SQL cancellation, quota storage, immutable revocation-epoch/ABA prevention and **cross-transaction** policy coherence are still missing. The three roles have **not** yet been exercised together as three real concurrent PostGIS connections.

**Next: Step 40C-39** — disposable multi-LOGIN integration plus monotonic session/source/legal-rights revocation version design and controlled transaction race probes, with zero public geometry. Only after review should we consider an authenticated transport and incremental tiles.

The original God’s Eye View/Cesium interface, the 2.4 km Free Explorer handoff, Travis County free-browse polygons and Property Intelligence panel remain unchanged.
