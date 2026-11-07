# Step 40C-33 — Trusted sealed-geometry dependencies (STAGED / UNROUTED)

## Scope and status — November 2, 2026

Operator screenshots now confirm Step 40C-32 **13/13 focused tests PASSED**, the following post-pull land suite **752/752 PASSED**, and the Vite production build **PASSED (250 modules, 4.95 s)**. A second operator screenshot confirms **Step 40C-33 15/15 focused tests PASSED**, **752/752 land-development tests PASSED**, and a **successful production build** (250 modules, 10.73 seconds). Note: the land-suite count remained 752 despite 15 new focused tests, so the test-discovery path should be explicitly checked; the independent 15/15 focused result is conclusive for those cases. This phase adds no browser feature, service listener, endpoint, migration, production DB role or GIS license. Its own tests are **staged only** until run by the operator.

## Added server-only source files

1. `server/providers/bdp-parcel-sealed-geometry-runtime.js` composes the Step 40C-8 HMAC-backed session/county verifier with the Step 40C-32 private sealed-read boundary, an independent trusted immutable-run/source callback, an independent geometry-redistribution review callback, an atomic server-side quota callback, and the fixed-RPC reader below. An active, MFA-verified, non-revoked authoritative session is required for EACH pre- and post-read check. The separate session key and cursor key must be different 32+ byte secrets. All source and review records are exact-field, current, county-bound and denied by default. The publisher-policy revision is derived from the FULL source, run seal and reviewed rights facts; changing a review reference, expiration, run seal or immutable record count invalidates even an otherwise unexpired cursor or in-flight response.
2. `server/providers/bdp-parcel-sealed-geometry-rpc.js` executes **only** `parcel_geometry_sealed_initial_rpc` and `parcel_geometry_keyset_rpc` with strictly regenerated, bounded bind variables. A pinned `pg` client runs `BEGIN TRANSACTION READ ONLY`, local SQL timeouts, a current principal/function/table privilege check, one reviewed fixed RPC, a strict 10-column bounded row/byte envelope, then COMMIT or rollback plus connection discard on error. The role must be the session/current effective user, non-superuser, unable to read or mutate any raw parcel/caching/seal/publication/coverage table, permitted both sealed RPCs, and denied the older unsealed snapshot and metadata RPCs. The code cannot issue login grants, open a pool or provision its own connection.
3. `src/bdp/ingestion/parcelSealedGeometryRuntime.test.mjs` contains 15 new, synthetic, no-database focused Node tests. They exercise the complete fake-client round trip, cursor continuation, stale/forged session, unsealed or changed run, revoked or missing independent redistribution approval, quota failure, post-read review change, privilege attestation, malicious SQL, row and wire-size budgets, cancellation and absence of a public transport.

## Real infrastructure still MISSING — DO NOT DEPLOY

- A concrete HttpOnly/Secure/SameSite cookie transport, account/MFA/session issuance and rotation, **strongly current** server-side session lookup, logout/revocation enforcement, independent county grants and a production HMAC secret store.
- A DBA-approved **fixed, least-privileged sealed source/authority resolver**. Its `readSealedSource` must return a SINGLE source only after joining `source_registry`, a **complete, immutable** `ingest_runs` record, `parcel_run_seals` and validated source version/counts. A callback-supplied `sealedRun:true` is a shape contract, NOT itself database evidence. The callback must fail closed for zero/multiple sources, missing seal, incomplete or stale run and unreadable policy.
- A separate, current, independently audited **legal/commercial GIS redistribution** review provider. County map data being accessible over REST, approved to cache, or visible locally is NOT a geometry redistribution license. Travis County approval is not presumed.
- A distinct geometry-only PostgreSQL **LOGIN** and audited `SECURITY DEFINER` owners/grants, with active revocation testing. The existing metadata-only pool is forbidden. Authentication, SQL function migration and production GRANTs are not included.
- Atomic distributed per-session/county quotas, safe multi-user backpressure, bounded pool acquisition, **active query cancellation** (not just checks surrounding an in-flight query), transaction/authorization race review, security monitoring and a full adversarial integration test.
- An independent legal and GIS review before even considering public geometry, tile APIs, Cesium consumption or claiming full viewport/county coverage. Every result remains `publishAuthorized:false`, `geometryDelivered:false`, `viewportCoverage:'unknown'`, including zero rows.

**Trust model:** these files are an UNMOUNTED dependency composition for future reviewed collaborators, not proof that real authenticated or licensed database access exists. NEVER pass a browser-derived session record, source/run ID, rights approval, SQL text, or DB role as trusted dependencies. All of the new code is server-only and no metadata HTTP route is changed.

## Operator verification in PowerShell (one at a time)

```powershell
cd "$HOME\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPrivateGeometryReadBoundary.test.mjs
node --test src/bdp/ingestion/parcelSealedGeometryRuntime.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Confirmed on operator's local Windows Node environment: **13/13 for Step 40C-32**, **15/15 for Step 40C-33**, and a green land suite/build. Future steps still require their own tests. No PostgreSQL connection is necessary for the new synthetic tests. Stop and share any first failure; do not run SQL migrations or enable geometry delivery.

Next: **Step 40C-34 — Fixed sealed-source authority/read-privilege design & disposable SQL probe**. Build a separate, DBA-reviewed and **NO GRANT by default** SQL authority source for the runtime, then test revocation and isolation with a disposable PostGIS database. Do not use the existing database owner to simulate the real geometry-only service principal.

Original God’s Eye View / Cesium, the 2.4 km free Explorer handoff and parcel Intelligence panel are intentionally unchanged.
