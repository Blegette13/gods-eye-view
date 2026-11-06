# Step 40C-39 — Three-principal disposable PostGIS integration and revocation-coherence design

**Status: STAGED / UNROUTED — OPERATOR TESTS PENDING. November 6, 2026.**

## Previous milestone confirmed

Operator screenshots show Step 40C-38 **51/51 focused Node tests PASSED**, **855/855 land-development regression tests PASSED**, **production Vite build PASSED** (250 modules; 4.91 seconds), and a successful opt-in **real disposable PostGIS geometry-only LOGIN smoke**. The yellow Vite bundle-size advisory is nonfatal. All testing uses synthetic fixtures; it does not establish any real county GIS redistribution license.

## Step 40C-39 files and scope

- **scripts/bdp/parcel-three-principal-disposable-smoke.mjs** stages a NEW **strictly opt-in, fresh, password-authenticated** PostGIS integration check. One Docker container is created with no Docker network, host port, host mount or persistent database. It contains only invented parcel/source/rights records and staged SQL drafts. Three **real, different** SQL LOGINs (ldos_parcel_authority_test, ldos_parcel_publication_test, ldos_parcel_geometry_test) share the same disposable database but have disjoint EXECUTE grants: sealed-source authority RPC; independent geometry-publication review RPC; and the two sealed geometry RPCs. Each role must independently pass its exact session/current-user catalog attestation while denied raw parcel, run, rights and other RPC access.
- The script checks fail-closed behavior before a run seal, after sealing but before independent publication approval, and after explicitly setting synthetic publication approval. It re-reads through **three separate login sessions**, then revokes publication rights and source caching independently between calls. Post-revocation queries must return zero private authority/geometry results as applicable. It also attempts a deliberate cross-role EXECUTE grant and requires the geometry principal's role proof to fail. The test container and its volumes are removed in finally.
- **src/bdp/ingestion/parcelThreePrincipalDisposableSmoke.test.mjs** adds **14 non-Docker contract tests** covering the exact opt-in guard, disposable Docker isolation, actual password-login identity, separate RPC privileges, synthetic-policy state transitions, cleanup and the explicit **ABA/revocation race** limitation.

No production migration, SQL grant/login, PG pool, session cookie, API endpoint, user-facing geometry, GIS licensing approval, or Cesium UI modification is included. The existing 2.4 km Free Explorer, Travis CAD browsing and Property Intelligence panel remain unchanged.

## What this DOES and DOES NOT prove

A successful real disposable smoke will prove that the three **actual PostgreSQL identities** can exercise their separate reviewed functions **in one test database**, reject each other's grants, and respond to sequential SQL revocation transitions with fresh separate transactions.

It will **NOT** verify simultaneous long-lived pooled connections, atomicity among all three role transactions, actual session/MFA revocation, browser publishability, protected tile delivery, live commercial GIS rights, or real multi-user quotas. In particular, the smoke uses separate completed SQL transactions in a controlled sequence; it is **not a concurrent three-connection race test**.

## Revocation epoch / ABA risk — DESIGN ONLY, PRODUCTION BLOCKER

The private Step 40C-33 runtime presently computes a SHA-256 revision from the **current values** of the sealed source/run and independently reviewed rights. It rechecks those before and after geometry RPC. This catches many straightforward changes but **cannot detect an intervening revoke followed by reapproval to identical values** (A → B → A, an *ABA* transition), nor guarantee that rights remain unchanged between final check and future delivery. A signed cursor does not solve this.

Before mounting any browser/public transport, require independently audited durable monotonic revocation versions **for every session/county grant, source/cache/seal policy, and redistribution review**; versions MUST advance transactionally on *every* permission/policy change, including revoke/reapprove and expiration/renewal. Each change must be durable and tamper-resistant under an approved owner/trigger policy. Versions must be read from authoritative strongly current stores, bound to private continuation tokens, and checked before query, after query, and at an explicit, auditable delivery-release linearization gate. The team must design how rights changes after that gate terminate future reads and avoid inappropriate caches. Do not infer these guarantees from timestamps, query hashes, in-memory counters, mock callbacks, multiple independent read-only transactions or synthetic test passes. Session-store and legal-rights-store replication, outage fail-closed behavior, transaction isolation and cancellation must be reviewed separately.

**No revision storage/trigger/schema, browser release gate, or new authenticated transport is introduced in 40C-39.** Those are mandatory follow-up milestones, not optional hardening.

## Operator validation — PowerShell, sequentially

    cd "$HOME\gods-eye-view"
    git pull --ff-only origin bdp-development
    node --test src/bdp/ingestion/parcelThreePrincipalDisposableSmoke.test.mjs
    npm.cmd run test:land
    npm.cmd run build

Expected **14/14 new guard tests**, and the full suite may reach **869/869** (previously 855/855) if discovery includes the new file. These outcomes are **NOT yet operator-verified**.

With Docker Desktop running and the earlier checks green:

    node scripts/bdp/parcel-three-principal-disposable-smoke.mjs --disposable-only

Expected success: PASS: disposable PostGIS three independent LOGINs, sealed source, independent review, geometry gate and revocation.

**Stop at the first failure.** Do NOT execute any SQL draft against the existing land-development database. Do not issue real LOGINs or geometry permissions as part of this step.

## Next: Step 40C-40

Design and stage a **durable monotonic rights-revision authority** with isolated, transactional database tests that specifically prove ABA transitions increment the revision; examine independent strongly current session/county revocation versions, safe release boundaries and multi-connection transaction races. Then test real pg clients and cancellations under controlled backpressure. No public polygons until authentication, license, DBA/security and delivery reviews are complete.
