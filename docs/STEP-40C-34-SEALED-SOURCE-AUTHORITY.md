# Step 40C-34 — Private sealed-source authority (STAGED / NO GRANTS)

## Operator checkpoint — November 2, 2026

The user confirmed Step 40C-33 **15/15 focused tests passed**, the land suite **752/752 passed**, and the **Vite production build passed** (250 modules, 10.73 s). The land suite's count remained 752 despite the newly staged tests; explicitly check the test runner's discovery of the new file before treating a pass count as proof that every new file was included.

Step 40C-34 files have been committed to `bdp-development` but are **NOT YET operator-tested**. NO SQL has been applied to a real database. NO frontend, public API, database role, secrets, credentials or county licensing rights were changed.

## Changes

- `src/bdp/ingestion/sql/parcelSealedSourceAuthorityRpcFoundation.sql`: a **DBA-review-only** SQL SECURITY DEFINER function returning at most two candidate source/run evidence rows for a Texas county, with NO GRANT to PUBLIC, the existing metadata-only role, or any service. It selects a source's **latest FINISHED** run, requires `complete`, no source truncation or omitted IDs, matches an immutable `parcel_run_seals` record by run, county, source, version and count, and checks current **source caching** approval. It deliberately does NOT join publication rights, does not publish geometry, does not resolve user identity, and does not declare any viewport or county complete. Two rows mean ambiguity and MUST be rejected by the caller; an empty result means unavailable/unknown, never a zero-parcel county.
- `server/providers/bdp-parcel-sealed-source-authority.js`: an **unrouted** strictly parameterized `parcel_sealed_source_authority_rpc($1::text)` adapter. Requires a trusted injected pinned/least-privileged query collaborator, checks an exact Texas county and AbortSignal, and only accepts ONE exact nine-column row. It validates current caching expiry, seal presence/timestamp, source version, canonical PostgreSQL BIGINTs, source/county identity, and returns a frozen private authority object. It returns `null` for missing, ambiguous, corrupt, stale, cancelled or thrown responses. The adapter does NOT prove that its SQL callback is authentic without actual DBA-reviewed integration.
- `src/bdp/ingestion/parcelSealedSourceAuthority.test.mjs`: 14 synthetic/static tests of no-grant SQL structure, latest-finished-run rules, seal and rights gating, immutable return contract, integer precision and failure cases.
- `scripts/bdp/parcel-sealed-source-authority-disposable-smoke.mjs`: **explicit opt-in only**, runs one new network-disabled, unmounted, portless Docker PostGIS container with invented test records. Exercises SQL migration syntax, PUBLIC/metadata default deny, a transient NOLOGIN EXECUTE-only authority role, pre-seal rejection, post-seal acceptance, revocation, wrong county, and denial after a newer partial/unsealed complete run. Auto-removes the container, including its volume. This is NOT a production SQL migration or real GIS rights review.
- `src/bdp/ingestion/parcelSealedSourceAuthorityDisposableSmoke.test.mjs`: 8 non-Docker/static contract checks for the opt-in guard, disposable isolation, privilege separation and fixture safety.

## Remaining security requirements

Do not wire this new authority RPC directly into the Step 40C-33 runtime yet. The authority reader callback must be backed by a distinct and DBA-reviewed, separately provisioned least-privileged authority role and pinned transaction with revocation/backpressure controls. The geometry-only principal must **not** acquire this source RPC, old metadata RPC or raw GIS tables. Independent legal GIS redistribution review is still required and must be read from an independent trusted service. Session cookie/MFA issuance, authoritative session storage, distributed quotas, complete GIS license review, policy races, DB function-owner auditing, production onboarding and verified source ingestion are still missing. No private results should be exposed to the browser.

The Step 40C-34 SQL is a **review draft** only. Do NOT execute it against existing BDP PostGIS or any data source licensed for use in the application. The only permitted smoke target is the script-created, disposable synthetic Docker container.

## Windows PowerShell validation, in sequence

```powershell
cd "$HOME\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSealedSourceAuthority.test.mjs src/bdp/ingestion/parcelSealedSourceAuthorityDisposableSmoke.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected Step 40C-34 source-level total: **22 tests**, NOT yet confirmed. Stop at the first failure. Confirm discovery separately:

```powershell
node -e "import('./scripts/bdp/run-land-tests.mjs').then(m=>console.log(m.discoverLandTestFiles().filter(p=>p.includes('SealedSourceAuthority') || p.includes('SealedGeometryRuntime'))))"
```

**Optional, if Docker Desktop is running and the focused suite passes**, run the REAL disposable PostGIS smoke; it will not access the local BDP service connection:

```powershell
node scripts/bdp/parcel-sealed-source-authority-disposable-smoke.mjs --disposable-only
```

Expected success message: `PASS: disposable PostGIS sealed-source authority, isolated EXECUTE, latest-run gating and revocation.`

Passing code-level tests does not establish any production GIS rights. The original Cesium / God’s Eye interface, **2.4 km Free Explorer**, Travis CAD browsing behavior and property panel are unchanged.

## Next

Step 40C-35 should design a **separate sealed-source authority database-login/privilege attestation** (distinct from the Step 40C-33 geometry-only login), then independently verify it under a disposable PostgreSQL environment before considering a connection to real session and policy providers. All new paths should remain UNROUTED until a formal authentication/authorization and GIS-rights review.
